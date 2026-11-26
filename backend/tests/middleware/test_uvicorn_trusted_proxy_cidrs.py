"""uvicorn's ``ProxyHeadersMiddleware`` and ``rate_limit.peer_ip`` against the
ALB's subnet ranges.

Plan ``2026-11-25-narrow-rate-limit-trusted-proxy-ranges-to-the-alb-subnets``
Phase 1. The plan sets ``FORWARDED_ALLOW_IPS`` (uvicorn) and
``RATE_LIMIT_TRUSTED_PROXY_CIDRS`` (the app) to the same two ALB subnets,
``10.20.0.0/20`` and ``10.20.16.0/20``. Before it does, this module pins:

* uvicorn 0.38 parses a comma-separated CIDR list (with or without spaces),
  trusts a peer inside it, takes the RIGHTMOST untrusted ``X-Forwarded-For``
  entry as the client, and ignores the header from a peer outside it;
* for a trusted peer it also rewrites ``scope["scheme"]`` from
  ``X-Forwarded-Proto`` (so ``request.url.scheme`` becomes ``https`` behind the
  ALB);
* with both layers on the same ranges and a SINGLE-hop header (the ALB appends
  exactly one entry), ``rate_limit.peer_ip`` yields the same key whether or not
  uvicorn rewrote ``client`` first, and a forged leftmost ``X-Forwarded-For``
  entry changes nothing. A multi-hop header whose trailing entry is itself a
  trusted proxy is the one shape where the layers differ (uvicorn skips the
  trusted hop, ``peer_ip`` takes the rightmost entry); one test pins that.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from starlette.requests import Request
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.middleware import rate_limit

# The one value both layers are configured with. Mutation check: widening this
# to 10.0.0.0/8 must turn the "outside the ranges" cases red.
ALB_RANGES = "10.20.0.0/20,10.20.16.0/20"

ALB_NODE = "10.20.8.196"  # inside 10.20.0.0/20
ALB_NODE_B = "10.20.20.7"  # inside 10.20.16.0/20
PRIVATE_OUTSIDE = "10.20.130.5"  # RFC1918 but not an ALB subnet
PUBLIC_OUTSIDE = "203.0.113.9"
FORGED = "6.6.6.6"
REAL_CLIENT = "198.51.100.4"


def _scope(
    peer: str, headers: list[tuple[bytes, bytes]], scheme: str = "http"
) -> dict[str, Any]:
    return {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "scheme": scheme,
        "headers": headers,
        "client": (peer, 40000),
    }


async def _run_uvicorn(
    scope: dict[str, Any], trusted_hosts: str = ALB_RANGES
) -> dict[str, Any]:
    """Run ``scope`` through uvicorn's middleware; return the scope the inner
    app saw."""
    seen: dict[str, Any] = {}

    async def app(scope, receive, send):  # type: ignore[no-untyped-def]
        seen.update(scope)

    async def receive():  # type: ignore[no-untyped-def]
        return {"type": "http.request"}

    async def send(message):  # type: ignore[no-untyped-def]
        return None

    await ProxyHeadersMiddleware(app, trusted_hosts=trusted_hosts)(
        scope,  # type: ignore[arg-type]
        receive,
        send,
    )
    return seen


def _through_uvicorn(
    scope: dict[str, Any], trusted_hosts: str = ALB_RANGES
) -> dict[str, Any]:
    return asyncio.run(_run_uvicorn(scope, trusted_hosts))


def _xff(value: str) -> list[tuple[bytes, bytes]]:
    return [(b"x-forwarded-for", value.encode())]


@pytest.fixture(autouse=True)
def _alb_ranges(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        rate_limit.settings, "RATE_LIMIT_TRUSTED_PROXY_CIDRS", ALB_RANGES
    )


# ---------------------------------------------------------------------------
# (a) uvicorn's own behaviour
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("peer", [ALB_NODE, ALB_NODE_B])
def test_trusted_peer_client_becomes_rightmost_untrusted(peer: str) -> None:
    seen = _through_uvicorn(_scope(peer, _xff(f"{FORGED}, {REAL_CLIENT}")))
    assert seen["client"] == (REAL_CLIENT, 0)


def test_rightmost_untrusted_skips_trailing_trusted_hops() -> None:
    """A second ALB-range hop appended after the client is skipped over."""
    seen = _through_uvicorn(
        _scope(ALB_NODE, _xff(f"{FORGED}, {REAL_CLIENT}, {ALB_NODE_B}"))
    )
    assert seen["client"] == (REAL_CLIENT, 0)


def test_cidr_list_without_spaces_and_with_spaces_parse_alike() -> None:
    for spelling in (ALB_RANGES, "10.20.0.0/20, 10.20.16.0/20"):
        seen = _through_uvicorn(
            _scope(ALB_NODE_B, _xff(f"{FORGED}, {REAL_CLIENT}")), spelling
        )
        assert seen["client"] == (REAL_CLIENT, 0), spelling


@pytest.mark.parametrize("peer", [PRIVATE_OUTSIDE, PUBLIC_OUTSIDE])
def test_peer_outside_ranges_leaves_client_unchanged(peer: str) -> None:
    seen = _through_uvicorn(
        _scope(
            peer,
            _xff(f"{FORGED}, {REAL_CLIENT}") + [(b"x-forwarded-proto", b"https")],
        )
    )
    assert seen["client"] == (peer, 40000)
    assert seen["scheme"] == "http"  # proto header ignored as well


def test_trusted_peer_rewrites_scheme_from_x_forwarded_proto() -> None:
    """Recorded fact: uvicorn rewrites ``scope["scheme"]`` for a trusted peer,
    so ``request.url.scheme`` is ``https`` behind the ALB once
    ``FORWARDED_ALLOW_IPS`` names it."""
    seen = _through_uvicorn(
        _scope(
            ALB_NODE,
            _xff(REAL_CLIENT) + [(b"x-forwarded-proto", b"https")],
        )
    )
    assert seen["scheme"] == "https"


# ---------------------------------------------------------------------------
# (b) composition with rate_limit.peer_ip
# ---------------------------------------------------------------------------


def _request(scope: dict[str, Any]) -> Request:
    return Request(scope)


@pytest.mark.parametrize("peer", [ALB_NODE, ALB_NODE_B])
def test_peer_ip_same_with_or_without_uvicorn_rewrite(peer: str) -> None:
    header = _xff(f"{FORGED}, {REAL_CLIENT}")
    raw = rate_limit.peer_ip(_request(_scope(peer, list(header))))
    rewritten = rate_limit.peer_ip(
        _request(_through_uvicorn(_scope(peer, list(header))))
    )
    assert raw == rewritten == REAL_CLIENT


def test_forged_leftmost_entry_changes_nothing() -> None:
    keys = set()
    for forged in (FORGED, "7.7.7.7", "1.2.3.4"):
        header = _xff(f"{forged}, {REAL_CLIENT}")
        keys.add(rate_limit.peer_ip(_request(_scope(ALB_NODE, list(header)))))
        keys.add(
            rate_limit.peer_ip(
                _request(_through_uvicorn(_scope(ALB_NODE, list(header))))
            )
        )
    assert keys == {REAL_CLIENT}


@pytest.mark.parametrize("peer", [PRIVATE_OUTSIDE, PUBLIC_OUTSIDE])
def test_untrusted_peer_keys_on_itself_in_both_layers(peer: str) -> None:
    """A forged-private or public socket peer outside the ranges is its own
    caller: its ``X-Forwarded-For`` is ignored by uvicorn and by the app."""
    header = _xff(f"{FORGED}, {REAL_CLIENT}")
    raw = rate_limit.peer_ip(_request(_scope(peer, list(header))))
    rewritten = rate_limit.peer_ip(
        _request(_through_uvicorn(_scope(peer, list(header))))
    )
    assert raw == rewritten == peer


def test_trailing_trusted_hop_is_where_the_layers_diverge() -> None:
    """Pinned, not endorsed: with ``FORGED, REAL, <trusted proxy>`` uvicorn skips
    the trailing trusted hop and yields REAL, while ``peer_ip`` on the raw header
    takes the rightmost entry. Behind a single ALB the header has one hop, so the
    app sees the rewritten client; this records the multi-hop difference."""
    header = _xff(f"{FORGED}, {REAL_CLIENT}, {ALB_NODE_B}")
    raw = rate_limit.peer_ip(_request(_scope(ALB_NODE, list(header))))
    rewritten_scope = _through_uvicorn(_scope(ALB_NODE, list(header)))
    assert rewritten_scope["client"][0] == REAL_CLIENT
    assert raw == ALB_NODE_B
