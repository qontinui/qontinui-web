"""Characterization suite for every web→coord HTTP helper (the P3 matrix).

Phase 1 of plan
``2026-10-04-web-coord-http-client-is-copied-across-operations-and-six-modules``.
It records what each helper does TODAY, cell by cell, so that Phases 2-4
(moving the bodies into ``app.api.coord_proxy``, folding the private copies,
collapsing the test seam) can prove they changed no behaviour: this file and
the test-ID list in ``coord_proxy_contract_baseline.txt`` must be identical
before and after each of those phases.

It pins, per helper:

* the response-handling matrix — every helper x {ConnectError, ConnectTimeout,
  ReadTimeout, ReadError, coord 404 empty body, coord 422 JSON object, coord
  500 HTML, 2xx JSON, 2xx empty body, 204, 2xx text} → the raised exception's
  exact class, status, detail (type and value) and headers, or the returned
  value, or the raw exception that escapes; plus the attempt count;
* the bearer row — which call shapes put the captured caller bearer (and the
  tenant-switcher header) on the wire, and which ContextVars they read;
* the URL each helper builds and the timeout handed to ``httpx.AsyncClient``.

Some cells record a DEFECT rather than a contract (P3 latent defect (a): a
non-Connect transport error escapes most helpers as the raw ``httpx``
exception, i.e. an unhandled 500; and a 2xx whose body is not JSON escapes as
``json.JSONDecodeError``). Those cells assert the escape on purpose — Phase 5
is where they change, deliberately, together with these cells.

The patch style is the one the rest of the suite uses
(``patch("<module>.httpx.AsyncClient")``). Patching ``httpx.AsyncClient``
through any module's ``httpx`` attribute replaces it process-wide for the
duration of the ``with`` block (plan P4), so the per-helper target below
names the module that owns the helper only for readability.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import pytest
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.api.v1.endpoints import (
    agent_registry,
    agent_sessions,
    operations,
    prompt_injections,
)
from app.core.config import settings
from app.services import coord_proxy as services_coord_proxy
from tests._coord_proxy_sleep import patch_coord_proxy_sleep

TENANT = UUID("00000000-0000-4000-8000-000000000001")
PATH = "/coord/contract-probe"
BODY = {"a": 1}

BEARER = "tok-contract"
ACTIVE = "tenant-switch-contract"
FULL_HEADERS = {
    "Authorization": f"Bearer {BEARER}",
    "X-Qontinui-Active-Tenant": ACTIVE,
}

NOT_REACHABLE = "coord is not reachable"
TIMED_OUT = "timeout waiting for coord"

_REQ = httpx.Request("GET", "http://coord.test/coord/contract-probe")

# ---------------------------------------------------------------------------
# Scenarios — what the stubbed coord does.
# ---------------------------------------------------------------------------

_JSON_ERROR_BODY = b'{"error":"invalid_disposition","hint":"pick one"}'
_JSON_ERROR_DICT = {"error": "invalid_disposition", "hint": "pick one"}
_HTML_BODY = "<html><body><h1>500 Internal Server Error</h1></body></html>"
_OK_BODY = b'{"ok":true,"n":1}'
_OK_DICT = {"ok": True, "n": 1}
_TEXT_BODY = "plain text answer"


def _response(status: int, content: bytes = b"", ctype: str | None = None) -> Any:
    headers = {"content-type": ctype} if ctype else {}
    return httpx.Response(status, content=content, headers=headers, request=_REQ)


# Each scenario is a zero-arg factory producing either an exception instance
# (raised by the stubbed client method) or a real ``httpx.Response`` (so
# ``.json()`` / ``.text`` / ``.content`` behave genuinely — a MagicMock
# ``json()`` would mask exactly the non-JSON cells this suite exists to pin).
SCENARIOS: dict[str, Callable[[], Any]] = {
    "connect_error": lambda: httpx.ConnectError("refused", request=_REQ),
    "connect_timeout": lambda: httpx.ConnectTimeout("connect timed out", request=_REQ),
    "read_timeout": lambda: httpx.ReadTimeout("read timed out", request=_REQ),
    "read_error": lambda: httpx.ReadError("connection reset", request=_REQ),
    "coord_404_empty": lambda: _response(404),
    "coord_422_json": lambda: _response(422, _JSON_ERROR_BODY, "application/json"),
    "coord_500_html": lambda: _response(500, _HTML_BODY.encode(), "text/html"),
    "ok_200_json": lambda: _response(200, _OK_BODY, "application/json"),
    "ok_200_empty": lambda: _response(200),
    "no_content_204": lambda: _response(204),
    "ok_200_text": lambda: _response(200, _TEXT_BODY.encode(), "text/plain"),
}
# Extra scenarios, exercised only against the helpers whose behaviour they
# distinguish: the three gateway statuses post_to_coord retries, and a 202
# for the return_status variant (which passes a <400 status through).
GATEWAY_502 = "gateway_502"
GATEWAY_503 = "gateway_503"
GATEWAY_504 = "gateway_504"
OK_202_JSON = "ok_202_json"
_EXTRA_SCENARIOS: dict[str, Callable[[], Any]] = {
    GATEWAY_502: lambda: _response(502, b"Bad Gateway", "text/plain"),
    GATEWAY_503: lambda: _response(503, b"Service Unavailable", "text/plain"),
    GATEWAY_504: lambda: _response(504, b"Gateway Timeout", "text/plain"),
    OK_202_JSON: lambda: _response(202, _OK_BODY, "application/json"),
}


# ---------------------------------------------------------------------------
# Expected outcomes.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Raises:
    """An ``HTTPException`` of EXACTLY ``cls`` (not a subclass) is raised."""

    status: int
    detail: Any
    cls: type[HTTPException] = HTTPException
    headers: dict[str, str] | None = None


@dataclass(frozen=True)
class Escapes:
    """A non-HTTPException escapes the helper (an unhandled 500 in a route)."""

    cls: type[BaseException]


@dataclass(frozen=True)
class Returns:
    value: Any


@dataclass(frozen=True)
class Responds:
    """A ``JSONResponse`` with this status and (parsed) body is returned."""

    status: int
    body: Any


@dataclass(frozen=True)
class ReturnsRawResponse:
    """The coord ``httpx.Response`` object itself is returned (post_to_coord)."""


@dataclass(frozen=True)
class Cell:
    outcome: Raises | Escapes | Returns | Responds | ReturnsRawResponse
    attempts: int = 1


# Phase 5 / latent defect (a): ReadError escapes as the raw httpx exception.
_READ_ERROR_ESCAPES = Cell(Escapes(httpx.ReadError))
# A 2xx whose body is not JSON escapes out of ``resp.json()``.
_NOT_JSON_ESCAPES = Cell(Escapes(json.JSONDecodeError))


def _transport(cls: type[HTTPException] = HTTPException) -> dict[str, Cell]:
    """The ConnectError / ConnectTimeout / ReadTimeout arms shared by most
    helpers. ConnectTimeout lands in the 504 arm (P3 latent defect (b))."""
    return {
        "connect_error": Cell(Raises(502, NOT_REACHABLE, cls)),
        "connect_timeout": Cell(Raises(504, TIMED_OUT, cls)),
        "read_timeout": Cell(Raises(504, TIMED_OUT, cls)),
    }


# The GET reader family: coord ≥400 → HTTPException(status, resp.text); 2xx →
# resp.json() (non-JSON escapes); ReadError escapes.
def _get_family(cls: type[HTTPException]) -> dict[str, Cell]:
    return {
        **_transport(cls),
        "read_error": _READ_ERROR_ESCAPES,
        "coord_404_empty": Cell(Raises(404, "")),
        "coord_422_json": Cell(Raises(422, _JSON_ERROR_BODY.decode())),
        "coord_500_html": Cell(Raises(500, _HTML_BODY)),
        "ok_200_json": Cell(Returns(_OK_DICT)),
        "ok_200_empty": _NOT_JSON_ESCAPES,
        "no_content_204": _NOT_JSON_ESCAPES,
        "ok_200_text": _NOT_JSON_ESCAPES,
    }


_WRITE_FAMILY: dict[str, Cell] = {
    **_transport(),
    # The one reader that maps a non-Connect transport error.
    "read_error": Cell(
        Raises(
            504,
            "coord's answer was lost in transit (ReadError); "
            "the change may have been applied",
        )
    ),
    "coord_404_empty": Cell(Raises(404, "")),
    "coord_422_json": Cell(Raises(422, _JSON_ERROR_BODY.decode())),
    "coord_500_html": Cell(Raises(500, _HTML_BODY)),
    "ok_200_json": Cell(Returns(_OK_DICT)),
    "ok_200_empty": Cell(Returns(None)),
    "no_content_204": Cell(Returns(None)),
    "ok_200_text": Cell(
        Raises(
            504,
            "coord answered 200 with a body that is not JSON; "
            "the change may have been applied",
        )
    ),
}

# ``_proxy_coord_verbatim`` and the open-coded clone-credential route.
_VERBATIM_FAMILY: dict[str, Cell] = {
    **_transport(),
    "read_error": _READ_ERROR_ESCAPES,
    "coord_404_empty": Cell(Responds(404, {"detail": ""})),
    "coord_422_json": Cell(Responds(422, _JSON_ERROR_DICT)),
    "coord_500_html": Cell(Responds(500, {"detail": _HTML_BODY})),
    "ok_200_json": Cell(Responds(200, _OK_DICT)),
    "ok_200_empty": Cell(Responds(200, {"detail": ""})),
    # RECORDED PROTOCOL ODDITY (Phase 5): coord's bodiless 204 is relayed as
    # a JSONResponse with status 204 AND a body (``{"detail": ""}``) — a 204
    # must carry no content. Pinned as today's behaviour; Phase 5 decides it.
    "no_content_204": Cell(Responds(204, {"detail": ""})),
    "ok_200_text": Cell(Responds(200, {"detail": _TEXT_BODY})),
}

_DELETE_FAMILY: dict[str, Cell] = {
    **_get_family(HTTPException),
    "ok_200_empty": Cell(Returns({"status": "ok"})),
    "no_content_204": Cell(Returns({"status": "ok"})),
}

_PASSTHROUGH_FAMILY: dict[str, Cell] = {
    **_transport(),
    "read_error": _READ_ERROR_ESCAPES,
    # Empty error body → the synthesized message, not an empty string.
    "coord_404_empty": Cell(Responds(404, {"error": "coord returned HTTP 404"})),
    "coord_422_json": Cell(Responds(422, _JSON_ERROR_DICT)),
    "coord_500_html": Cell(Responds(500, {"error": _HTML_BODY})),
    "ok_200_json": Cell(Responds(200, _OK_DICT)),
    "ok_200_empty": Cell(
        Raises(502, "coord answered HTTP 200 with a body that is not JSON")
    ),
    "no_content_204": Cell(
        Raises(502, "coord answered HTTP 204 with a body that is not JSON")
    ),
    "ok_200_text": Cell(
        Raises(502, "coord answered HTTP 200 with a body that is not JSON")
    ),
}

_POST_RETRY_AFTER = {"Retry-After": "10"}
_POST_TO_COORD_503 = Cell(
    Raises(
        503,
        {
            "error": "SERVICE_UNAVAILABLE",
            "message": (
                "Coord is temporarily unavailable (likely a rolling "
                "deploy); retry shortly."
            ),
        },
        headers=_POST_RETRY_AFTER,
    ),
    attempts=3,
)

EXPECTED: dict[str, dict[str, Cell]] = {
    "ops_get": _get_family(operations.CoordTransportUnavailable),
    # Transport arms stay CoordTransportUnavailable; only a JSON OBJECT error
    # body becomes a dict detail — empty/HTML fall back to ``resp.text``.
    "ops_get_structured_errors": {
        **_get_family(operations.CoordTransportUnavailable),
        "coord_422_json": Cell(Raises(422, _JSON_ERROR_DICT)),
    },
    "ops_post": _get_family(HTTPException),
    "ops_post_structured_errors": {
        **_get_family(HTTPException),
        # Only a JSON OBJECT becomes a dict detail; empty/HTML stay text.
        "coord_422_json": Cell(Raises(422, _JSON_ERROR_DICT)),
    },
    # return_status=True: a <400 answer comes back as ``(json, status)`` with
    # coord's own status passed through (the 202 row); ≥400 and non-JSON 2xx
    # behave exactly as plain ops_post.
    "ops_post_return_status": {
        **_get_family(HTTPException),
        "ok_200_json": Cell(Returns((_OK_DICT, 200))),
        OK_202_JSON: Cell(Returns((_OK_DICT, 202))),
    },
    "ops_post_non_json_success_as_empty": {
        **_get_family(HTTPException),
        "ok_200_empty": Cell(Returns({})),
        "no_content_204": Cell(Returns({})),
        "ok_200_text": Cell(Returns({})),
    },
    # Recorded, no cell depends on it: for a NON-dict detail (the 404/500
    # rows), ``_readable_coord_refusal`` returns the caught exception itself,
    # so ``_proxy_coord_post_readable`` executes ``raise exc from exc`` — the
    # re-raised exception is its own ``__cause__``. Class, status and detail
    # are unchanged, which is all these cells assert.
    "ops_post_readable": {
        **_get_family(HTTPException),
        "coord_422_json": Cell(
            Raises(
                422,
                {
                    **_JSON_ERROR_DICT,
                    "message": "coord refused this (422): invalid_disposition"
                    " — pick one",
                },
            )
        ),
    },
    "ops_patch": _WRITE_FAMILY,
    "ops_put": _WRITE_FAMILY,
    "ops_delete": _DELETE_FAMILY,
    # body= switches the call to client.request("DELETE", ...); same answers.
    "ops_delete_with_body": _DELETE_FAMILY,
    "ops_verbatim": _VERBATIM_FAMILY,
    "ops_route_clone_credential": _VERBATIM_FAMILY,
    "ops_passthrough": _PASSTHROUGH_FAMILY,
    # The POST arm (``client.post(json=body or {})``); same answer handling.
    "ops_passthrough_post": _PASSTHROUGH_FAMILY,
    "agent_registry_coord_request": {
        **_transport(),
        # httpx.RequestError arm: ReadError → 502, not an escape.
        "read_error": Cell(Raises(502, NOT_REACHABLE)),
        "coord_404_empty": Cell(Raises(404, "")),
        "coord_422_json": Cell(Raises(422, _JSON_ERROR_DICT)),
        "coord_500_html": Cell(Raises(500, _HTML_BODY)),
        "ok_200_json": Cell(Returns(_OK_DICT)),
        "ok_200_empty": _NOT_JSON_ESCAPES,
        "no_content_204": _NOT_JSON_ESCAPES,
        "ok_200_text": _NOT_JSON_ESCAPES,
    },
    # The private copies raise PLAIN HTTPException on transport failure —
    # same status and detail as operations' CoordTransportUnavailable.
    "agent_sessions_get": _get_family(HTTPException),
    "prompt_injections_get": _get_family(HTTPException),
    "post_to_coord": {
        "connect_error": _POST_TO_COORD_503,
        "connect_timeout": _POST_TO_COORD_503,
        "read_timeout": Cell(
            Raises(
                504,
                {
                    "error": "GATEWAY_TIMEOUT",
                    "message": (
                        "Coord did not respond in time; the operation may "
                        "not have completed. Retry shortly."
                    ),
                },
                headers=_POST_RETRY_AFTER,
            )
        ),
        "read_error": Cell(Raises(502, "Coord unreachable.")),
        "coord_404_empty": Cell(ReturnsRawResponse()),
        "coord_422_json": Cell(ReturnsRawResponse()),
        "coord_500_html": Cell(ReturnsRawResponse()),
        "ok_200_json": Cell(ReturnsRawResponse()),
        "ok_200_empty": Cell(ReturnsRawResponse()),
        "no_content_204": Cell(ReturnsRawResponse()),
        "ok_200_text": Cell(ReturnsRawResponse()),
        GATEWAY_502: _POST_TO_COORD_503,
        GATEWAY_503: _POST_TO_COORD_503,
        GATEWAY_504: _POST_TO_COORD_503,
    },
}


# ---------------------------------------------------------------------------
# Helpers under test — how to drive each one.
# ---------------------------------------------------------------------------

_OPS_TARGET = "app.api.v1.endpoints.operations.httpx.AsyncClient"


@dataclass(frozen=True)
class Helper:
    patch_target: str
    # The ``httpx.AsyncClient`` method the helper calls.
    method: str
    invoke: Callable[..., Awaitable[Any]]
    # The ContextVar pair this helper's bearer forwarding reads.
    vars_module: Any = operations
    sleeps: bool = False


def _url() -> str:
    return f"{settings.COORD_URL}{PATH}"


def _fwd(fn: Callable[..., Awaitable[Any]], *args: Any, **defaults: Any) -> Any:
    """An ``invoke`` that FORWARDS every kwarg to the helper over ``defaults``.

    Nothing is swallowed: a kwarg the real helper does not accept raises
    ``TypeError`` from its own signature, so a row can never think it set an
    option the call silently dropped (``test_invoke_rejects_unknown_kwargs``).
    """

    def invoke(**kw: Any) -> Awaitable[Any]:
        return fn(*args, **{**defaults, **kw})

    return invoke


DELETE_BODY = {"role": "admin"}

HELPERS: dict[str, Helper] = {
    "ops_get": Helper(
        _OPS_TARGET, "get", _fwd(operations._proxy_coord_get, PATH, tenant_id=TENANT)
    ),
    "ops_get_structured_errors": Helper(
        _OPS_TARGET,
        "get",
        _fwd(
            operations._proxy_coord_get,
            PATH,
            tenant_id=TENANT,
            structured_errors=True,
        ),
    ),
    "ops_post": Helper(
        _OPS_TARGET,
        "post",
        _fwd(operations._proxy_coord_post, PATH, BODY, tenant_id=TENANT),
    ),
    "ops_post_structured_errors": Helper(
        _OPS_TARGET,
        "post",
        _fwd(
            operations._proxy_coord_post,
            PATH,
            BODY,
            tenant_id=TENANT,
            structured_errors=True,
        ),
    ),
    "ops_post_return_status": Helper(
        _OPS_TARGET,
        "post",
        _fwd(
            operations._proxy_coord_post,
            PATH,
            BODY,
            tenant_id=TENANT,
            return_status=True,
        ),
    ),
    "ops_post_non_json_success_as_empty": Helper(
        _OPS_TARGET,
        "post",
        _fwd(
            operations._proxy_coord_post,
            PATH,
            BODY,
            tenant_id=TENANT,
            non_json_success_as_empty=True,
        ),
    ),
    "ops_post_readable": Helper(
        _OPS_TARGET,
        "post",
        _fwd(operations._proxy_coord_post_readable, PATH, BODY, tenant_id=TENANT),
    ),
    "ops_patch": Helper(
        _OPS_TARGET,
        "patch",
        _fwd(operations._proxy_coord_patch, PATH, BODY, tenant_id=TENANT),
    ),
    "ops_put": Helper(
        _OPS_TARGET,
        "put",
        _fwd(operations._proxy_coord_put, PATH, BODY, tenant_id=TENANT),
    ),
    "ops_delete": Helper(
        _OPS_TARGET,
        "delete",
        _fwd(operations._proxy_coord_delete, PATH, tenant_id=TENANT),
    ),
    # body= is the branch that goes through client.request("DELETE", ...).
    "ops_delete_with_body": Helper(
        _OPS_TARGET,
        "request",
        _fwd(operations._proxy_coord_delete, PATH, tenant_id=TENANT, body=DELETE_BODY),
    ),
    "ops_verbatim": Helper(
        _OPS_TARGET,
        "request",
        _fwd(
            operations._proxy_coord_verbatim,
            "POST",
            PATH,
            tenant_id=TENANT,
            json_body=BODY,
        ),
    ),
    "ops_route_clone_credential": Helper(
        _OPS_TARGET,
        "post",
        _fwd(
            operations.post_github_clone_credential,
            operations.CloneCredentialRequest(repo="owner/name"),
            tenant_id=TENANT,
        ),
    ),
    "ops_passthrough": Helper(
        _OPS_TARGET,
        "get",
        _fwd(operations._proxy_coord_passthrough, "GET", PATH, tenant_id=TENANT),
    ),
    "ops_passthrough_post": Helper(
        _OPS_TARGET,
        "post",
        _fwd(
            operations._proxy_coord_passthrough,
            "POST",
            PATH,
            tenant_id=TENANT,
            body=BODY,
        ),
    ),
    "agent_registry_coord_request": Helper(
        "app.api.v1.endpoints.agent_registry.httpx.AsyncClient",
        "request",
        _fwd(agent_registry._coord_request, "GET", PATH),
    ),
    "agent_sessions_get": Helper(
        "app.api.v1.endpoints.agent_sessions.httpx.AsyncClient",
        "get",
        _fwd(agent_sessions._proxy_coord_get, PATH),
        vars_module=agent_sessions,
    ),
    "prompt_injections_get": Helper(
        "app.api.v1.endpoints.prompt_injections.httpx.AsyncClient",
        "get",
        _fwd(prompt_injections._proxy_coord_get, PATH),
        vars_module=prompt_injections,
    ),
    "post_to_coord": Helper(
        "app.services.coord_proxy.httpx.AsyncClient",
        "post",
        _fwd(
            services_coord_proxy.post_to_coord,
            PATH,
            headers={"Authorization": "Bearer service-token"},
            json_body=BODY,
            log_event="contract",
        ),
        sleeps=True,
    ),
}


@contextlib.contextmanager
def _captured(
    module: Any, bearer: str | None = BEARER, active: str | None = ACTIVE
) -> Iterator[None]:
    """Set ``module``'s caller ContextVars for the block, then restore them."""
    t1 = module._caller_bearer.set(bearer)
    t2 = module._caller_active_tenant.set(active)
    try:
        yield
    finally:
        module._caller_bearer.reset(t1)
        module._caller_active_tenant.reset(t2)


