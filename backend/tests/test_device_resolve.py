"""Coord's device resolver, as the web backend forwards and consumes it.

Plan ``2026-09-20-runner-selector-drives-a-transport-not-a-target`` Phase 3.

* ``POST /api/v1/devices/resolve`` forwards to coord's
  ``POST /coord/devices/resolve`` AS the caller: the caller's bearer is
  forwarded, and **no ``user_id`` ever leaves** — not in the body (coord
  refuses one 400), not as ``x-qontinui-user-id`` (coord ignores it here).
* Each of coord's five outcomes is passed through typed; every way of NOT
  getting coord's answer is ``unavailable`` (UNKNOWN), never a pick.
* The dispatcher's ``target="auto"`` delegates to the resolver, keeps the
  deploy-state join only as a post-filter over coord's eligibility, and has
  NO fallback ordering when the resolver is unavailable — for ANY caller.
* A BACKGROUND caller (scheduled dispatch) has no bearer of its own: it names
  the schedule's owner, a bearer acting for that user is minted from coord's
  ``POST /coord/auth/service-acting-user-token``, and the same resolver is
  asked with it. A failed mint is a typed refusal and the resolver is then
  not asked (plan
  ``2026-09-23-runner-selector-follow-ups-drain-aware-background-dispatch-and-typed-instances``
  Phase 1). A refusal carries coord's own ``error`` string and HTTP status
  to the operator; a stale web service token is re-minted once; and on a
  split-coord box nothing is minted at all.
* A coord build WITHOUT a door answers from its router fallback (``404
  no_such_route`` / ``405 method_not_allowed``): that is ``not_deployed``,
  never ``refused``.
* A due-rows sweep in which two consecutive ``target="auto"`` rows could not
  reach coord does not ask it again for the ``target="auto"`` rows behind
  them. One such row is not enough, a row coord answers starts the count
  over, and a row that names its runner neither counts nor resets.

Coord is mocked at each module's own ``httpx.AsyncClient``; no live coord is
needed.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any, Literal, cast
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.jobs import scheduled_dispatch
from app.schemas.device_resolve import (
    DeviceResolveRequest,
    NoCapableDeviceOutcome,
    PinIneligibleOutcome,
    ResolvedOutcome,
    UnavailableOutcome,
)
from app.services import (
    coord_device_resolve,
    coord_service_account,
    workflow_dispatcher,
)
from app.services.coord_device_resolve import CoordCaller, resolve_device
from app.services.coord_service_account import CoordServiceAccountClient
from app.services.workflow_dispatcher import (
    AutoPickRefusal,
    DispatchError,
    _pick_auto_runner,
    dispatch_to_fresh_host,
    dispatch_workflow_to_runner,
)

DEVICE_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
DEVICE_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
DEVICE_C = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
USER = UUID("11111111-1111-4111-8111-111111111111")
OTHER_USER = UUID("22222222-2222-4222-8222-222222222222")
BEARER = "caller-cognito-token"
CALLER = CoordCaller(bearer=BEARER, active_tenant="tenant-xyz")

# Sync (TestClient) tests in this module ignore the marker.
pytestmark = pytest.mark.asyncio(loop_scope="function")


# ---------------------------------------------------------------------------
# A recording fake for httpx.AsyncClient
# ---------------------------------------------------------------------------


def _fake_client(route: Callable[[str, Any, Any, Any], Any]) -> type:
    """An ``httpx.AsyncClient`` stand-in whose every ``post`` goes to
    ``route(url, json, headers, timeout)``. A route may answer with the
    response or with an awaitable of it (a door that holds its callers)."""

    class _FakeClient:
        def __init__(self, *a: Any, timeout: Any = None, **kw: Any) -> None:
            self.timeout = timeout

        async def __aenter__(self) -> _FakeClient:
            return self

        async def __aexit__(self, *a: Any) -> bool:
            return False

        async def post(
            self, url: str, *, json: Any = None, headers: Any = None
        ) -> httpx.Response:
            answer = route(url, json, headers, self.timeout)
            if inspect.isawaitable(answer):
                answer = await answer
            return cast(httpx.Response, answer)

    return _FakeClient


class _HttpxWith:
    """ONE module's ``httpx`` with only ``AsyncClient`` replaced.

    Installed as that module's ``httpx`` name, so the real ``httpx`` — and
    every other module's client — is untouched, and a test can tell which
    module's client reached which door.
    """

    def __init__(self, client: type) -> None:
        self.AsyncClient = client

    def __getattr__(self, name: str) -> Any:
        return getattr(httpx, name)


class _Coord:
    """Stands in for coord: records every request, answers from a script."""

    def __init__(
        self,
        status: int = 200,
        body: Any = None,
        *,
        raise_exc: Exception | None = None,
        text: str | None = None,
    ) -> None:
        self.status = status
        self.body = body
        self.raise_exc = raise_exc
        self.text = text
        self.calls: list[dict[str, Any]] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Be the resolver: the only coord door an interactive caller asks."""
        monkeypatch.setattr(
            coord_device_resolve, "httpx", _HttpxWith(_fake_client(self.respond))
        )

    def respond(
        self, url: str, json: Any, headers: Any, timeout: Any = None
    ) -> httpx.Response:
        self.calls.append(
            {"url": url, "json": json, "headers": headers, "timeout": timeout}
        )
        return self.reply(url, json)

    def reply(self, url: str, json: Any) -> httpx.Response:
        if self.raise_exc is not None:
            raise self.raise_exc
        request = httpx.Request("POST", url)
        if self.text is not None:
            return httpx.Response(self.status, text=self.text, request=request)
        body = self.body(json) if callable(self.body) else self.body
        return httpx.Response(self.status, json=body, request=request)


class _InTurn(_Coord):
    """A door that answers from each of ``answers`` in turn; the last repeats."""

    def __init__(self, *answers: _Coord) -> None:
        super().__init__()
        self.answers = answers

    def reply(self, url: str, json: Any) -> httpx.Response:
        # ``respond`` has already recorded this call.
        nth = min(len(self.calls), len(self.answers)) - 1
        return self.answers[nth].reply(url, json)


def _no_such_route(path: str) -> dict[str, Any]:
    """The body of coord's router fallback for a path the running build does
    not serve (qontinui-coord ``doors.rs`` ``no_such_route``), sent ``404``."""
    return {
        "error": "no_such_route",
        "method": "POST",
        "path": path,
        "message": (
            "no route is registered at this path. This is a statement about "
            "the PATH, not about your credential and not about the "
            "capability: read did_you_mean, or enumerate the catalog."
        ),
        "did_you_mean": [
            {"method": "GET", "path": "/coord/devices", "admits": "device|agent"}
        ],
        "catalog": _CATALOG_POINTER,
    }


def _method_not_allowed(path: str) -> dict[str, Any]:
    """The body of coord's method-not-allowed fallback (``doors.rs``
    ``method_not_allowed``), sent ``405``: the path exists, ``POST`` does not."""
    return {
        "error": "method_not_allowed",
        "method": "POST",
        "path": path,
        "allowed": [{"method": "GET", "path": path, "admits": "device|agent"}],
        "catalog": _CATALOG_POINTER,
    }


_CATALOG_POINTER = {
    "http": "GET /coord/agent-doors (device|agent JWT; ?prefix=&resource=)",
    "mcp": 'coord_can(action="list_doors", prefix?, resource?)',
}


def _placeable(**kw: Any) -> DeviceResolveRequest:
    return DeviceResolveRequest(
        required_capabilities=kw.pop("required_capabilities", []),
        work_class=kw.pop("work_class", "placeable"),
        **kw,
    )


def _assert_no_user_id_sent(call: dict[str, Any]) -> None:
    assert "user_id" not in call["json"], call["json"]
    lowered = {k.lower() for k in call["headers"]}
    assert "x-qontinui-user-id" not in lowered, call["headers"]


# ---------------------------------------------------------------------------
# The service: forwarding + outcome mapping
# ---------------------------------------------------------------------------


async def test_forwards_the_callers_bearer_and_never_a_user_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    coord = _Coord(
        body={
            "outcome": "resolved",
            "device_id": str(DEVICE_A),
            "via": "pin",
            "pin_released_reason": None,
            "pin_released_detail": None,
        }
    )
    coord.install(monkeypatch)

    out = await resolve_device(
        _placeable(required_capabilities=["os:linux"], preferred_device=DEVICE_A),
        CALLER,
    )

    assert isinstance(out, ResolvedOutcome)
    assert out.device_id == DEVICE_A and out.via == "pin"
    (call,) = coord.calls
    assert call["url"].endswith("/coord/devices/resolve")
    assert call["headers"]["Authorization"] == f"Bearer {BEARER}"
    assert call["headers"]["X-Qontinui-Active-Tenant"] == "tenant-xyz"
    assert call["json"] == {
        "required_capabilities": ["os:linux"],
        "preferred_device": str(DEVICE_A),
        "work_class": "placeable",
    }
    _assert_no_user_id_sent(call)


async def test_an_absent_pin_is_absent_not_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    coord = _Coord(body={"outcome": "drain_unreadable"})
    coord.install(monkeypatch)
    await resolve_device(_placeable(), CALLER)
    assert coord.calls[0]["json"] == {
        "required_capabilities": [],
        "work_class": "placeable",
    }


@pytest.mark.parametrize(
    "body",
    [
        {
            "outcome": "resolved",
            "device_id": str(DEVICE_B),
            "via": "pool",
            "pin_released_reason": "offline",
            "pin_released_detail": "device … has not sent a heartbeat",
        },
        {
            "outcome": "pin_ineligible",
            "device_id": str(DEVICE_A),
            "reason": "missing_capabilities",
            "detail": "device … does not advertise: shell:powershell",
            "missing_capabilities": ["shell:powershell"],
        },
        {
            "outcome": "no_capable_device",
            "missing": ["os:windows"],
            "online_devices": 2,
            "pin_released_reason": None,
            "pin_released_detail": None,
        },
        {
            "outcome": "all_capable_drained",
            "pin_released_reason": None,
            "pin_released_detail": None,
        },
        {"outcome": "drain_unreadable"},
    ],
    ids=lambda b: b["outcome"],
)
async def test_each_coord_outcome_passes_through_typed(
    monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]
) -> None:
    _Coord(body=body).install(monkeypatch)
    out = await resolve_device(_placeable(), CALLER)
    assert out.model_dump(mode="json") == body


async def test_no_bearer_is_unavailable_and_coord_is_not_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    coord = _Coord(body={"outcome": "drain_unreadable"})
    coord.install(monkeypatch)
    out = await resolve_device(_placeable(), CoordCaller(bearer=None))
    assert out == UnavailableOutcome(reason="no_credential")
    assert coord.calls == []


