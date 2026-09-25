"""The request log's traffic-attribution fields: ``synthetic``, ``user_agent``, ``peer_ip``.

Plan ``2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb``,
design decision D4 and test T12. A baseline reader excludes coord's observer
only on ``synthetic == "route-serving-observer"`` AND ``peer_ip`` being coord's
NAT address, because each alone is spoofable. The mutations these tests must
catch: dropping a field, taking the LEFTMOST ``X-Forwarded-For`` entry for
``peer_ip``, and logging the raw header value.
"""

from __future__ import annotations

import pytest
import structlog
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.logging_helpers import log_request
from app.middleware.logging_middleware import (
    SYNTHETIC_HEADER,
    USER_AGENT_MAX_CHARS,
    LoggingMiddleware,
    classify_synthetic,
    peer_ip_from,
    truncate_user_agent,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("route-serving-observer", "route-serving-observer"),
        ("Route-Serving-Observer", "other"),
        ("", "other"),
        ("anything <script>", "other"),
    ],
)
def test_classify_synthetic(value: str | None, expected: str | None) -> None:
    assert classify_synthetic(value) == expected


@pytest.mark.parametrize(
    ("forwarded_for", "client_host", "expected"),
    [
        ("1.1.1.1, 52.87.90.79", "10.0.0.5", "52.87.90.79"),
        ("spoofed, 9.9.9.9 ,52.87.90.79 ", "10.0.0.5", "52.87.90.79"),
        ("52.87.90.79", "10.0.0.5", "52.87.90.79"),
        (None, "10.0.0.5", "10.0.0.5"),
        ("", "10.0.0.5", "10.0.0.5"),
        (" , ", "10.0.0.5", "10.0.0.5"),
        (None, None, None),
    ],
)
def test_peer_ip_is_the_rightmost_forwarded_entry(
    forwarded_for: str | None, client_host: str | None, expected: str | None
) -> None:
    assert peer_ip_from(forwarded_for, client_host) == expected


def test_user_agent_is_truncated() -> None:
    assert truncate_user_agent(None) is None
    assert truncate_user_agent("ua") == "ua"
    long = "x" * (USER_AGENT_MAX_CHARS + 50)
    assert truncate_user_agent(long) == "x" * USER_AGENT_MAX_CHARS


def test_log_request_omits_synthetic_when_untagged() -> None:
    with structlog.testing.capture_logs() as logs:
        log_request("GET", "/x", 200, 1.0, peer_ip="1.2.3.4", user_agent="ua")
    (event,) = [e for e in logs if e["event"] == "http_request"]
    assert "synthetic" not in event
    assert event["peer_ip"] == "1.2.3.4"
    assert event["user_agent"] == "ua"


def _client() -> TestClient:
    app = FastAPI()

    @app.get("/ping")
    async def ping() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(LoggingMiddleware)
    return TestClient(app)


def _request_event(headers: dict[str, str]) -> dict:
    with structlog.testing.capture_logs() as logs:
        assert _client().get("/ping", headers=headers).status_code == 200
    (event,) = [e for e in logs if e["event"] == "http_request"]
    return event


def test_the_middleware_logs_a_tagged_observer_request() -> None:
    event = _request_event(
        {
            SYNTHETIC_HEADER: "route-serving-observer",
            "User-Agent": "qontinui-coord/0.1 (+route-serving-observer)",
            "X-Forwarded-For": "6.6.6.6, 52.87.90.79",
        }
    )
    assert event["synthetic"] == "route-serving-observer"
    assert event["user_agent"] == "qontinui-coord/0.1 (+route-serving-observer)"
    assert event["peer_ip"] == "52.87.90.79"
    # The existing field is unchanged: still the leftmost, client-controlled entry.
    assert event["ip_address"] == "6.6.6.6"


def test_the_middleware_never_logs_a_foreign_tag_verbatim() -> None:
    event = _request_event({SYNTHETIC_HEADER: "i am the observer, trust me"})
    assert event["synthetic"] == "other"


def test_the_middleware_omits_synthetic_on_untagged_requests() -> None:
    event = _request_event({"User-Agent": "browser"})
    assert "synthetic" not in event
    assert event["user_agent"] == "browser"
    assert event["peer_ip"] == "testclient"