@contextlib.contextmanager
def _stub_coord(
    helper: Helper,
    outcome: Callable[[], Any],
    sleep: AsyncMock | None = None,
) -> Iterator[MagicMock]:
    """Patch ``httpx.AsyncClient`` so every call to ``helper.method`` yields
    ``outcome()`` (raised if it is an exception). Yields the client CLASS
    mock; ``.return_value`` is the instance whose method was called.

    For a retrying helper (``helper.sleeps``) ``asyncio.sleep`` is replaced by
    ``sleep`` (a fresh ``AsyncMock`` when not given) so the backoff costs no
    wall time and can be read back from its ``await_args_list``. The
    replacement is scoped to coord_proxy alone (see
    :mod:`tests._coord_proxy_sleep` for why patching ``asyncio.sleep`` by its
    dotted path is process-wide and made the backoff assert flaky)."""
    instance = AsyncMock()

    async def _answer(*_args: Any, **_kwargs: Any) -> Any:
        result = outcome()
        if isinstance(result, BaseException):
            raise result
        return result

    getattr(instance, helper.method).side_effect = _answer
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    with contextlib.ExitStack() as stack:
        client_cls = stack.enter_context(
            patch(helper.patch_target, return_value=instance)
        )
        if helper.sleeps:
            stack.enter_context(patch_coord_proxy_sleep(sleep))
        yield client_cls