@pytest.mark.parametrize(
    ("coord", "reason", "status", "code"),
    [
        (
            _Coord(raise_exc=httpx.ConnectError("refused")),
            "coord_unreachable",
            None,
            None,
        ),
        (_Coord(raise_exc=httpx.ReadTimeout("slow")), "coord_unreachable", None, None),
        # A coord build without the door answers from its router fallback.
        (
            _Coord(404, _no_such_route("/coord/devices/resolve")),
            "not_deployed",
            404,
            "no_such_route",
        ),
        (
            _Coord(405, _method_not_allowed("/coord/devices/resolve")),
            "not_deployed",
            405,
            "method_not_allowed",
        ),
        # Something in front of coord answered: no ``error`` string at all.
        (_Coord(404, text="Not Found"), "not_deployed", 404, None),
        (_Coord(405, text=""), "not_deployed", 405, None),
        # Any OTHER string on a 404/405 is the door itself answering.
        (
            _Coord(404, {"error": "device_not_found"}),
            "refused",
            404,
            "device_not_found",
        ),
        (_Coord(405, {"error": "read_only"}), "refused", 405, "read_only"),
        # An interactive caller's bearer that cannot be written as a header.
        (
            _Coord(raise_exc=UnicodeEncodeError("ascii", "tök", 1, 2, "not ascii")),
            "no_credential",
            None,
            None,
        ),
        (
            _Coord(raise_exc=httpx.LocalProtocolError("illegal header value")),
            "no_credential",
            None,
            None,
        ),
        (
            _Coord(500, {"error": "device_resolve_failed"}),
            "upstream_error",
            500,
            "device_resolve_failed",
        ),
        (_Coord(503, text="<html>bad gateway</html>"), "upstream_error", 503, None),
        (
            _Coord(403, {"error": "principal_not_accepted"}),
            "refused",
            403,
            "principal_not_accepted",
        ),
        (
            _Coord(400, {"error": "user_id_not_accepted"}),
            "refused",
            400,
            "user_id_not_accepted",
        ),
        (_Coord(200, {"outcome": "teleported"}), "malformed_response", 200, None),
        (_Coord(200, text="not json"), "malformed_response", 200, None),
    ],
    ids=[
        "connect_error",
        "timeout",
        "404_no_such_route_not_deployed",
        "405_method_not_allowed_not_deployed",
        "404_no_error_string_not_deployed",
        "405_no_error_string_not_deployed",
        "404_other_string_refused",
        "405_other_string_refused",
        "unencodable_bearer",
        "illegal_header_value",
        "500",
        "503_html",
        "403",
        "400",
        "unknown_outcome",
        "non_json",
    ],
)
async def test_every_failure_to_get_an_answer_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    coord: _Coord,
    reason: str,
    status: int | None,
    code: str | None,
) -> None:
    coord.install(monkeypatch)
    out = await resolve_device(_placeable(), CALLER)
    assert out.model_dump() == {
        "outcome": "unavailable",
        "reason": reason,
        "status": status,
        "code": code,
    }


async def test_an_unresolvable_coord_base_is_unavailable_misconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom() -> str:
        raise RuntimeError("COORD_URL unset")

    coord = _Coord(body={"outcome": "drain_unreadable"})
    coord.install(monkeypatch)
    monkeypatch.setattr(coord_device_resolve, "coord_device_base", _boom)
    out = await resolve_device(_placeable(), CALLER)
    assert out.model_dump() == {
        "outcome": "unavailable",
        "reason": "misconfigured",
        "status": None,
        "code": None,
    }
    assert coord.calls == []


@pytest.mark.parametrize(
    "exc",
    [httpx.InvalidURL("bad"), httpx.UnsupportedProtocol("no scheme")],
    ids=["invalid_url", "unsupported_protocol"],
)
async def test_a_bad_coord_url_is_unavailable_misconfigured(
    monkeypatch: pytest.MonkeyPatch, exc: Exception
) -> None:
    _Coord(raise_exc=exc).install(monkeypatch)
    out = await resolve_device(_placeable(), CALLER)
    assert out == UnavailableOutcome(reason="misconfigured", status=None, code=None)


