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
  Phase 1).

Coord is mocked at ``httpx.AsyncClient``; no live coord is needed.
"""

from __future__ import annotations

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

from app.jobs import scheduled_dispatch
from app.schemas.device_resolve import (
    DeviceResolveRequest,
    NoCapableDeviceOutcome,
    PinIneligibleOutcome,
    ResolvedOutcome,
    UnavailableOutcome,
)
from app.services import coord_device_resolve, workflow_dispatcher
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
                return coord.respond(url, json, headers)

        monkeypatch.setattr(coord_device_resolve.httpx, "AsyncClient", _FakeClient)

    def respond(self, url: str, json: Any, headers: Any) -> httpx.Response:
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.raise_exc is not None:
            raise self.raise_exc
        request = httpx.Request("POST", url)
        if self.text is not None:
            return httpx.Response(self.status, text=self.text, request=request)
        body = self.body(json) if callable(self.body) else self.body
        return httpx.Response(self.status, json=body, request=request)


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
        # A coord build without the door: the route does not exist.
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


class _Doors:
    """Coord's three doors a background resolve crosses, each scripted.

    ``service_token`` is web's own service-token mint, ``mint`` the
    acting-user mint, ``resolve`` the device resolver. Every request is
    recorded on the door it reached, so a test can prove which were (and
    were not) asked, and with what bearer.
    """

    def __init__(
        self,
        *,
        mint: _Coord | None = None,
        resolve: _Coord | None = None,
        service_token: _Coord | None = None,
        admin_secret: str | None = "s3cret",
    ) -> None:
        self.mint = mint or _Coord(body=_minted)
        self.resolve = resolve or _Coord(body=_resolved_body(DEVICE_B))
        self.service_token = service_token or _Coord(
            body={
                "token": SERVICE_TOKEN,
                "sub": "service:web",
                "exp": int(time.time()) + 4 * 3600,
            }
        )
        self.admin_secret = admin_secret

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        doors = self

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
                for path, door in (
                    (SERVICE_TOKEN_PATH, doors.service_token),
                    (MINT_PATH, doors.mint),
                    (RESOLVE_PATH, doors.resolve),
                ):
                    if url.endswith(path):
                        return door.respond(url, json, headers)
                raise AssertionError(f"unexpected coord url: {url}")

        monkeypatch.setattr(coord_device_resolve.httpx, "AsyncClient", _FakeClient)
        # A fresh, ENABLED service account per test: the process singleton is
        # off here (no COORD_ADMIN_SECRET) and would hold a token across tests.
        monkeypatch.setattr(
            coord_device_resolve,
            "coord_service_account",
            CoordServiceAccountClient(
                coord_url="http://coord.test",
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


_NO_PAIRED_DEVICE_OUTCOME = {
    "outcome": "no_capable_device",
    "missing": [],
    "online_devices": 0,
    "pin_released_reason": None,
    "pin_released_detail": None,
}


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
    (
        "service_token_refused",
        lambda: _Doors(service_token=_Coord(403, {"error": "forbidden"})),
        _unavailable_dump("no_credential"),
        "device_resolver_unavailable",
    ),
    (
        "service_token_malformed",
        lambda: _Doors(service_token=_Coord(200, {"sub": "service:web"})),
        _unavailable_dump("no_credential"),
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
    # A coord build without the mint door.
    (
        "404_not_deployed",
        lambda: _Doors(mint=_Coord(404, text="Not Found")),
        _unavailable_dump("not_deployed", 404),
        "device_resolver_unavailable",
    ),
    (
        "404_other_code_not_deployed",
        lambda: _Doors(mint=_Coord(404, {"error": "not_found"})),
        _unavailable_dump("not_deployed", 404),
        "device_resolver_unavailable",
    ),
    (
        "405_not_deployed",
        lambda: _Doors(mint=_Coord(405, text="")),
        _unavailable_dump("not_deployed", 405),
        "device_resolver_unavailable",
    ),
    # Coord's own answer about the user: not UNKNOWN, and not a missing door.
    (
        "404_user_has_no_paired_device",
        lambda: _Doors(mint=_Coord(404, {"error": "user_has_no_paired_device"})),
        _NO_PAIRED_DEVICE_OUTCOME,
        "no_healthy_runner",
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
    # with an owned device sitting there (``_RefusingDb`` fails on any query).
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


@pytest.mark.parametrize(
    "kwargs",
    [
        # The retired bearerless shape: background, but for nobody.
        {"bearer": None, "background": True},
        {"bearer": BEARER, "background": True, "acting_user_id": USER},
        {"bearer": BEARER, "acting_user_id": USER},
        {"bearer": None, "acting_user_id": USER},
    ],
    ids=[
        "background_for_nobody",
        "background_with_bearer",
        "interactive_with_bearer_and_user",
        "interactive_with_user",
    ],
)
def test_a_caller_is_background_with_a_user_or_interactive_never_a_mix(
    kwargs: dict[str, Any],
) -> None:
    with pytest.raises(ValueError):
        CoordCaller(**kwargs)


# ---------------------------------------------------------------------------
# The scheduled job itself: fire_scheduled_run → dispatcher → coord
# ---------------------------------------------------------------------------


class _ScheduleDb:
    """The session ``fire_scheduled_run`` opens: ``get`` returns the one row
    and ``commit`` is counted. Any other query fails the test — after the
    row is read, nothing but coord may choose the runner."""

    def __init__(self, row: SimpleNamespace) -> None:
        self.row = row
        self.commits = 0

    async def __aenter__(self) -> _ScheduleDb:
        return self

    async def __aexit__(self, *a: Any) -> bool:
        return False

    async def get(self, model: Any, ident: Any) -> SimpleNamespace:
        return self.row

    async def commit(self) -> None:
        self.commits += 1

    async def execute(self, *a: Any, **kw: Any) -> Any:
        raise AssertionError("no web-side device query may run here")


def _schedule(monkeypatch: pytest.MonkeyPatch, owner: UUID) -> SimpleNamespace:
    """An enabled ``target="auto"`` schedule owned by ``owner``, wired into
    ``fire_scheduled_run`` in place of a database."""
    row = SimpleNamespace(
        id=uuid4(),
        user_id=owner,
        workflow_id=uuid4(),
        enabled=True,
        target="auto",
        last_fired_at=None,
        last_status=None,
        last_error=None,
        last_execution_id=None,
    )
    db = _ScheduleDb(row)
    monkeypatch.setattr(
        scheduled_dispatch, "async_sessionmaker", lambda *a, **kw: lambda: db
    )
    _own_workflow(monkeypatch)
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