def _sent(client_cls: MagicMock, helper: Helper) -> Any:
    return getattr(client_cls.return_value, helper.method)


# ---------------------------------------------------------------------------
# The P3 response matrix.
# ---------------------------------------------------------------------------

_MATRIX = [
    pytest.param(h, s, id=f"{h}-{s}") for h, cells in EXPECTED.items() for s in cells
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("helper_name", "scenario"), _MATRIX)
async def test_response_matrix(helper_name: str, scenario: str) -> None:
    helper = HELPERS[helper_name]
    cell = EXPECTED[helper_name][scenario]
    factory = {**SCENARIOS, **_EXTRA_SCENARIOS}[scenario]
    produced: list[Any] = []

    def _outcome() -> Any:
        value = factory()
        produced.append(value)
        return value

    expected = cell.outcome
    with _captured(helper.vars_module), _stub_coord(helper, _outcome) as client_cls:
        if isinstance(expected, Raises):
            with pytest.raises(HTTPException) as exc_info:
                await helper.invoke()
            exc = exc_info.value
            assert type(exc) is expected.cls
            assert exc.status_code == expected.status
            assert type(exc.detail) is type(expected.detail)
            assert exc.detail == expected.detail
            assert exc.headers == expected.headers
        elif isinstance(expected, Escapes):
            # Recorded defect (P3 latent defect (a) / non-JSON 2xx): the raw
            # exception escapes. Phase 5 changes these cells deliberately.
            with pytest.raises(expected.cls) as escaped:
                await helper.invoke()
            assert not isinstance(escaped.value, HTTPException)
        elif isinstance(expected, Returns):
            result = await helper.invoke()
            assert result == expected.value
            assert type(result) is type(expected.value)
        elif isinstance(expected, Responds):
            result = await helper.invoke()
            assert isinstance(result, JSONResponse)
            assert result.status_code == expected.status
            assert json.loads(bytes(result.body)) == expected.body
        else:
            result = await helper.invoke()
            assert result is produced[-1]

    assert _sent(client_cls, helper).await_count == cell.attempts