async def test_an_empty_coord_base_is_misconfigured_with_real_httpx(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No fake client: a real httpx call against an empty base URL."""
    monkeypatch.setattr(coord_device_resolve, "coord_device_base", lambda: "")
    out = await resolve_device(_placeable(), CALLER)
    assert out.model_dump()["reason"] == "misconfigured"


# ---------------------------------------------------------------------------
# The endpoint: POST /api/v1/devices/resolve
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> TestClient:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.device_resolve import router

    app = FastAPI()
    user = MagicMock()
    user.id = USER
    user.is_active = True
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.include_router(router, prefix="/api/v1/devices")
    return TestClient(app)


def test_endpoint_forwards_as_the_caller_and_returns_the_outcome(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    body = {
        "outcome": "resolved",
        "device_id": str(DEVICE_A),
        "via": "pool",
        "pin_released_reason": None,
        "pin_released_detail": None,
    }
    coord = _Coord(body=body)
    coord.install(monkeypatch)

    resp = client.post(
        "/api/v1/devices/resolve",
        json={"required_capabilities": [], "work_class": "placeable"},
        headers={"Authorization": f"Bearer {BEARER}"},
    )

    assert resp.status_code == 200
    assert resp.json() == body
    (call,) = coord.calls
    assert call["headers"]["Authorization"] == f"Bearer {BEARER}"
    _assert_no_user_id_sent(call)


def test_endpoint_forwards_the_cookie_bearer(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    coord = _Coord(body={"outcome": "drain_unreadable"})
    coord.install(monkeypatch)
    client.cookies.set("access_token", "cookie-token")
    resp = client.post(
        "/api/v1/devices/resolve",
        json={"required_capabilities": [], "work_class": "machine_bound"},
    )
    assert resp.json() == {"outcome": "drain_unreadable"}
    assert coord.calls[0]["headers"]["Authorization"] == "Bearer cookie-token"


def test_endpoint_answers_unavailable_with_200_before_coord_deploys(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    """Coord's real answer for a door its build does not have."""
    _Coord(404, _no_such_route("/coord/devices/resolve")).install(monkeypatch)
    resp = client.post(
        "/api/v1/devices/resolve",
        json={"required_capabilities": [], "work_class": "placeable"},
        headers={"Authorization": f"Bearer {BEARER}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "outcome": "unavailable",
        "reason": "not_deployed",
        "status": 404,
        "code": "no_such_route",
    }


def test_endpoint_answers_unavailable_for_a_404_with_no_error_string(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    _Coord(404, text="Not Found").install(monkeypatch)
    resp = client.post(
        "/api/v1/devices/resolve",
        json={"required_capabilities": [], "work_class": "placeable"},
        headers={"Authorization": f"Bearer {BEARER}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "outcome": "unavailable",
        "reason": "not_deployed",
        "status": 404,
        "code": None,
    }


@pytest.mark.parametrize(
    "payload",
    [
        {
            "required_capabilities": [],
            "work_class": "placeable",
            "user_id": str(uuid4()),
        },
        {"required_capabilities": [], "work_class": "placeable", "user_id": None},
        {"work_class": "placeable"},  # required_capabilities is not optional
        {"required_capabilities": [], "work_class": "anywhere"},
    ],
    ids=["user_id", "null_user_id", "no_capabilities", "bad_work_class"],
)
def test_endpoint_refuses_a_bad_body_without_asking_coord(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, payload: dict[str, Any]
) -> None:
    coord = _Coord(body={"outcome": "drain_unreadable"})
    coord.install(monkeypatch)
    resp = client.post(
        "/api/v1/devices/resolve",
        json=payload,
        headers={"Authorization": f"Bearer {BEARER}"},
    )
    assert resp.status_code == 422
    assert coord.calls == []


# ---------------------------------------------------------------------------
# The dispatcher: target="auto" delegates; deploy state is a post-filter
# ---------------------------------------------------------------------------


def _device(device_id: UUID, user_id: UUID = USER) -> SimpleNamespace:
    return SimpleNamespace(
        device_id=device_id,
        user_id=user_id,
        ws_session_id=None,
        hostname="h",
        port=9876,
    )


class _RefusingDb:
    """A session that fails the test if any query runs — proves the old
    heartbeat-ordered query is gone."""

    async def execute(self, *a: Any, **kw: Any) -> Any:
        raise AssertionError("no web-side device query may run here")


class _FreshDb:
    """A session whose one query (the deploy-state join) returns ``devices``."""

    def __init__(self, devices: list[SimpleNamespace]) -> None:
        self.devices = devices

    async def execute(self, *a: Any, **kw: Any) -> Any:
        devices = self.devices
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: list(devices))
        )


class _Resolver:
    """Scripted stand-in for ``resolve_device`` inside the dispatcher."""

    def __init__(self, answer: Any) -> None:
        self.answer = answer
        self.requests: list[DeviceResolveRequest] = []
        self.callers: list[CoordCaller] = []

    async def __call__(self, request: DeviceResolveRequest, caller: CoordCaller) -> Any:
        self.requests.append(request)
        self.callers.append(caller)
        return self.answer(request) if callable(self.answer) else self.answer


def _install(
    monkeypatch: pytest.MonkeyPatch,
    resolver: _Resolver,
    owned: dict[UUID, SimpleNamespace],
) -> None:
    monkeypatch.setattr(workflow_dispatcher, "resolve_device", resolver)

    async def _by_id(db: Any, runner_id: UUID) -> SimpleNamespace | None:
        return owned.get(runner_id)

    monkeypatch.setattr(workflow_dispatcher, "_get_runner_by_id", _by_id)


def _resolved(
    device_id: UUID | None, via: Literal["pin", "pool"] = "pool"
) -> ResolvedOutcome:
    assert device_id is not None
    return ResolvedOutcome(device_id=device_id, via=via)


async def test_auto_pick_is_coords_placeable_pool_pick(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = _Resolver(_resolved(DEVICE_B))
    _install(monkeypatch, resolver, {DEVICE_B: _device(DEVICE_B)})

    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CALLER,
        required_capabilities=[],
    )

    assert getattr(picked, "device_id", None) == DEVICE_B
    (req,) = resolver.requests
    assert req.work_class == "placeable"
    assert req.preferred_device is None
    assert req.required_capabilities == []
    assert resolver.callers == [CALLER]


async def test_auto_pick_refuses_when_the_resolver_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = _Resolver(UnavailableOutcome(reason="not_deployed", status=404))
    # A device exists and is owned; the old code would have found it by
    # heartbeat order. _RefusingDb proves no such query runs.
    _install(monkeypatch, resolver, {DEVICE_A: _device(DEVICE_A)})

    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CALLER,
        required_capabilities=[],
    )

    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "device_resolver_unavailable"


async def test_auto_pick_refuses_a_resolved_device_the_user_does_not_own(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(
        monkeypatch,
        _Resolver(_resolved(DEVICE_C)),
        {DEVICE_C: _device(DEVICE_C, user_id=uuid4())},
    )
    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CALLER,
        required_capabilities=[],
    )
    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "resolved_device_not_owned"
    # The foreign device id is never echoed back to the caller.
    body = str(picked.to_dispatch_error().detail)
    assert str(DEVICE_C) not in body
    assert "resolver_outcome" not in body


async def test_auto_pick_maps_no_capable_device(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(
        monkeypatch,
        _Resolver(NoCapableDeviceOutcome(missing=[], online_devices=0)),
        {},
    )
    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CALLER,
        required_capabilities=[],
    )
    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "no_healthy_runner"


async def test_fresh_host_post_filters_deploy_state_through_coord_eligibility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A and B are fresh (newest deploy first); A is offline per coord.
    def answer(req: DeviceResolveRequest) -> Any:
        assert req.work_class == "machine_bound"
        if req.preferred_device == DEVICE_A:
            return PinIneligibleOutcome(
                device_id=DEVICE_A, reason="offline", detail="stale heartbeat"
            )
        return _resolved(req.preferred_device, via="pin")

    resolver = _Resolver(answer)
    _install(
        monkeypatch,
        resolver,
        {DEVICE_A: _device(DEVICE_A), DEVICE_B: _device(DEVICE_B)},
    )
    db = cast(AsyncSession, _FreshDb([_device(DEVICE_A), _device(DEVICE_B)]))

    picked = await dispatch_to_fresh_host(cast(AsyncSession, db), USER, "app", CALLER)

    assert getattr(picked, "device_id", None) == DEVICE_B
    assert [r.preferred_device for r in resolver.requests] == [DEVICE_A, DEVICE_B]


async def test_fresh_only_never_returns_coords_pool_pick_of_a_stale_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def answer(req: DeviceResolveRequest) -> Any:
        if req.preferred_device is not None:
            return PinIneligibleOutcome(
                device_id=req.preferred_device, reason="drained", detail="drained"
            )
        return _resolved(DEVICE_C)  # an eligible but NOT fresh host

    _install(monkeypatch, _Resolver(answer), {DEVICE_C: _device(DEVICE_C)})

    fresh_only = await dispatch_to_fresh_host(
        cast(AsyncSession, _FreshDb([_device(DEVICE_A)])),
        USER,
        "app",
        CALLER,
        strategy="fresh_only",
    )
    assert fresh_only is None

    best_effort = await dispatch_to_fresh_host(
        cast(AsyncSession, _FreshDb([_device(DEVICE_A)])),
        USER,
        "app",
        CALLER,
        strategy="best_effort",
    )
    assert getattr(best_effort, "device_id", None) == DEVICE_C


async def test_fresh_host_unavailable_resolver_is_a_refusal_not_a_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = _Resolver(UnavailableOutcome(reason="coord_unreachable"))
    _install(monkeypatch, resolver, {DEVICE_A: _device(DEVICE_A)})

    picked = await dispatch_to_fresh_host(
        cast(AsyncSession, _FreshDb([_device(DEVICE_A)])),
        USER,
        "app",
        CALLER,
    )

    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "device_resolver_unavailable"
    # It stopped at the first UNKNOWN: no best_effort pool fallback either.
    assert len(resolver.requests) == 1


async def test_an_unknown_resolver_refuses_an_interactive_auto_dispatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With a bearer, an UNKNOWN resolver is a refusal — there is nothing to
    fall back on, and no device query runs."""
    _Coord(404, text="Not Found").install(monkeypatch)

    async def _owned_workflow(*a: Any, **kw: Any) -> object:
        return object()

    monkeypatch.setattr(workflow_dispatcher, "_get_owned_workflow", _owned_workflow)

    with pytest.raises(DispatchError) as err:
        await dispatch_workflow_to_runner(
            cast(AsyncSession, _RefusingDb()),
            user_id=USER,
            workflow_id=uuid4(),
            target="auto",
            caller=CALLER,
        )
    assert err.value.status_code == 503
    assert err.value.code == "device_resolver_unavailable"
    assert err.value.detail["resolver_outcome"]["reason"] == "not_deployed"


# ---------------------------------------------------------------------------
# A background caller (a scheduled run): mint for the owner, then ask coord
# ---------------------------------------------------------------------------

SERVICE_TOKEN = "web-service-token"
SERVICE_TOKEN_PATH = "/coord/auth/service-token"
MINT_PATH = "/coord/auth/service-acting-user-token"
RESOLVE_PATH = "/coord/devices/resolve"

DRAINED = {
    "outcome": "all_capable_drained",
    "pin_released_reason": None,
    "pin_released_detail": None,
}


def _acting_token(user_id: UUID | str) -> str:
    return f"acting-token-for-{user_id}"


def _minted(sent: dict[str, Any]) -> dict[str, Any]:
    """Coord's 200 from the mint door: a token naming the user in the body."""
    return {
        "token": _acting_token(sent["user_id"]),
        "acting_user": sent["user_id"],
        "tenant_id": "tenant-of-that-user",
        "jti": str(uuid4()),
        "exp": int(time.time()) + 300,
    }


def _resolved_body(device_id: UUID) -> dict[str, Any]:
    return {
        "outcome": "resolved",
        "device_id": str(device_id),
        "via": "pool",
        "pin_released_reason": None,
        "pin_released_detail": None,
    }


def _service_token(token: str = SERVICE_TOKEN) -> dict[str, Any]:
    """Coord's 200 from web's own service-token door."""
    return {"token": token, "sub": "service:web", "exp": int(time.time()) + 4 * 3600}


class _Doors:
    """Coord's three doors a background resolve crosses, each scripted.

    ``service_token`` is web's own service-token mint, ``mint`` the
    acting-user mint, ``resolve`` the device resolver. Every request is
    recorded on the door it reached, so a test can prove which were (and
    were not) asked, and with what bearer.

    The two mints are reachable only through ``coord_service_account``'s
    client and the resolver only through ``coord_device_resolve``'s: a
    request from the wrong module fails the test.

    ``device_url`` is ``COORD_DEVICE_URL``; ``COORD_URL`` is
    ``http://coord.test``. The default (unset) is a single-coord box.
    """

    COORD_URL = "http://coord.test"

    def __init__(
        self,
        *,
        mint: _Coord | None = None,
        resolve: _Coord | None = None,
        service_token: _Coord | None = None,
        admin_secret: str | None = "s3cret",
        device_url: str | None = None,
    ) -> None:
        self.mint = mint or _Coord(body=_minted)
        self.resolve = resolve or _Coord(body=_resolved_body(DEVICE_B))
        self.service_token = service_token or _Coord(body=_service_token())
        self.admin_secret = admin_secret
        self.device_url = device_url

    @staticmethod
    def _router(
        doors: dict[str, _Coord],
    ) -> Callable[[str, Any, Any, Any], httpx.Response]:
        def route(url: str, json: Any, headers: Any, timeout: Any) -> httpx.Response:
            for path, door in doors.items():
                if url.endswith(path):
                    return door.respond(url, json, headers, timeout)
            raise AssertionError(f"unexpected coord url from this module: {url}")

        return route

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "COORD_URL", self.COORD_URL)
        monkeypatch.setattr(settings, "COORD_DEVICE_URL", self.device_url)
        monkeypatch.setattr(
            coord_service_account,
            "httpx",
            _HttpxWith(
                _fake_client(
                    self._router(
                        {SERVICE_TOKEN_PATH: self.service_token, MINT_PATH: self.mint}
                    )
                )
            ),
        )
        monkeypatch.setattr(
            coord_device_resolve,
            "httpx",
            _HttpxWith(_fake_client(self._router({RESOLVE_PATH: self.resolve}))),
        )
        # A fresh, ENABLED service account per test: the process singleton is
        # off here (no COORD_ADMIN_SECRET) and would hold a token across tests.
        monkeypatch.setattr(
            coord_device_resolve,
            "coord_service_account",
            CoordServiceAccountClient(
                coord_url=self.COORD_URL,
                admin_secret=self.admin_secret,
                service_name="web",
            ),
        )


