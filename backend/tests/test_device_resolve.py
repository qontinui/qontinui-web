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
  NO fallback ordering when the resolver is unavailable — for a caller WITH
  a bearer. A caller with NO bearer (scheduled dispatch) cannot ask coord and
  uses the explicitly named ``_pick_auto_runner_without_caller_credential``.

Coord is mocked at ``httpx.AsyncClient``; no live coord is needed.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Literal, cast
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.device_resolve import (
    DeviceResolveRequest,
    NoCapableDeviceOutcome,
    PinIneligibleOutcome,
    ResolvedOutcome,
    UnavailableOutcome,
)
from app.services import coord_device_resolve, workflow_dispatcher
from app.services.coord_device_resolve import NO_CALLER, CoordCaller, resolve_device
from app.services.workflow_dispatcher import (
    AutoPickRefusal,
    DispatchError,
    _pick_auto_runner,
    _pick_auto_runner_without_caller_credential,
    dispatch_to_fresh_host,
    dispatch_workflow_to_runner,
)

DEVICE_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
DEVICE_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
DEVICE_C = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
USER = UUID("11111111-1111-4111-8111-111111111111")
BEARER = "caller-cognito-token"
CALLER = CoordCaller(bearer=BEARER, active_tenant="tenant-xyz")

# Sync (TestClient) tests in this module ignore the marker.
pytestmark = pytest.mark.asyncio(loop_scope="function")


# ---------------------------------------------------------------------------
# A recording fake for httpx.AsyncClient
# ---------------------------------------------------------------------------


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
        coord = self

        class _FakeClient:
            def __init__(self, *a: Any, **kw: Any) -> None:
                pass

            async def __aenter__(self) -> _FakeClient:
                return self

            async def __aexit__(self, *a: Any) -> bool:
                return False

            async def post(
                self, url: str, *, json: Any = None, headers: Any = None
            ) -> httpx.Response:
                coord.calls.append({"url": url, "json": json, "headers": headers})
                if coord.raise_exc is not None:
                    raise coord.raise_exc
                request = httpx.Request("POST", url)
                if coord.text is not None:
                    return httpx.Response(
                        coord.status, text=coord.text, request=request
                    )
                return httpx.Response(coord.status, json=coord.body, request=request)

        monkeypatch.setattr(coord_device_resolve.httpx, "AsyncClient", _FakeClient)


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
    out = await resolve_device(_placeable(), NO_CALLER)
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
        # qontinui-coord#2402 not deployed: the route does not exist.
        (_Coord(404, text="Not Found"), "not_deployed", 404, None),
        (_Coord(405, text=""), "not_deployed", 405, None),
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
        "404_not_deployed",
        "405_not_deployed",
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
        self.queries = 0

    async def execute(self, *a: Any, **kw: Any) -> Any:
        self.queries += 1
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


# ---------------------------------------------------------------------------
# No caller credential (scheduled / background): the explicit web fallback
# ---------------------------------------------------------------------------


def _row(
    device_id: UUID,
    *,
    ws: bool = False,
    status: str = "healthy",
    heartbeat_age_s: float | None = 5,
) -> SimpleNamespace:
    from datetime import timedelta

    from qontinui_schemas.common import utc_now

    return SimpleNamespace(
        device_id=device_id,
        user_id=USER,
        ws_session_id=1 if ws else None,
        derived_status=status,
        last_heartbeat=(
            None
            if heartbeat_age_s is None
            else utc_now() - timedelta(seconds=heartbeat_age_s)
        ),
        hostname="h",
        port=9876,
    )


async def test_scheduled_auto_pick_uses_the_no_credential_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cron fire has no bearer: coord cannot be asked, so the explicitly
    named web fallback picks (WS-connected healthy first), and coord is not
    called."""
    coord = _Coord(body={"outcome": "drain_unreadable"})
    coord.install(monkeypatch)
    # Rows come back in the query's order (WS-connected first).
    db = _FreshDb([_row(DEVICE_B, ws=True), _row(DEVICE_A)])

    picked = await _pick_auto_runner(
        cast(AsyncSession, db), USER, NO_CALLER, required_capabilities=[]
    )

    assert getattr(picked, "device_id", None) == DEVICE_B
    assert db.queries == 1
    assert coord.calls == []


async def test_no_credential_fallback_keeps_the_health_rules() -> None:
    stale_unhealthy = _row(DEVICE_A, status="offline", heartbeat_age_s=3600)
    stale = _row(DEVICE_B, heartbeat_age_s=3600)
    fresh = _row(DEVICE_C)

    picked = await _pick_auto_runner_without_caller_credential(
        cast(AsyncSession, _FreshDb([stale_unhealthy, stale, fresh])), USER
    )
    assert getattr(picked, "device_id", None) == DEVICE_C

    none = await _pick_auto_runner_without_caller_credential(
        cast(AsyncSession, _FreshDb([stale_unhealthy, stale])), USER
    )
    assert isinstance(none, AutoPickRefusal)
    assert none.code == "no_healthy_runner"


async def test_a_bearerless_interactive_caller_is_refused_not_fallen_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No bearer is not the same as background: an interactive request that
    arrives without one is refused (typed), and the fallback is not used."""
    fallback_calls: list[UUID] = []

    async def _spy(db: Any, user_id: UUID) -> Any:
        fallback_calls.append(user_id)
        return _device(DEVICE_A)

    monkeypatch.setattr(
        workflow_dispatcher, "_pick_auto_runner_without_caller_credential", _spy
    )
    coord = _Coord(body={"outcome": "drain_unreadable"})
    coord.install(monkeypatch)

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
    assert fallback_calls == []
    assert coord.calls == []


async def test_an_interactive_auto_dispatch_never_uses_the_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With a bearer, an UNKNOWN resolver is a refusal — the web fallback is
    unreachable, and no device query runs."""
    fallback_calls: list[UUID] = []

    async def _spy(db: Any, user_id: UUID) -> Any:
        fallback_calls.append(user_id)
        return _device(DEVICE_A)

    monkeypatch.setattr(
        workflow_dispatcher, "_pick_auto_runner_without_caller_credential", _spy
    )
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
    assert fallback_calls == []