def test_matrix_covers_every_scenario_for_every_helper() -> None:
    """Every helper has a cell for every base scenario — no silent gaps."""
    for name, cells in EXPECTED.items():
        assert set(SCENARIOS) <= set(cells), name
        assert set(cells) <= set(SCENARIOS) | set(_EXTRA_SCENARIOS), name
        assert name in HELPERS
    assert set(HELPERS) == set(EXPECTED)


# ---------------------------------------------------------------------------
# The P3 "Bearer sent when" row, plus the URL each helper builds.
# ---------------------------------------------------------------------------

_EXTRA = {"X-Qontinui-User-Id": "user-1"}
_SERVICE = {"Authorization": "Bearer service-token"}

# (id, helper, invoke kwargs, ContextVar module set, expected ``headers=``)
_BEARER_ROWS: list[tuple[str, str, dict[str, Any], Any, Any]] = [
    ("get-no_tenant", "ops_get", {"tenant_id": None}, operations, None),
    ("get-tenant_id", "ops_get", {}, operations, FULL_HEADERS),
    (
        "get-forward_bearer",
        "ops_get",
        {"tenant_id": None, "forward_bearer": True},
        operations,
        FULL_HEADERS,
    ),
    (
        "get-extra_headers_only",
        "ops_get",
        {"tenant_id": None, "headers": _EXTRA},
        operations,
        _EXTRA,
    ),
    (
        "get-tenant_id_plus_extra",
        "ops_get",
        {"headers": _EXTRA},
        operations,
        {**FULL_HEADERS, **_EXTRA},
    ),
    ("post-no_tenant", "ops_post", {"tenant_id": None}, operations, None),
    ("post-tenant_id", "ops_post", {}, operations, FULL_HEADERS),
    (
        "post-forward_bearer",
        "ops_post",
        {"tenant_id": None, "forward_bearer": True},
        operations,
        FULL_HEADERS,
    ),
    ("post_readable-tenant_id", "ops_post_readable", {}, operations, FULL_HEADERS),
    ("patch-no_tenant", "ops_patch", {"tenant_id": None}, operations, None),
    ("patch-tenant_id", "ops_patch", {}, operations, FULL_HEADERS),
    (
        "patch-forward_bearer",
        "ops_patch",
        {"tenant_id": None, "forward_bearer": True},
        operations,
        FULL_HEADERS,
    ),
    # put has no forward_bearer: tenant_id is the only switch.
    ("put-no_tenant", "ops_put", {"tenant_id": None}, operations, None),
    ("put-tenant_id", "ops_put", {}, operations, FULL_HEADERS),
    ("delete-no_tenant", "ops_delete", {"tenant_id": None}, operations, None),
    ("delete-tenant_id", "ops_delete", {}, operations, FULL_HEADERS),
    (
        "delete_with_body-no_tenant",
        "ops_delete_with_body",
        {"tenant_id": None},
        operations,
        None,
    ),
    (
        "delete_with_body-tenant_id",
        "ops_delete_with_body",
        {},
        operations,
        FULL_HEADERS,
    ),
    ("verbatim-always", "ops_verbatim", {}, operations, FULL_HEADERS),
    ("passthrough-always", "ops_passthrough", {}, operations, FULL_HEADERS),
    (
        "passthrough_post-always",
        "ops_passthrough_post",
        {},
        operations,
        FULL_HEADERS,
    ),
    (
        "route_clone_credential-always",
        "ops_route_clone_credential",
        {},
        operations,
        FULL_HEADERS,
    ),
    (
        "agent_registry-always_operations_vars",
        "agent_registry_coord_request",
        {},
        operations,
        FULL_HEADERS,
    ),
    # The private copies read their OWN ContextVars, not operations'.
    ("agent_sessions-own_vars", "agent_sessions_get", {}, agent_sessions, FULL_HEADERS),
    ("agent_sessions-operations_vars_only", "agent_sessions_get", {}, operations, {}),
    (
        "prompt_injections-own_vars",
        "prompt_injections_get",
        {},
        prompt_injections,
        FULL_HEADERS,
    ),
    (
        "prompt_injections-operations_vars_only",
        "prompt_injections_get",
        {},
        operations,
        {},
    ),
    # post_to_coord sends exactly what the caller supplied; ContextVars ignored.
    ("post_to_coord-caller_supplied", "post_to_coord", {}, operations, _SERVICE),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("helper_name", "kwargs", "vars_module", "expected_headers"),
    [pytest.param(*row[1:], id=row[0]) for row in _BEARER_ROWS],
)
async def test_bearer_forwarding(
    helper_name: str,
    kwargs: dict[str, Any],
    vars_module: Any,
    expected_headers: Any,
) -> None:
    """Each row is self-contained: the helper's OWN ContextVars are first
    cleared to ``None`` explicitly, then ``vars_module``'s are set. For the
    ``*-own_vars`` rows the second overrides the first; for the
    ``*-operations_vars_only`` rows it proves the private copy ignores
    operations' vars rather than relying on ambient (unset) state."""
    helper = HELPERS[helper_name]
    with (
        _captured(helper.vars_module, None, None),
        _captured(vars_module),
        _stub_coord(helper, SCENARIOS["ok_200_json"]) as cls,
    ):
        await helper.invoke(**kwargs)
    sent = _sent(cls, helper)
    assert sent.await_count == 1
    assert sent.call_args.kwargs["headers"] == expected_headers