def _own_workflow(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _owned_workflow(*a: Any, **kw: Any) -> object:
        return object()

    monkeypatch.setattr(workflow_dispatcher, "_get_owned_workflow", _owned_workflow)


async def test_a_background_resolve_mints_for_its_user_and_forwards_that_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors()
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert isinstance(out, ResolvedOutcome) and out.device_id == DEVICE_B
    # The mint: web's service bearer, the user in the BODY, no identity header.
    (mint,) = doors.mint.calls
    assert mint["url"] == f"http://coord.test{MINT_PATH}"
    assert mint["json"] == {"user_id": str(USER)}
    assert mint["headers"] == {"Authorization": f"Bearer {SERVICE_TOKEN}"}
    # The resolve: asked AS the minted token, never as the service token.
    (call,) = doors.resolve.calls
    assert call["headers"] == {"Authorization": f"Bearer {_acting_token(USER)}"}
    _assert_no_user_id_sent(call)
    # The mint request and the resolve request are each made with their own
    # ``httpx.Timeout(5.0)``: 5 s for each phase of that one request, not a
    # total shared between the two. Web's service-token mint is not given
    # it and keeps its own 10 s.
    assert mint["timeout"] == call["timeout"] == httpx.Timeout(5.0)
    (service_token,) = doors.service_token.calls
    assert service_token["timeout"] == 10.0


async def test_a_scheduled_auto_pick_asks_coord_as_the_schedule_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The pick is coord's. ``_RefusingDb`` proves no web-side device query
    chooses the runner for a background caller any more."""
    doors = _Doors(resolve=_Coord(body=_resolved_body(DEVICE_B)))
    doors.install(monkeypatch)

    async def _by_id(db: Any, runner_id: UUID) -> SimpleNamespace | None:
        return {DEVICE_B: _device(DEVICE_B)}.get(runner_id)

    monkeypatch.setattr(workflow_dispatcher, "_get_runner_by_id", _by_id)

    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CoordCaller.background_for(USER),
        required_capabilities=[],
    )

    assert getattr(picked, "device_id", None) == DEVICE_B
    assert [c["json"] for c in doors.mint.calls] == [{"user_id": str(USER)}]
    (call,) = doors.resolve.calls
    assert call["headers"]["Authorization"] == f"Bearer {_acting_token(USER)}"
    assert call["json"] == {"required_capabilities": [], "work_class": "placeable"}


async def test_the_mint_names_each_owner_and_no_token_is_reused_across_users(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors()
    doors.install(monkeypatch)

    await resolve_device(_placeable(), CoordCaller.background_for(USER))
    await resolve_device(_placeable(), CoordCaller.background_for(OTHER_USER))
    await resolve_device(_placeable(), CoordCaller.background_for(USER))

    # One mint per resolve — nothing is cached, even for the same user.
    assert [c["json"] for c in doors.mint.calls] == [
        {"user_id": str(USER)},
        {"user_id": str(OTHER_USER)},
        {"user_id": str(USER)},
    ]
    # Each resolve carries the token minted for ITS user.
    assert [c["headers"]["Authorization"] for c in doors.resolve.calls] == [
        f"Bearer {_acting_token(USER)}",
        f"Bearer {_acting_token(OTHER_USER)}",
        f"Bearer {_acting_token(USER)}",
    ]
    # Web's own service token is minted once and reused; it names no user.
    assert len(doors.service_token.calls) == 1


def _unavailable_dump(
    reason: str, status: int | None = None, code: str | None = None
) -> dict[str, Any]:
    return {"outcome": "unavailable", "reason": reason, "status": status, "code": code}


_MINT_FAILURES: list[tuple[str, Callable[[], _Doors], dict[str, Any], str]] = [
    (
        "service_account_disabled",
        lambda: _Doors(admin_secret=None),
        _unavailable_dump("no_credential"),
        "device_resolver_unavailable",
    ),
    # Web's OWN service token could not be had: the status is coord's answer
    # at that door, and only a 5xx is coord's fault.
    (
        "service_token_refused",
        lambda: _Doors(service_token=_Coord(403, {"error": "forbidden"})),
        _unavailable_dump("no_credential", 403),
        "device_resolver_unavailable",
    ),
    (
        "service_token_5xx",
        lambda: _Doors(service_token=_Coord(503, text="<html>bad gateway</html>")),
        _unavailable_dump("upstream_error", 503),
        "device_resolver_unavailable",
    ),
    (
        "service_token_connect_error",
        lambda: _Doors(service_token=_Coord(raise_exc=httpx.ConnectError("refused"))),
        _unavailable_dump("coord_unreachable"),
        "device_resolver_unavailable",
    ),
    (
        "service_token_malformed",
        lambda: _Doors(service_token=_Coord(200, {"sub": "service:web"})),
        _unavailable_dump("no_credential", 200),
        "device_resolver_unavailable",
    ),
    (
        "service_token_empty_string",
        lambda: _Doors(service_token=_Coord(200, _service_token(""))),
        _unavailable_dump("no_credential", 200),
        "device_resolver_unavailable",
    ),
    (
        "service_token_non_json",
        lambda: _Doors(service_token=_Coord(200, text="not json")),
        _unavailable_dump("no_credential", 200),
        "device_resolver_unavailable",
    ),
    (
        "service_token_exp_not_a_number",
        lambda: _Doors(service_token=_Coord(200, {"token": "t", "exp": "soon"})),
        _unavailable_dump("no_credential", 200),
        "device_resolver_unavailable",
    ),
    (
        # ``int(float("inf"))`` is an OverflowError, not a ValueError.
        "service_token_exp_infinite",
        lambda: _Doors(
            service_token=_Coord(200, text='{"token": "t", "exp": Infinity}')
        ),
        _unavailable_dump("no_credential", 200),
        "device_resolver_unavailable",
    ),
    (
        "connect_error",
        lambda: _Doors(mint=_Coord(raise_exc=httpx.ConnectError("refused"))),
        _unavailable_dump("coord_unreachable"),
        "device_resolver_unavailable",
    ),
    (
        "timeout",
        lambda: _Doors(mint=_Coord(raise_exc=httpx.ReadTimeout("slow"))),
        _unavailable_dump("coord_unreachable"),
        "device_resolver_unavailable",
    ),
    (
        "bad_url",
        lambda: _Doors(mint=_Coord(raise_exc=httpx.UnsupportedProtocol("no scheme"))),
        _unavailable_dump("misconfigured"),
        "device_resolver_unavailable",
    ),
    # Web's service token (or admin secret) cannot be written as a header.
    (
        "unencodable_service_credential",
        lambda: _Doors(
            mint=_Coord(raise_exc=UnicodeEncodeError("ascii", "tök", 1, 2, "no"))
        ),
        _unavailable_dump("no_credential"),
        "device_resolver_unavailable",
    ),
    (
        "illegal_header_value",
        lambda: _Doors(mint=_Coord(raise_exc=httpx.LocalProtocolError("illegal"))),
        _unavailable_dump("no_credential"),
        "device_resolver_unavailable",
    ),
    # A coord build without the mint door answers from its router fallback:
    # ``not_deployed``, with coord's ``error`` string kept.
    (
        "404_no_such_route_not_deployed",
        lambda: _Doors(mint=_Coord(404, _no_such_route(MINT_PATH))),
        _unavailable_dump("not_deployed", 404, "no_such_route"),
        "device_resolver_unavailable",
    ),
    (
        "405_method_not_allowed_not_deployed",
        lambda: _Doors(mint=_Coord(405, _method_not_allowed(MINT_PATH))),
        _unavailable_dump("not_deployed", 405, "method_not_allowed"),
        "device_resolver_unavailable",
    ),
    # And so does a 404/405 carrying NO ``error`` string at all.
    (
        "404_not_deployed",
        lambda: _Doors(mint=_Coord(404, text="Not Found")),
        _unavailable_dump("not_deployed", 404),
        "device_resolver_unavailable",
    ),
    (
        "404_json_without_a_code_not_deployed",
        lambda: _Doors(mint=_Coord(404, {"detail": "Not Found"})),
        _unavailable_dump("not_deployed", 404),
        "device_resolver_unavailable",
    ),
    (
        "405_not_deployed",
        lambda: _Doors(mint=_Coord(405, text="")),
        _unavailable_dump("not_deployed", 405),
        "device_resolver_unavailable",
    ),
    # A 404/405 carrying any OTHER ``error`` string is the door answering,
    # not a missing door: ``refused``, and the string is kept.
    (
        "404_with_another_string_is_refused",
        lambda: _Doors(mint=_Coord(404, {"error": "user_not_found"})),
        _unavailable_dump("refused", 404, "user_not_found"),
        "device_resolver_unavailable",
    ),
    (
        "405_with_another_string_is_refused",
        lambda: _Doors(mint=_Coord(405, {"error": "minting_is_paused"})),
        _unavailable_dump("refused", 405, "minting_is_paused"),
        "device_resolver_unavailable",
    ),
    # Coord's own answer about the user. It keeps coord's code rather than
    # becoming ``no_capable_device``, which the resolver also answers for a
    # user whose paired runners are merely offline.
    (
        "404_user_has_no_paired_device",
        lambda: _Doors(mint=_Coord(404, {"error": "user_has_no_paired_device"})),
        _unavailable_dump("refused", 404, "user_has_no_paired_device"),
        "no_paired_runner",
    ),
    # Still refused after the one retry with a fresh service token.
    (
        "401_twice",
        lambda: _Doors(mint=_Coord(401, {"error": "invalid_token"})),
        _unavailable_dump("refused", 401, "invalid_token"),
        "device_resolver_unavailable",
    ),
    (
        "409_tenant_ambiguous",
        lambda: _Doors(
            mint=_Coord(409, {"error": "tenant_ambiguous", "tenant_ids": ["a", "b"]})
        ),
        _unavailable_dump("refused", 409, "tenant_ambiguous"),
        "device_resolver_unavailable",
    ),
    (
        "403_tenant_not_bound",
        lambda: _Doors(mint=_Coord(403, {"error": "tenant_not_bound"})),
        _unavailable_dump("refused", 403, "tenant_not_bound"),
        "device_resolver_unavailable",
    ),
    (
        "403_not_the_web_service",
        lambda: _Doors(mint=_Coord(403, text="forbidden")),
        _unavailable_dump("refused", 403),
        "device_resolver_unavailable",
    ),
    (
        "400",
        lambda: _Doors(mint=_Coord(400, {"error": "invalid_user_id"})),
        _unavailable_dump("refused", 400, "invalid_user_id"),
        "device_resolver_unavailable",
    ),
    (
        "500",
        lambda: _Doors(mint=_Coord(500, {"error": "mint_failed"})),
        _unavailable_dump("upstream_error", 500, "mint_failed"),
        "device_resolver_unavailable",
    ),
    (
        "503_html",
        lambda: _Doors(mint=_Coord(503, text="<html>bad gateway</html>")),
        _unavailable_dump("upstream_error", 503),
        "device_resolver_unavailable",
    ),
    (
        "200_without_a_token",
        lambda: _Doors(mint=_Coord(200, {"acting_user": str(USER)})),
        _unavailable_dump("malformed_response", 200),
        "device_resolver_unavailable",
    ),
    (
        "200_non_string_token",
        lambda: _Doors(mint=_Coord(200, {"token": 7})),
        _unavailable_dump("malformed_response", 200),
        "device_resolver_unavailable",
    ),
    (
        "200_empty_string_token",
        lambda: _Doors(mint=_Coord(200, {"token": ""})),
        _unavailable_dump("malformed_response", 200),
        "device_resolver_unavailable",
    ),
    (
        "200_non_json",
        lambda: _Doors(mint=_Coord(200, text="not json")),
        _unavailable_dump("malformed_response", 200),
        "device_resolver_unavailable",
    ),
]


@pytest.mark.parametrize(
    ("make_doors", "expected", "refusal_code"),
    [case[1:] for case in _MINT_FAILURES],
    ids=[case[0] for case in _MINT_FAILURES],
)
async def test_a_failed_mint_is_a_refusal_and_the_resolver_is_not_asked(
    monkeypatch: pytest.MonkeyPatch,
    make_doors: Callable[[], _Doors],
    expected: dict[str, Any],
    refusal_code: str,
) -> None:
    doors = make_doors()
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))
    assert out.model_dump(mode="json") == expected
    assert doors.resolve.calls == []

    # And in the dispatcher it is a refusal — never a web-side pick, even
    # with an owned device sitting there: DEVICE_A is USER's and would be
    # returned if asked for by id, and ``_RefusingDb`` fails on any query.
    async def _by_id(db: Any, runner_id: UUID) -> SimpleNamespace | None:
        return {DEVICE_A: _device(DEVICE_A)}.get(runner_id)

    monkeypatch.setattr(workflow_dispatcher, "_get_runner_by_id", _by_id)
    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CoordCaller.background_for(USER),
        required_capabilities=[],
    )
    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == refusal_code
    assert picked.to_dispatch_error().status_code == 503
    assert doors.resolve.calls == []


async def test_a_401_at_the_mint_drops_the_service_token_and_retries_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Coord restarted with new keys: the cached service token is hours from
    ``exp`` but no longer accepted. One fresh service token, one retry."""
    doors = _Doors(
        service_token=_InTurn(
            _Coord(body=_service_token("stale-service-token")),
            _Coord(body=_service_token("fresh-service-token")),
        ),
        mint=_InTurn(_Coord(401, {"error": "invalid_token"}), _Coord(body=_minted)),
    )
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert isinstance(out, ResolvedOutcome) and out.device_id == DEVICE_B
    assert len(doors.service_token.calls) == 2
    assert [c["headers"]["Authorization"] for c in doors.mint.calls] == [
        "Bearer stale-service-token",
        "Bearer fresh-service-token",
    ]
    (call,) = doors.resolve.calls
    assert call["headers"]["Authorization"] == f"Bearer {_acting_token(USER)}"

    # The fresh token is kept: the next resolve mints with it, first time.
    await resolve_device(_placeable(), CoordCaller.background_for(USER))
    assert len(doors.service_token.calls) == 2
    assert doors.mint.calls[2]["headers"] == {
        "Authorization": "Bearer fresh-service-token"
    }


async def test_a_second_401_at_the_mint_is_refused_and_not_retried_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors(
        service_token=_InTurn(
            _Coord(body=_service_token("stale-service-token")),
            _Coord(body=_service_token("fresh-service-token")),
        ),
        mint=_Coord(401, {"error": "invalid_token"}),
    )
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert out == UnavailableOutcome(reason="refused", status=401, code="invalid_token")
    # Exactly one retry: two asks of the mint, two service tokens, no more.
    assert [c["headers"]["Authorization"] for c in doors.mint.calls] == [
        "Bearer stale-service-token",
        "Bearer fresh-service-token",
    ]
    assert len(doors.service_token.calls) == 2
    assert doors.resolve.calls == []


async def test_a_401_whose_fresh_service_token_is_refused_is_no_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors(
        service_token=_InTurn(
            _Coord(body=_service_token("stale-service-token")),
            _Coord(401, {"error": "bad_admin_secret"}),
        ),
        mint=_Coord(401, {"error": "invalid_token"}),
    )
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert out == UnavailableOutcome(reason="no_credential", status=401)
    assert len(doors.mint.calls) == 1
    assert doors.resolve.calls == []


async def test_a_split_coord_box_refuses_a_background_caller_without_minting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The mint is at ``COORD_URL`` and the resolver at ``COORD_DEVICE_URL``:
    two coords, two signing keys. Nothing is minted and neither is asked."""
    doors = _Doors(device_url="http://device-coord.test")
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert out == UnavailableOutcome(reason="misconfigured")
    assert doors.service_token.calls == []
    assert doors.mint.calls == []
    assert doors.resolve.calls == []

    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CoordCaller.background_for(USER),
        required_capabilities=[],
    )
    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "device_resolver_unavailable"
    assert "(misconfigured)" in picked.message
    assert "retry" not in picked.message
    assert doors.mint.calls == []


async def test_a_redundant_device_url_is_not_a_split_and_mints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``COORD_DEVICE_URL`` spelled the same as ``COORD_URL`` is one coord."""
    doors = _Doors(device_url=f"{_Doors.COORD_URL}/")
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert isinstance(out, ResolvedOutcome)
    assert len(doors.mint.calls) == 1
    (call,) = doors.resolve.calls
    assert call["url"] == f"{_Doors.COORD_URL}{RESOLVE_PATH}"


async def test_a_split_coord_box_still_forwards_an_interactive_bearer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The split refusal is about the MINT. A request's own bearer was not
    minted here, so it is forwarded to the device coord as before."""
    doors = _Doors(device_url="http://device-coord.test")
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CALLER)

    assert isinstance(out, ResolvedOutcome)
    (call,) = doors.resolve.calls
    assert call["url"] == f"http://device-coord.test{RESOLVE_PATH}"
    assert call["headers"]["Authorization"] == f"Bearer {BEARER}"
    assert doors.mint.calls == []


@pytest.mark.parametrize(
    ("outcome", "message"),
    [
        (
            UnavailableOutcome(reason="refused", status=409, code="tenant_ambiguous"),
            "Coord refused to resolve a runner (refused: tenant_ambiguous, HTTP "
            "409), so none is picked automatically. The refusal is coord's own; "
            "choose a runner explicitly.",
        ),
        (
            UnavailableOutcome(reason="refused", status=403),
            "Coord refused to resolve a runner (refused, HTTP 403), so none is "
            "picked automatically. The refusal is coord's own; choose a runner "
            "explicitly.",
        ),
        (
            UnavailableOutcome(reason="upstream_error", status=500, code="boom"),
            "Coord's device resolver could not be asked (upstream_error: boom, "
            "HTTP 500), so no runner is picked automatically. Choose a runner "
            "explicitly, or retry.",
        ),
        (
            UnavailableOutcome(reason="coord_unreachable"),
            "Coord's device resolver could not be asked (coord_unreachable), so "
            "no runner is picked automatically. Choose a runner explicitly, or "
            "retry.",
        ),
        (
            UnavailableOutcome(reason="not_deployed", status=404),
            "Coord's device resolver could not be asked (not_deployed, HTTP "
            "404), so no runner is picked automatically. Choose a runner "
            "explicitly.",
        ),
        (
            UnavailableOutcome(reason="not_deployed", status=404, code="no_such_route"),
            "Coord's device resolver could not be asked (not_deployed: "
            "no_such_route, HTTP 404), so no runner is picked automatically. "
            "Choose a runner explicitly.",
        ),
    ],
    ids=[
        "refused_with_code",
        "refused_no_code",
        "5xx",
        "unreachable",
        "not_deployed",
        "not_deployed_route_fallback",
    ],
)
async def test_an_unavailable_refusal_says_what_coord_said(
    monkeypatch: pytest.MonkeyPatch, outcome: UnavailableOutcome, message: str
) -> None:
    """Coord's code and HTTP status are in the message, and "retry" is
    advised only for what a later attempt can clear by itself."""
    _install(monkeypatch, _Resolver(outcome), {})
    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()), USER, CALLER, required_capabilities=[]
    )
    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "device_resolver_unavailable"
    assert picked.message == message


async def test_a_bearerless_interactive_caller_is_refused_and_never_mints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No bearer is not the same as background: an interactive request that
    arrives without one is refused (typed), and nothing is minted for it."""
    doors = _Doors()
    doors.install(monkeypatch)

    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CoordCaller(bearer=None),
        required_capabilities=[],
    )

    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "device_resolver_unavailable"
    assert picked.outcome == UnavailableOutcome(
        reason="no_credential", status=None, code=None
    )
    assert doors.service_token.calls == []
    assert doors.mint.calls == []
    assert doors.resolve.calls == []