@pytest.mark.asyncio
async def test_no_captured_bearer_sends_empty_headers_on_always_forwarding_helpers() -> (
    None
):
    """An "always" helper with nothing captured sends ``{}``, not ``None``."""
    helper = HELPERS["ops_verbatim"]
    with (
        _captured(operations, None, None),
        _stub_coord(helper, SCENARIOS["ok_200_json"]) as cls,
    ):
        await helper.invoke()
    assert _sent(cls, helper).call_args.kwargs["headers"] == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("helper_name", list(HELPERS))
async def test_url_join(helper_name: str) -> None:
    helper = HELPERS[helper_name]
    with (
        _captured(helper.vars_module),
        _stub_coord(helper, SCENARIOS["ok_200_json"]) as cls,
    ):
        await helper.invoke()
    call = _sent(cls, helper).call_args
    url = call.args[1] if helper.method == "request" else call.args[0]
    if helper_name == "ops_route_clone_credential":
        expected = (
            f"{settings.COORD_URL}/coord/onboarding/installations/clone-credential"
        )
    elif helper_name == "post_to_coord":
        expected = f"{settings.COORD_URL.rstrip('/')}{PATH}"
    else:
        expected = _url()
    assert url == expected


_SLASHED = "http://coord.test/"
# post_to_coord strips a trailing slash off COORD_URL; every other helper
# concatenates f"{COORD_URL}{path}" and so sends a DOUBLE slash.
_SLASHED_DOUBLE = "http://coord.test//coord/contract-probe"
_SLASHED_URLS: dict[str, str] = {
    **dict.fromkeys(HELPERS, _SLASHED_DOUBLE),
    "ops_route_clone_credential": (
        "http://coord.test//coord/onboarding/installations/clone-credential"
    ),
    "post_to_coord": "http://coord.test/coord/contract-probe",
}


@pytest.mark.asyncio
@pytest.mark.parametrize("helper_name", list(HELPERS))
async def test_url_join_trailing_slash_coord_url(helper_name: str) -> None:
    """The URL-join difference with a trailing-slash ``COORD_URL``, pinned."""
    helper = HELPERS[helper_name]
    with (
        patch.object(settings, "COORD_URL", _SLASHED),
        _captured(helper.vars_module),
        _stub_coord(helper, SCENARIOS["ok_200_json"]) as cls,
    ):
        await helper.invoke()
    call = _sent(cls, helper).call_args
    url = call.args[1] if helper.method == "request" else call.args[0]
    assert url == _SLASHED_URLS[helper_name]


def test_slashed_urls_cover_every_helper() -> None:
    assert set(_SLASHED_URLS) == set(HELPERS)


# ---------------------------------------------------------------------------
# What reaches the wire besides headers: params= and json=, verbatim.
# ---------------------------------------------------------------------------

# A list value is a REPEATED key (?kind=a&kind=b) — httpx's own encoding, so
# the dict must reach client.<method>(params=...) unmodified.
PARAMS = {"kind": ["a", "b"], "limit": 5}
_CLONE_URL = f"{settings.COORD_URL}/coord/onboarding/installations/clone-credential"
_POST_TO_COORD_URL = f"{settings.COORD_URL.rstrip('/')}{PATH}"