async def test_an_interactive_caller_forwards_its_own_bearer_and_never_mints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors()
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CALLER)

    assert isinstance(out, ResolvedOutcome)
    assert doors.mint.calls == []
    assert doors.resolve.calls[0]["headers"]["Authorization"] == f"Bearer {BEARER}"


async def test_a_caller_names_an_acting_user_or_carries_a_bearer_never_both() -> None:
    """Naming an acting user IS being background — there is no second flag
    to disagree with it — and such a caller carries no bearer."""
    with pytest.raises(ValueError):
        CoordCaller(bearer=BEARER, acting_user_id=USER)
    with pytest.raises(ValueError):
        CoordCaller(bearer="", acting_user_id=USER)
    # The retired flag is gone, not merely ignored.
    with pytest.raises(TypeError):
        CoordCaller(bearer=None, background=True)  # type: ignore[call-arg]

    assert CoordCaller.background_for(USER) == CoordCaller(
        bearer=None, acting_user_id=USER
    )
    assert CoordCaller(bearer=None).acting_user_id is None


async def test_a_minted_token_that_cannot_be_sent_is_malformed_not_a_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """REAL httpx at the resolver: coord's mint answered ``200`` with a token
    that is not ASCII, which ``httpx`` cannot write as a header
    (``UnicodeEncodeError``, a ``ValueError``). It fails before any connect,
    and ``resolve_device`` answers typed instead of raising."""
    doors = _Doors(mint=_Coord(body={"token": "tökén-for-the-owner"}))
    doors.install(monkeypatch)
    monkeypatch.setattr(coord_device_resolve, "httpx", httpx)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert out == UnavailableOutcome(reason="malformed_response")
    assert len(doors.mint.calls) == 1

    picked = await _pick_auto_runner(
        cast(AsyncSession, _RefusingDb()),
        USER,
        CoordCaller.background_for(USER),
        required_capabilities=[],
    )
    assert isinstance(picked, AutoPickRefusal)
    assert picked.code == "device_resolver_unavailable"
    assert "(malformed_response)" in picked.message


async def test_an_interactive_bearer_that_cannot_be_sent_is_no_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """REAL httpx again: the request's own bearer is not ASCII."""
    doors = _Doors()
    doors.install(monkeypatch)
    monkeypatch.setattr(coord_device_resolve, "httpx", httpx)

    out = await resolve_device(_placeable(), CoordCaller(bearer="tökén"))

    assert out == UnavailableOutcome(reason="no_credential")
    assert doors.mint.calls == []


async def test_an_illegal_header_value_for_a_minted_token_is_malformed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``httpx.LocalProtocolError`` is a transport error by class, but it is
    OUR request that was illegal: not ``coord_unreachable``."""
    doors = _Doors(
        resolve=_Coord(raise_exc=httpx.LocalProtocolError("illegal header value"))
    )
    doors.install(monkeypatch)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert out == UnavailableOutcome(reason="malformed_response")


def _boom(*a: Any, **kw: Any) -> Any:
    raise RuntimeError("configuration unreadable")


@pytest.mark.parametrize("broken", ["coord_device_split_active", "coord_device_base"])
async def test_a_config_fault_for_a_background_caller_is_misconfigured_unminted(
    monkeypatch: pytest.MonkeyPatch, broken: str
) -> None:
    """Either configuration read failing is ``misconfigured`` — the split
    check exactly like the base lookup — and no coord door is asked."""
    doors = _Doors()
    doors.install(monkeypatch)
    monkeypatch.setattr(coord_device_resolve, broken, _boom)

    out = await resolve_device(_placeable(), CoordCaller.background_for(USER))

    assert out == UnavailableOutcome(reason="misconfigured")
    assert doors.service_token.calls == []
    assert doors.mint.calls == []
    assert doors.resolve.calls == []


class _RefusesTheStaleTokenOnceAllHoldIt(_Coord):
    """The mint door after coord restarted with new keys. It refuses the
    stale service token ``401`` — but answers no caller until ``callers`` of
    them are all waiting with it, so every one holds the SAME stale token
    when the refusals land. Any other service token is accepted."""

    def __init__(self, callers: int, stale: str) -> None:
        super().__init__()
        self.callers = callers
        self.stale = stale
        self.holding_stale = 0
        self.all_arrived = asyncio.Event()

    async def respond(  # type: ignore[override]
        self, url: str, json: Any, headers: Any, timeout: Any = None
    ) -> httpx.Response:
        self.calls.append(
            {"url": url, "json": json, "headers": headers, "timeout": timeout}
        )
        request = httpx.Request("POST", url)
        if headers["Authorization"] != f"Bearer {self.stale}":
            return httpx.Response(200, json=_minted(json), request=request)
        self.holding_stale += 1
        if self.holding_stale == self.callers:
            self.all_arrived.set()
        await self.all_arrived.wait()
        return httpx.Response(401, json={"error": "invalid_token"}, request=request)


async def test_callers_sharing_a_stale_service_token_re_mint_it_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Eight scheduled rows all hold the stale service token when coord
    refuses it. The first to come back drops it and mints a fresh one; the
    rest find a token that is no longer the one they were refused with, keep
    it, and retry with it. One re-mint, and every caller is answered."""
    users = [uuid4() for _ in range(8)]
    doors = _Doors(
        service_token=_InTurn(
            _Coord(body=_service_token("stale-service-token")),
            _Coord(body=_service_token("fresh-service-token")),
            # A third mint would be a caller dropping the FRESH token.
            _Coord(body=_service_token("a-token-too-many")),
        ),
        mint=_RefusesTheStaleTokenOnceAllHoldIt(len(users), "stale-service-token"),
    )
    doors.install(monkeypatch)

    outs = await asyncio.wait_for(
        asyncio.gather(
            *(
                resolve_device(_placeable(), CoordCaller.background_for(user))
                for user in users
            )
        ),
        timeout=10,
    )

    assert all(isinstance(out, ResolvedOutcome) for out in outs), outs
    # The first mint of the stale token, and exactly one re-mint.
    assert len(doors.service_token.calls) == 2
    bearers = [c["headers"]["Authorization"] for c in doors.mint.calls]
    assert bearers.count("Bearer stale-service-token") == len(users)
    assert bearers.count("Bearer fresh-service-token") == len(users)
    assert len(bearers) == 2 * len(users)
    # Each caller asked the resolver as the token minted for ITS user.
    assert sorted(c["headers"]["Authorization"] for c in doors.resolve.calls) == sorted(
        f"Bearer {_acting_token(user)}" for user in users
    )