# (id, helper, invoke kwargs, expected positional args, expected kwargs other
#  than headers, kwarg names whose wire value must be the SAME object passed)
_WIRE_ROWS: list[
    tuple[str, str, dict[str, Any], tuple[Any, ...], dict[str, Any], tuple[str, ...]]
] = [
    ("get-no_params", "ops_get", {}, (_url(),), {"params": None}, ()),
    (
        "get-repeated_key_params",
        "ops_get",
        {"params": PARAMS},
        (_url(),),
        {"params": PARAMS},
        ("params",),
    ),
    (
        "agent_sessions_get-params",
        "agent_sessions_get",
        {"params": PARAMS},
        (_url(),),
        {"params": PARAMS},
        ("params",),
    ),
    (
        "prompt_injections_get-params",
        "prompt_injections_get",
        {"params": PARAMS},
        (_url(),),
        {"params": PARAMS},
        ("params",),
    ),
    ("post-json", "ops_post", {}, (_url(),), {"json": BODY}, ("json",)),
    (
        "post_readable-json",
        "ops_post_readable",
        {},
        (_url(),),
        {"json": BODY},
        ("json",),
    ),
    ("patch-json", "ops_patch", {}, (_url(),), {"json": BODY}, ("json",)),
    ("put-json", "ops_put", {}, (_url(),), {"json": BODY}, ("json",)),
    ("delete-no_params", "ops_delete", {}, (_url(),), {"params": None}, ()),
    (
        "delete-params",
        "ops_delete",
        {"params": PARAMS},
        (_url(),),
        {"params": PARAMS},
        ("params",),
    ),
    (
        "delete_with_body-params_and_json",
        "ops_delete_with_body",
        {"params": PARAMS},
        ("DELETE", _url()),
        {"params": PARAMS, "json": DELETE_BODY},
        ("params", "json"),
    ),
    (
        "verbatim-no_params",
        "ops_verbatim",
        {},
        ("POST", _url()),
        {"params": None, "json": BODY},
        ("json",),
    ),
    (
        "verbatim-params_and_json",
        "ops_verbatim",
        {"params": PARAMS},
        ("POST", _url()),
        {"params": PARAMS, "json": BODY},
        ("params", "json"),
    ),
    # The GET arm sends neither params nor json.
    ("passthrough-get", "ops_passthrough", {}, (_url(),), {}, ()),
    (
        "passthrough_post-body",
        "ops_passthrough_post",
        {},
        (_url(),),
        {"json": BODY},
        ("json",),
    ),
    # ``json=body or {}``: None, and any FALSY body, goes out as {}.
    (
        "passthrough_post-body_none",
        "ops_passthrough_post",
        {"body": None},
        (_url(),),
        {"json": {}},
        (),
    ),
    (
        "passthrough_post-body_falsy_list",
        "ops_passthrough_post",
        {"body": []},
        (_url(),),
        {"json": {}},
        (),
    ),
    (
        "route_clone_credential-json",
        "ops_route_clone_credential",
        {},
        (_CLONE_URL,),
        {"json": {"repo": "owner/name"}},
        (),
    ),
    (
        "agent_registry-no_body",
        "agent_registry_coord_request",
        {},
        ("GET", _url()),
        {"json": None},
        (),
    ),
    (
        "agent_registry-json_body",
        "agent_registry_coord_request",
        {"json_body": BODY},
        ("GET", _url()),
        {"json": BODY},
        ("json",),
    ),
    (
        "post_to_coord-json",
        "post_to_coord",
        {},
        (_POST_TO_COORD_URL,),
        {"json": BODY},
        ("json",),
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("helper_name", "kwargs", "expected_args", "expected_kwargs", "same"),
    [pytest.param(*row[1:], id=row[0]) for row in _WIRE_ROWS],
)
async def test_wire_arguments(
    helper_name: str,
    kwargs: dict[str, Any],
    expected_args: tuple[Any, ...],
    expected_kwargs: dict[str, Any],
    same: tuple[str, ...],
) -> None:
    helper = HELPERS[helper_name]
    with (
        _captured(helper.vars_module),
        _stub_coord(helper, SCENARIOS["ok_200_json"]) as cls,
    ):
        await helper.invoke(**kwargs)
    call = _sent(cls, helper).call_args
    assert call.args == expected_args
    sent_kwargs = {k: v for k, v in call.kwargs.items() if k != "headers"}
    assert sent_kwargs == expected_kwargs
    for key in same:
        # Verbatim: the very object the caller passed, not a re-encoding.
        assert sent_kwargs[key] is expected_kwargs[key], key


# ---------------------------------------------------------------------------
# post_to_coord's retry backoff.
# ---------------------------------------------------------------------------

_BACKOFF_ROWS: list[tuple[str, list[str], list[float]]] = [
    # Three never-reached-coord failures: two sleeps, 0.5 then 1.5.
    *(
        (f"{s}-exhausted", [s, s, s], [0.5, 1.5])
        for s in (
            "connect_error",
            "connect_timeout",
            GATEWAY_502,
            GATEWAY_503,
            GATEWAY_504,
        )
    ),
    # Recovers on the second attempt: one sleep, the first backoff only.
    ("gateway_503-then_ok", [GATEWAY_503, "ok_200_json"], [0.5]),
    ("connect_error-then_ok", ["connect_error", "ok_200_json"], [0.5]),
    # Single-attempt arms never sleep.
    ("ok_200_json-first_try", ["ok_200_json"], []),
    ("read_timeout-no_retry", ["read_timeout"], []),
    ("read_error-no_retry", ["read_error"], []),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sequence", "expected_sleeps"),
    [pytest.param(*row[1:], id=row[0]) for row in _BACKOFF_ROWS],
)
async def test_post_to_coord_backoff_sequence(
    sequence: list[str], expected_sleeps: list[float]
) -> None:
    helper = HELPERS["post_to_coord"]
    factories = {**SCENARIOS, **_EXTRA_SCENARIOS}
    queue = [factories[name] for name in sequence]

    def _next() -> Any:
        return queue.pop(0)()

    sleep = AsyncMock()
    with (
        _captured(helper.vars_module),
        _stub_coord(helper, _next, sleep=sleep) as cls,
    ):
        if sequence[-1] == "ok_200_json":
            # Recovered (or first-try) rows must RETURN coord's response,
            # not raise after the successful attempt.
            result = await helper.invoke()
            assert isinstance(result, httpx.Response)
            assert result.status_code == 200
        else:
            with pytest.raises(HTTPException):
                await helper.invoke()
    assert queue == []
    assert _sent(cls, helper).await_count == len(sequence)
    assert [c.args for c in sleep.await_args_list] == [(s,) for s in expected_sleeps]
    assert all(c.kwargs == {} for c in sleep.await_args_list)


@pytest.mark.asyncio
async def test_backoff_sleep_mock_sees_only_coord_proxy_sleeps() -> None:
    """A sleep awaited OUTSIDE coord_proxy while the stub is active must reach
    the real ``asyncio.sleep``, not the backoff mock. Patched on the
    process-wide module, ANY such sleep (here a task's; in the 2026-10-06
    flake, a leftover background poll) was recorded by the mock and broke the
    exact backoff assert above."""
    helper = HELPERS["post_to_coord"]
    queue = [SCENARIOS["connect_error"]] * 3

    def _next() -> Any:
        return queue.pop(0)()

    sleep = AsyncMock()
    with _captured(helper.vars_module), _stub_coord(helper, _next, sleep=sleep):
        await asyncio.create_task(asyncio.sleep(0.01))
        with pytest.raises(HTTPException):
            await helper.invoke()
    assert [c.args for c in sleep.await_args_list] == [(0.5,), (1.5,)]


# ---------------------------------------------------------------------------
# invoke must forward kwargs, never swallow them.
# ---------------------------------------------------------------------------


# post_to_coord takes ``**log_fields``: an unknown kwarg is FORWARDED and lands
# as a structured-log field by design, so it cannot raise. Pinned below
# instead — it reaches neither the wire nor the client constructor.
_ABSORBS_UNKNOWN_KWARGS = {"post_to_coord"}


@pytest.mark.asyncio
@pytest.mark.parametrize("helper_name", list(HELPERS))
async def test_invoke_rejects_unknown_kwargs(helper_name: str) -> None:
    """A kwarg the helper does not take raises TypeError — a future row
    cannot silently believe it set an option that was dropped."""
    helper = HELPERS[helper_name]
    with (
        _captured(helper.vars_module),
        _stub_coord(helper, SCENARIOS["ok_200_json"]) as cls,
    ):
        if helper_name in _ABSORBS_UNKNOWN_KWARGS:
            await helper.invoke(no_such_option=True)
        else:
            with pytest.raises(TypeError):
                await helper.invoke(no_such_option=True)
    sent = _sent(cls, helper)
    if helper_name in _ABSORBS_UNKNOWN_KWARGS:
        assert sent.await_count == 1
        assert "no_such_option" not in sent.call_args.kwargs
        assert "no_such_option" not in cls.call_args.kwargs
    else:
        assert sent.await_count == 0


# ---------------------------------------------------------------------------
# Timeout handed to the httpx.AsyncClient constructor.
# ---------------------------------------------------------------------------

_FIVE = httpx.Timeout(5.0)
_TIMEOUT_ROWS: list[tuple[str, str, dict[str, Any], Any]] = [
    ("get-default", "ops_get", {}, _FIVE),
    (
        "get-override",
        "ops_get",
        {"timeout": operations._COORD_PR_LIST_TIMEOUT},
        operations._COORD_PR_LIST_TIMEOUT,
    ),
    ("post-default", "ops_post", {}, _FIVE),
    (
        "post-override",
        "ops_post",
        {"timeout": operations._COORD_MERGED_READ_TIMEOUT},
        operations._COORD_MERGED_READ_TIMEOUT,
    ),
    ("post_readable", "ops_post_readable", {}, _FIVE),
    ("patch", "ops_patch", {}, _FIVE),
    ("put", "ops_put", {}, _FIVE),
    ("delete", "ops_delete", {}, _FIVE),
    ("delete_with_body", "ops_delete_with_body", {}, _FIVE),
    ("verbatim", "ops_verbatim", {}, _FIVE),
    ("passthrough", "ops_passthrough", {}, _FIVE),
    ("passthrough_post", "ops_passthrough_post", {}, _FIVE),
    ("route_clone_credential", "ops_route_clone_credential", {}, _FIVE),
    ("agent_registry", "agent_registry_coord_request", {}, _FIVE),
    ("agent_sessions", "agent_sessions_get", {}, _FIVE),
    ("prompt_injections", "prompt_injections_get", {}, _FIVE),
    # post_to_coord passes a bare float, not an httpx.Timeout.
    ("post_to_coord", "post_to_coord", {}, 10.0),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("helper_name", "kwargs", "expected_timeout"),
    [pytest.param(*row[1:], id=row[0]) for row in _TIMEOUT_ROWS],
)
async def test_client_timeout(
    helper_name: str, kwargs: dict[str, Any], expected_timeout: Any
) -> None:
    helper = HELPERS[helper_name]
    with (
        _captured(helper.vars_module),
        _stub_coord(helper, SCENARIOS["ok_200_json"]) as cls,
    ):
        await helper.invoke(**kwargs)
    assert cls.call_count == 1
    timeout = cls.call_args.kwargs["timeout"]
    assert type(timeout) is type(expected_timeout)
    assert timeout == expected_timeout


def test_timeout_rows_cover_every_helper() -> None:
    covered = {row[1] for row in _TIMEOUT_ROWS}
    # The flag variants share their base helper's constructor call.
    assert covered | {
        "ops_get_structured_errors",
        "ops_post_structured_errors",
        "ops_post_return_status",
        "ops_post_non_json_success_as_empty",
    } == set(HELPERS)