# ---------------------------------------------------------------------------
# The scheduled job itself: fire_scheduled_run → dispatcher → coord
# ---------------------------------------------------------------------------


class _ScheduleDb:
    """The session ``fire_scheduled_run`` opens: ``get`` returns the row with
    that id and ``commit`` is counted. Any other query fails the test —
    after the row is read, nothing but coord may choose the runner."""

    def __init__(self, *rows: SimpleNamespace) -> None:
        self.rows = {row.id: row for row in rows}
        self.commits = 0

    async def __aenter__(self) -> _ScheduleDb:
        return self

    async def __aexit__(self, *a: Any) -> bool:
        return False

    async def get(self, model: Any, ident: Any) -> SimpleNamespace | None:
        return self.rows.get(ident)

    async def commit(self) -> None:
        self.commits += 1

    async def execute(self, *a: Any, **kw: Any) -> Any:
        raise AssertionError("no web-side device query may run here")


def _schedule_row(owner: UUID, target: str = "auto") -> SimpleNamespace:
    """An enabled schedule owned by ``owner``, due every minute."""
    return SimpleNamespace(
        id=uuid4(),
        user_id=owner,
        workflow_id=uuid4(),
        enabled=True,
        target=target,
        cron_expression="* * * * *",
        next_fire_at=None,
        last_fired_at=None,
        last_status=None,
        last_error=None,
        last_execution_id=None,
    )


def _wire_db(monkeypatch: pytest.MonkeyPatch, db: _ScheduleDb) -> None:
    """Put ``db`` in place of every session ``scheduled_dispatch`` opens."""
    monkeypatch.setattr(
        scheduled_dispatch, "async_sessionmaker", lambda *a, **kw: lambda: db
    )
    _own_workflow(monkeypatch)


def _schedule(monkeypatch: pytest.MonkeyPatch, owner: UUID) -> SimpleNamespace:
    """An enabled ``target="auto"`` schedule owned by ``owner``, wired into
    ``fire_scheduled_run`` in place of a database."""
    row = _schedule_row(owner)
    _wire_db(monkeypatch, _ScheduleDb(row))
    return row


async def test_a_scheduled_run_against_a_drained_only_fleet_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The done-condition: a drained runner no longer receives a scheduled
    workflow. Coord says every capable runner is drained, and that answer —
    not a web-side pick — is what the schedule records."""
    doors = _Doors(resolve=_Coord(body=DRAINED))
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, OTHER_USER)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object())
    )

    assert result["status"] == "failed"
    assert result["status_code"] == 503
    assert result["code"] == "all_capable_runners_drained"
    assert row.last_status == "failed"
    assert row.last_error == (
        "[503 all_capable_runners_drained] Every runner able to run this is drained."
    )
    # Coord was asked AS the schedule's owner.
    assert [c["json"] for c in doors.mint.calls] == [{"user_id": str(OTHER_USER)}]
    (call,) = doors.resolve.calls
    assert call["headers"]["Authorization"] == f"Bearer {_acting_token(OTHER_USER)}"


async def test_the_drained_refusal_carries_coords_outcome(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors(resolve=_Coord(body=DRAINED))
    doors.install(monkeypatch)
    _own_workflow(monkeypatch)

    with pytest.raises(DispatchError) as err:
        await dispatch_workflow_to_runner(
            cast(AsyncSession, _RefusingDb()),
            user_id=USER,
            workflow_id=uuid4(),
            target="auto",
            caller=CoordCaller.background_for(USER),
        )

    assert err.value.status_code == 503
    assert err.value.code == "all_capable_runners_drained"
    assert err.value.detail["resolver_outcome"] == DRAINED


async def test_a_scheduled_run_whose_mint_fails_is_refused_not_dispatched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A coord build without the mint door: the run is refused and says why
    in ``last_error``; the resolver is not asked and nothing is dispatched."""
    doors = _Doors(mint=_Coord(404, text="Not Found"))
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object())
    )

    assert result["status"] == "failed"
    assert result["code"] == "device_resolver_unavailable"
    assert row.last_status == "failed"
    assert row.last_execution_id is None
    assert "not_deployed" in row.last_error
    assert doors.resolve.calls == []


async def test_a_refused_mint_reaches_last_error_and_the_log_with_coords_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``409 tenant_ambiguous``: the operator reads coord's code and status
    in ``last_error`` and the run-now response, and the warning log carries
    them as fields. Nothing tells them to retry."""
    doors = _Doors(
        mint=_Coord(409, {"error": "tenant_ambiguous", "tenant_ids": ["a", "b"]})
    )
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)
    log = MagicMock()
    monkeypatch.setattr(scheduled_dispatch, "logger", log)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object())
    )

    assert row.last_status == "failed"
    assert row.last_error == (
        "[503 device_resolver_unavailable] Coord refused to resolve a runner "
        "(refused: tenant_ambiguous, HTTP 409), so none is picked "
        "automatically. The refusal is coord's own; choose a runner explicitly."
    )
    assert "retry" not in row.last_error
    # What the run-now endpoint answers with.
    assert result["error"] == row.last_error
    assert result["status_code"] == 503
    log.warning.assert_called_once_with(
        "scheduled_run_dispatch_failed",
        scheduled_run_id=str(row.id),
        status_code=503,
        code="device_resolver_unavailable",
        error=row.last_error,
        resolver_reason="refused",
        coord_code="tenant_ambiguous",
        coord_status=409,
    )
    assert doors.resolve.calls == []


async def test_a_schedule_whose_owner_has_no_paired_runner_says_to_pair_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Not "start a runner so it connects": the owner has none to start."""
    doors = _Doors(mint=_Coord(404, {"error": "user_has_no_paired_device"}))
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object())
    )

    assert result["status"] == "failed"
    assert result["code"] == "no_paired_runner"
    assert row.last_error == (
        "[503 no_paired_runner] The user this run is for has no paired runner "
        "(refused: user_has_no_paired_device, HTTP 404). Pair a runner with "
        "that account."
    )
    assert "Start a runner" not in row.last_error
    assert doors.resolve.calls == []


async def test_a_genuine_no_capable_device_answer_keeps_its_own_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The resolver's ``no_capable_device`` with nothing online is about
    paired runners that are not connected — a different fact from the mint's
    ``user_has_no_paired_device``, and it keeps the start-a-runner advice."""
    doors = _Doors(
        resolve=_Coord(
            body={
                "outcome": "no_capable_device",
                "missing": [],
                "online_devices": 0,
                "pin_released_reason": None,
                "pin_released_detail": None,
            }
        )
    )
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object())
    )

    assert result["code"] == "no_healthy_runner"
    assert row.last_error == (
        "[503 no_healthy_runner] No online runner of yours can run this. "
        "Start a runner so it connects, then retry."
    )


class _Sockets:
    """The runner WebSocket manager: every runner is connected, and each
    dispatch sent is recorded."""

    def __init__(self) -> None:
        self.sent: list[tuple[UUID, dict[str, Any]]] = []

    def is_connected(self, device_id: UUID) -> bool:
        return True

    async def send_dispatch(self, device_id: UUID, payload: dict[str, Any]) -> bool:
        self.sent.append((device_id, payload))
        return True


def _connect_runner(monkeypatch: pytest.MonkeyPatch, device_id: UUID) -> _Sockets:
    """``device_id`` is USER's runner, connected over its WebSocket here."""
    runner = _device(device_id)
    runner.ws_session_id = "ws-session"
    sockets = _Sockets()

    async def _by_id(db: Any, runner_id: UUID) -> SimpleNamespace | None:
        return {device_id: runner}.get(runner_id)

    async def _redis() -> object:
        return object()

    async def _manager(redis: Any) -> _Sockets:
        return sockets

    monkeypatch.setattr(workflow_dispatcher, "_get_runner_by_id", _by_id)
    monkeypatch.setattr(workflow_dispatcher, "get_redis", _redis)
    monkeypatch.setattr(workflow_dispatcher, "get_runner_websocket_manager", _manager)
    return sockets


async def test_a_scheduled_run_is_dispatched_to_the_runner_coord_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole path: mint for the owner, coord names DEVICE_B, and the
    workflow goes out over that runner's WebSocket."""
    doors = _Doors(resolve=_Coord(body=_resolved_body(DEVICE_B)))
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)
    sockets = _connect_runner(monkeypatch, DEVICE_B)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object())
    )

    ((sent_to, payload),) = sockets.sent
    assert sent_to == DEVICE_B
    assert payload == {
        "run_id": result["execution_id"],
        "workflow_id": str(row.workflow_id),
        "parent_task_run_id": None,
    }
    assert result == {
        "status": "dispatched",
        "execution_id": payload["run_id"],
        "runner_id": str(DEVICE_B),
    }
    assert row.last_status == "dispatched"
    assert row.last_execution_id == payload["run_id"]
    assert row.last_error is None
    assert row.last_fired_at is not None
    # Coord named the runner, asked AS the schedule's owner.
    assert [c["json"] for c in doors.mint.calls] == [{"user_id": str(USER)}]
    (call,) = doors.resolve.calls
    assert call["headers"]["Authorization"] == f"Bearer {_acting_token(USER)}"


# ---------------------------------------------------------------------------
# The due-rows sweep: two consecutive unreachable rows end the asking
# ---------------------------------------------------------------------------

NOT_ATTEMPTED = (
    "[503 coord_unreachable_in_sweep] Coord could not be reached for 2 "
    "consecutive automatic runs earlier in this sweep, so this run was not "
    "attempted and coord was not asked again for it. The next scheduled "
    "window is the retry."
)


class _SweepDb(_ScheduleDb):
    """Every session one ``poll_and_dispatch_due`` opens. Its first query is
    the anchor pass (nothing to anchor), its second the claim, which returns
    every row as due. A third query fails the test."""

    def __init__(self, *rows: SimpleNamespace) -> None:
        super().__init__(*rows)
        self.queries = 0

    async def execute(self, *a: Any, **kw: Any) -> Any:
        self.queries += 1
        if self.queries > 2:
            raise AssertionError("no web-side device query may run here")
        found = [] if self.queries == 1 else list(self.rows.values())
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: found))


async def _sweep(
    monkeypatch: pytest.MonkeyPatch, *rows: SimpleNamespace
) -> dict[str, int]:
    _wire_db(monkeypatch, _SweepDb(*rows))
    return await scheduled_dispatch.poll_and_dispatch_due(engine=cast(Any, object()))


UNREACHABLE = (
    "[503 device_resolver_unavailable] Coord's device resolver could not "
    "be asked (coord_unreachable), so no runner is picked automatically. "
    "Choose a runner explicitly, or retry."
)


async def test_a_sweep_stops_asking_after_two_consecutive_unreachable_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A black-holed coord costs the sweep TWO rows' timeouts. Every later
    ``target="auto"`` row is recorded failed — saying why — with no coord
    call. A row that names its runner asks coord nothing and still goes; one
    fired BETWEEN the two unreachable rows neither resets the count (the
    third auto row would then have asked) nor adds to it (the second auto
    row would then not have)."""
    doors = _Doors(mint=_Coord(raise_exc=httpx.ConnectTimeout("black hole")))
    doors.install(monkeypatch)
    sockets = _connect_runner(monkeypatch, DEVICE_B)
    first = _schedule_row(USER)
    pinned = _schedule_row(USER, target=str(DEVICE_B))
    second = _schedule_row(OTHER_USER)
    third = _schedule_row(USER)
    also_pinned = _schedule_row(USER, target=str(DEVICE_B))
    last = _schedule_row(USER)

    stats = await _sweep(monkeypatch, first, pinned, second, third, also_pinned, last)

    assert stats == {"due": 6, "dispatched": 2, "failed": 4, "skipped": 0}
    # Exactly the first two auto rows reached coord, and only its mint door.
    assert [c["json"] for c in doors.mint.calls] == [
        {"user_id": str(USER)},
        {"user_id": str(OTHER_USER)},
    ]
    assert len(doors.service_token.calls) == 1
    assert doors.resolve.calls == []

    for row in (first, second):
        assert row.last_status == "failed"
        assert row.last_error == UNREACHABLE
    for row in (third, last):
        assert row.last_status == "failed"
        assert row.last_error == NOT_ATTEMPTED
        assert row.last_fired_at is not None
        assert row.last_execution_id is None

    # The explicit-target rows: one fired between the two unreachable rows,
    # one AFTER the sweep stopped asking coord.
    assert [sent_to for sent_to, _ in sockets.sent] == [DEVICE_B, DEVICE_B]
    for row, (_, payload) in zip((pinned, also_pinned), sockets.sent, strict=True):
        assert payload["workflow_id"] == str(row.workflow_id)
        assert row.last_status == "dispatched"
        assert row.last_execution_id == payload["run_id"]
        assert row.last_error is None

    # Each sweep finds out for itself: the next one asks coord again, twice.
    fresh = [_schedule_row(USER) for _ in range(3)]
    await _sweep(monkeypatch, *fresh)
    assert len(doors.mint.calls) == 4
    assert [row.last_error for row in fresh] == [
        UNREACHABLE,
        UNREACHABLE,
        NOT_ATTEMPTED,
    ]


async def test_a_sweep_short_circuits_on_an_unreachable_resolver_too(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The mint answered and the RESOLVER timed out, twice running: the same
    outcome."""
    doors = _Doors(resolve=_Coord(raise_exc=httpx.ReadTimeout("slow")))
    doors.install(monkeypatch)
    first, second, third = (_schedule_row(USER) for _ in range(3))

    stats = await _sweep(monkeypatch, first, second, third)

    assert stats == {"due": 3, "dispatched": 0, "failed": 3, "skipped": 0}
    assert len(doors.mint.calls) == 2
    assert len(doors.resolve.calls) == 2
    assert first.last_error == second.last_error == UNREACHABLE
    assert third.last_error == NOT_ATTEMPTED


@pytest.mark.parametrize(
    ("answer", "answered_status"),
    [
        (_Coord(body=_minted), "dispatched"),
        (
            _Coord(409, {"error": "tenant_ambiguous", "tenant_ids": ["a", "b"]}),
            "failed",
        ),
        (_Coord(503, text="<html>bad gateway</html>"), "failed"),
        (_Coord(404, _no_such_route(MINT_PATH)), "failed"),
    ],
    ids=["resolved", "refused", "upstream_error", "not_deployed"],
)
async def test_one_unreachable_row_then_an_answered_row_does_not_short_circuit(
    monkeypatch: pytest.MonkeyPatch, answer: _Coord, answered_status: str
) -> None:
    """One failed request is ``coord_unreachable`` too, so one such row
    stops nothing — and a row coord ANSWERS, whatever the answer, starts the
    count over: unreachable, answered, unreachable is never two in a row,
    and the fourth row is asked."""
    unreachable = _Coord(raise_exc=httpx.ReadTimeout("one slow request"))
    doors = _Doors(mint=_InTurn(unreachable, answer, unreachable, answer))
    doors.install(monkeypatch)
    _connect_runner(monkeypatch, DEVICE_B)
    rows = [_schedule_row(USER) for _ in range(4)]

    await _sweep(monkeypatch, *rows)

    assert len(doors.mint.calls) == 4
    assert [row.last_status for row in rows] == [
        "failed",
        answered_status,
        "failed",
        answered_status,
    ]
    assert rows[0].last_error == rows[2].last_error == UNREACHABLE
    for row in (rows[1], rows[3]):
        assert row.last_error != NOT_ATTEMPTED
        assert "coord_unreachable" not in (row.last_error or "")


async def test_a_row_that_could_not_ask_coord_neither_counts_nor_resets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A ``target="auto"`` row on a backend with no service credential asks
    coord nothing: it says nothing about whether coord can be reached."""
    doors = _Doors(admin_secret=None)
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)
    sweep = scheduled_dispatch.SweepState(unreachable_in_a_row=1)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object()), sweep=sweep
    )

    assert result["code"] == "device_resolver_unavailable"
    assert "(no_credential)" in row.last_error
    assert doors.service_token.calls == doors.mint.calls == doors.resolve.calls == []
    assert sweep.unreachable_in_a_row == 1
    assert not sweep.coord_unreachable


class _CommitFails(_ScheduleDb):
    async def commit(self) -> None:
        raise RuntimeError("the database went away")


async def test_the_sweep_is_told_before_the_rows_outcome_is_committed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A commit that fails loses the row's record, not what the row learned:
    the next auto row must not pay the same timeouts to find it out again."""
    doors = _Doors(mint=_Coord(raise_exc=httpx.ConnectTimeout("black hole")))
    doors.install(monkeypatch)
    row = _schedule_row(USER)
    _wire_db(monkeypatch, _CommitFails(row))
    sweep = scheduled_dispatch.SweepState(unreachable_in_a_row=1)

    with pytest.raises(RuntimeError, match="the database went away"):
        await scheduled_dispatch.fire_scheduled_run(
            str(row.id), engine=cast(Any, object()), sweep=sweep
        )

    assert sweep.unreachable_in_a_row == 2
    assert sweep.coord_unreachable


async def test_a_resolved_row_resets_the_count_before_its_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The success path tells the sweep too, and before the commit: coord
    named a runner, so a commit that then fails does not leave the earlier
    unreachable row counting against the next one."""
    doors = _Doors()
    doors.install(monkeypatch)
    sockets = _connect_runner(monkeypatch, DEVICE_B)
    row = _schedule_row(USER)
    _wire_db(monkeypatch, _CommitFails(row))
    sweep = scheduled_dispatch.SweepState(unreachable_in_a_row=1)

    with pytest.raises(RuntimeError, match="the database went away"):
        await scheduled_dispatch.fire_scheduled_run(
            str(row.id), engine=cast(Any, object()), sweep=sweep
        )

    # Coord answered and the workflow went out; only the record was lost.
    assert len(doors.resolve.calls) == 1
    assert [sent_to for sent_to, _ in sockets.sent] == [DEVICE_B]
    assert sweep.unreachable_in_a_row == 0


async def test_an_unexpected_dispatch_error_starts_the_count_over(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Coord times out, answers, times out, answers — and each row coord
    answered then dies on something that is no ``DispatchError`` (Redis is
    down), AFTER the resolver named its runner. That is never two unreachable
    rows in a row, so the fourth row must still ask coord: a count left
    standing by the second row would have skipped it unasked."""
    unreachable = _Coord(raise_exc=httpx.ReadTimeout("one slow request"))
    doors = _Doors(
        mint=_InTurn(
            unreachable, _Coord(body=_minted), unreachable, _Coord(body=_minted)
        )
    )
    doors.install(monkeypatch)
    sockets = _connect_runner(monkeypatch, DEVICE_B)

    async def _no_redis() -> object:
        raise ConnectionError("redis is down")

    monkeypatch.setattr(workflow_dispatcher, "get_redis", _no_redis)
    rows = [_schedule_row(USER) for _ in range(4)]

    stats = await _sweep(monkeypatch, *rows)

    assert stats == {"due": 4, "dispatched": 0, "failed": 4, "skipped": 0}
    assert len(doors.mint.calls) == 4
    # Coord's resolver answered the second and the fourth row.
    assert len(doors.resolve.calls) == 2
    assert sockets.sent == []
    assert rows[0].last_error == rows[2].last_error == UNREACHABLE
    # The unexpected error is re-raised as it is: the fire records nothing.
    for row in (rows[1], rows[3]):
        assert row.last_status is None
        assert row.last_error is None


async def test_an_unexpected_dispatch_error_is_re_raised_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors()
    doors.install(monkeypatch)
    _connect_runner(monkeypatch, DEVICE_B)
    boom = ConnectionError("redis is down")

    async def _no_redis() -> object:
        raise boom

    monkeypatch.setattr(workflow_dispatcher, "get_redis", _no_redis)
    row = _schedule(monkeypatch, USER)
    sweep = scheduled_dispatch.SweepState(unreachable_in_a_row=1)

    with pytest.raises(ConnectionError) as raised:
        await scheduled_dispatch.fire_scheduled_run(
            str(row.id), engine=cast(Any, object()), sweep=sweep
        )

    assert raised.value is boom
    assert sweep.unreachable_in_a_row == 0


def _unavailable_error(reason: str, status: int | None = None) -> DispatchError:
    """The dispatcher's refusal of an auto-pick the resolver left unanswered."""
    return AutoPickRefusal(
        code="device_resolver_unavailable",
        message="Coord's device resolver could not be asked.",
        outcome=UnavailableOutcome.model_validate({"reason": reason, "status": status}),
    ).to_dispatch_error()


@pytest.mark.parametrize(
    ("err", "contact"),
    [
        # Refused before the pick: coord was never asked.
        (
            DispatchError(
                status_code=404, code="workflow_not_found", detail="Workflow not found"
            ),
            "not_asked",
        ),
        (_unavailable_error("misconfigured"), "not_asked"),
        # Web had no service credential to ask with ...
        (_unavailable_error("no_credential"), "not_asked"),
        # ... unless coord itself refused web's service token: an answer.
        (_unavailable_error("no_credential", 401), "answered"),
        (_unavailable_error("no_credential", 403), "answered"),
        (_unavailable_error("coord_unreachable"), "unreachable"),
        (_unavailable_error("refused", 409), "answered"),
        (_unavailable_error("upstream_error", 503), "answered"),
        (_unavailable_error("not_deployed", 404), "answered"),
        # A runner coord named, which the dispatch then could not reach.
        (
            DispatchError(
                status_code=503,
                code="runner_offline",
                detail={"code": "runner_offline"},
            ),
            "answered",
        ),
    ],
    ids=[
        "workflow_not_found",
        "misconfigured",
        "no_credential_unasked",
        "no_credential_401",
        "no_credential_403",
        "coord_unreachable",
        "refused",
        "upstream_error",
        "not_deployed",
        "runner_offline",
    ],
)
def test_what_a_refused_auto_dispatch_says_about_reaching_coord(
    err: DispatchError, contact: str
) -> None:
    """Which refusals count toward the short-circuit (``unreachable``), which
    start the count over (``answered``), and which do neither."""
    assert scheduled_dispatch._coord_contact(err) == contact
    before = 1
    sweep = scheduled_dispatch.SweepState(unreachable_in_a_row=before)
    sweep.note(scheduled_dispatch._coord_contact(err))
    assert (
        sweep.unreachable_in_a_row
        == {
            "unreachable": before + 1,
            "answered": 0,
            "not_asked": before,
        }[contact]
    )


@pytest.mark.parametrize(
    "mint",
    [
        _Coord(409, {"error": "tenant_ambiguous", "tenant_ids": ["a", "b"]}),
        _Coord(503, text="<html>bad gateway</html>"),
        _Coord(404, _no_such_route(MINT_PATH)),
    ],
    ids=["refused", "upstream_error", "not_deployed"],
)
async def test_a_sweep_keeps_asking_a_coord_that_answers(
    monkeypatch: pytest.MonkeyPatch, mint: _Coord
) -> None:
    """Only ``coord_unreachable`` short-circuits. A coord that ANSWERS — a
    refusal about one owner, a 5xx, a missing door — is asked for each row:
    the answer is about that row and costs no timeout."""
    mint.calls.clear()
    doors = _Doors(mint=mint)
    doors.install(monkeypatch)
    first, second, third = (
        _schedule_row(USER),
        _schedule_row(OTHER_USER),
        _schedule_row(USER),
    )

    stats = await _sweep(monkeypatch, first, second, third)

    assert stats == {"due": 3, "dispatched": 0, "failed": 3, "skipped": 0}
    assert [c["json"] for c in doors.mint.calls] == [
        {"user_id": str(USER)},
        {"user_id": str(OTHER_USER)},
        {"user_id": str(USER)},
    ]
    assert "sweep" not in third.last_error


async def test_a_fire_in_an_already_unreachable_sweep_is_not_attempted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doors = _Doors()
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)
    log = MagicMock()
    monkeypatch.setattr(scheduled_dispatch, "logger", log)
    sweep = scheduled_dispatch.SweepState(unreachable_in_a_row=2)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object()), sweep=sweep
    )

    assert result == {
        "status": "failed",
        "reason": "coord_unreachable_in_sweep",
        "status_code": 503,
        "code": "coord_unreachable_in_sweep",
        "error": NOT_ATTEMPTED,
    }
    assert row.last_status == "failed" and row.last_error == NOT_ATTEMPTED
    assert doors.service_token.calls == doors.mint.calls == doors.resolve.calls == []
    log.warning.assert_called_once_with(
        "scheduled_run_not_attempted_coord_unreachable_in_sweep",
        scheduled_run_id=str(row.id),
        error=NOT_ATTEMPTED,
    )


async def test_fire_scheduled_run_without_sweep_state_asks_coord_each_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``fire_scheduled_run`` called with no sweep state, which is how the
    run-now endpoint calls it (the endpoint itself is not exercised here):
    nothing is remembered between fires, and an unreachable coord is asked
    each time — three times running, past the sweep's two."""
    doors = _Doors(mint=_Coord(raise_exc=httpx.ConnectError("refused")))
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)

    for _ in range(3):
        result = await scheduled_dispatch.fire_scheduled_run(
            str(row.id), engine=cast(Any, object())
        )
        assert result["code"] == "device_resolver_unavailable"
        assert "(coord_unreachable)" in row.last_error

    assert len(doors.mint.calls) == 3


# ---------------------------------------------------------------------------
# No token in the logs
# ---------------------------------------------------------------------------


class _LogRecorder:
    """Stands in for a module's structlog logger and keeps every call.

    The app configures structlog with ``cache_logger_on_first_use=True``, so
    a ``structlog.testing.capture_logs`` block does not reliably see an
    already-bound module logger; replacing the logger does. The price is
    that nothing these modules log reaches the real logging pipeline while
    it is installed, so a test using it checks the log CALLS and not the
    rendered output."""

    def __init__(self) -> None:
        self.records: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    def __getattr__(self, level: str) -> Callable[..., None]:
        def _log(*args: Any, **fields: Any) -> None:
            self.records.append((level, args, fields))

        return _log


_LOGGING_MODULES = (
    coord_device_resolve,
    coord_service_account,
    workflow_dispatcher,
    scheduled_dispatch,
)


SERVICE_TOKEN_REFUSAL = "admin secret not accepted for this service"


@pytest.mark.parametrize(
    ("make_doors", "status", "logged"),
    [
        (lambda: _Doors(), "dispatched", "scheduled_run_dispatched"),
        (
            # The mint answered, so an acting token exists when coord refuses.
            lambda: _Doors(resolve=_Coord(403, {"error": "principal_not_accepted"})),
            "failed",
            "scheduled_run_dispatch_failed",
        ),
        (
            # The service token is refused, dropped and re-minted on the way.
            lambda: _Doors(mint=_Coord(401, {"error": "invalid_token"})),
            "failed",
            "coord_service_account_token_refused_reminting",
        ),
        (
            # Web's own service-token door refuses the admin secret, with a
            # body — which the refusal's log call quotes.
            lambda: _Doors(service_token=_Coord(403, {"error": SERVICE_TOKEN_REFUSAL})),
            "failed",
            "device_resolve_service_token_unobtainable",
        ),
    ],
    ids=[
        "success",
        "refused_by_the_resolver",
        "refused_at_the_mint",
        "service_token_refused_with_a_body",
    ],
)
async def test_no_credential_is_in_a_log_call_the_result_or_last_error(
    monkeypatch: pytest.MonkeyPatch,
    make_doors: Callable[[], _Doors],
    status: str,
    logged: str,
) -> None:
    """The admin secret, the service token and the minted acting token are
    credentials. What is checked, exactly: none of them appears in the event
    or fields of any log call these four modules make (recorded by a stand-in
    for each module's logger), in the dict ``fire_scheduled_run`` returns, or
    in the row's ``last_error``.

    What is NOT checked: the rendered log output. The modules' real loggers
    are replaced, so nothing reaches the stdlib log, stdout or stderr from
    them here, and an assertion on those would pass whatever was logged."""
    doors = make_doors()
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)
    _connect_runner(monkeypatch, DEVICE_B)
    log = _LogRecorder()
    for module in _LOGGING_MODULES:
        monkeypatch.setattr(module, "logger", log)

    result = await scheduled_dispatch.fire_scheduled_run(
        str(row.id), engine=cast(Any, object())
    )

    assert result["status"] == status
    # The recorder really is what these modules log to.
    assert logged in [args[0] for _, args, _ in log.records]
    # The credentials really were in play.
    assert doors.service_token.calls[0]["headers"]["X-Coord-Admin-Secret"] == "s3cret"
    if doors.mint.calls:
        assert doors.mint.calls[0]["headers"]["Authorization"] == (
            f"Bearer {SERVICE_TOKEN}"
        )
    if doors.resolve.calls:
        assert doors.resolve.calls[0]["headers"]["Authorization"] == (
            f"Bearer {_acting_token(USER)}"
        )

    recorded = repr(log.records)
    if logged == "device_resolve_service_token_unobtainable":
        # The refusal's body IS logged, so the fields checked are not empty.
        assert doors.mint.calls == []
        assert SERVICE_TOKEN_REFUSAL in recorded
    everything = "\n".join([recorded, repr(result), repr(row.last_error)])
    assert SERVICE_TOKEN not in everything
    assert "acting-token-for-" not in everything
    assert "s3cret" not in everything


# ---------------------------------------------------------------------------
# The run-now endpoint: POST /api/v1/scheduled-runs/{id}/run-now
# ---------------------------------------------------------------------------


def test_run_now_answers_a_refused_auto_run_with_coords_own_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Over HTTP: a refused ``target="auto"`` run is the dispatcher's 503,
    and its body carries coord's ``error`` string and HTTP status."""
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints import scheduled_runs

    doors = _Doors(
        mint=_Coord(409, {"error": "tenant_ambiguous", "tenant_ids": ["a", "b"]})
    )
    doors.install(monkeypatch)
    row = _schedule(monkeypatch, USER)

    async def _owned_run(db: Any, user_id: UUID, run_id: UUID) -> Any:
        return row if (user_id, run_id) == (USER, row.id) else None

    async def _no_db() -> Any:
        yield object()

    monkeypatch.setattr(scheduled_runs.crud, "get_scheduled_run", _owned_run)
    app = FastAPI()
    user = MagicMock()
    user.id = USER
    user.is_active = True
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[get_async_db] = _no_db
    app.include_router(scheduled_runs.router, prefix="/api/v1/scheduled-runs")

    resp = TestClient(app).post(f"/api/v1/scheduled-runs/{row.id}/run-now")

    assert resp.status_code == 503
    assert resp.json() == {
        "detail": (
            "[503 device_resolver_unavailable] Coord refused to resolve a "
            "runner (refused: tenant_ambiguous, HTTP 409), so none is picked "
            "automatically. The refusal is coord's own; choose a runner "
            "explicitly."
        )
    }
    assert row.last_status == "failed"
    assert [c["json"] for c in doors.mint.calls] == [{"user_id": str(USER)}]
    assert doors.resolve.calls == []

    # A run that is not this user's is a 404 and nothing is fired.
    assert (
        TestClient(app).post(f"/api/v1/scheduled-runs/{uuid4()}/run-now").status_code
        == 404
    )
    assert len(doors.mint.calls) == 1
