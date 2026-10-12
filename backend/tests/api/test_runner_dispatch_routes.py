"""Runner-selection and dispatch-failure coverage for two WS-bridge routes.

``POST /state-discovery/ui-bridge/discover-states`` and
``POST /template-capture/profiles/{name}/tune`` had no 404/503/504 tests
before they adopted the shared helpers in
``app.services.runner.device_selector`` (plan
``2026-10-04-web-ui-bridge-states-endpoint-inlines-its-crud-and-discovery``
Phase 2). These drive both routes through the ASGI client against the test
DB and pin what a caller observes: the ``runner_not_found`` 404 for a foreign
runner, the 503 ``no_runner_connected`` envelope carrying each route's own
endpoint string, and the 503/504 relay-failure mapping with its structlog
event names and each route's dispatch timeout (template_capture: 60s).

The runner manager is replaced at the process-wide singleton
``app.services.runner_websocket_manager._runner_websocket_manager`` — the same
seam ``tests/api/test_ui_bridge_states_routes.py`` uses — so no import site is
patched.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
import structlog
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.runner_websocket_manager as runner_ws_manager_module
from app.api.deps import current_active_user, get_async_db
from app.api.v1.endpoints import state_discovery as state_discovery_module
from app.api.v1.endpoints import template_capture as template_capture_module
from app.models.device import Device
from app.models.user import User
from app.services.runner import RunnerCommandTimeoutError, RunnerNotConnectedError

pytestmark = pytest.mark.asyncio

API = "/api/v1"


@dataclass(frozen=True)
class RouteCase:
    name: str
    path: str  # concrete request path
    body: dict[str, Any]
    endpoint: str  # the `endpoint` string in the 503/504 envelope
    prefix: str  # structlog event prefix
    timeout_s: float


ROUTE_CASES = [
    RouteCase(
        name="state_discovery_ui_bridge",
        path=f"{API}/state-discovery/ui-bridge/discover-states",
        body={"renders": [{"id": "r1"}], "strategy": "fingerprint"},
        endpoint="/api/v1/state-discovery/ui-bridge/discover-states",
        prefix="ui_bridge_discover",
        timeout_s=30.0,
    ),
    RouteCase(
        name="template_capture_tune",
        path=f"{API}/template-capture/profiles/my-profile/tune",
        body={"screenshotUrls": ["https://example.invalid/a.png"]},
        endpoint="/api/v1/template-capture/profiles/{name}/tune",
        prefix="tune_profile",
        timeout_s=60.0,
    ),
]


def _own(logs: list[dict[str, Any]], case: RouteCase) -> list[dict[str, Any]]:
    """This route's runner events only (``get_redis`` may log on first use)."""
    return [e for e in logs if str(e.get("event", "")).startswith(case.prefix + "_")]


# =============================================================================
# App + client
# =============================================================================


def _build_app(*, db: AsyncSession, user: User) -> FastAPI:
    app = FastAPI()

    async def _db_override() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_async_db] = _db_override
    # state_discovery binds ``get_current_active_user_async``, which is an
    # alias of ``current_active_user``; template_capture binds the latter.
    app.dependency_overrides[current_active_user] = lambda: user
    app.include_router(state_discovery_module.router, prefix=f"{API}/state-discovery")
    app.include_router(template_capture_module.router, prefix=f"{API}/template-capture")
    return app


ClientFactory = Callable[[User], httpx.AsyncClient]


@pytest.fixture()
def make_client(async_db_session: AsyncSession) -> ClientFactory:
    def _factory(user: User) -> httpx.AsyncClient:
        app = _build_app(db=async_db_session, user=user)
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    return _factory


# =============================================================================
# Seed helpers + fake manager
# =============================================================================


async def _make_user(db: AsyncSession, stem: str) -> User:
    user = User(
        email=f"{stem}_{uuid4().hex[:8]}@example.com",
        username=f"{stem}_{uuid4().hex[:8]}",
        full_name=f"{stem} tester",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_device(db: AsyncSession, *, user: User, name: str) -> Device:
    device = Device(
        device_id=uuid4(),
        user_id=user.id,
        name=name,
        hostname=name,
        state="healthy",
        capability_user_paired=True,
        paired_at=datetime.now(UTC),
        last_heartbeat=datetime.now(UTC),
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


class _FakeRegistry:
    def __init__(self) -> None:
        self.connected: set[str] = set()

    def is_runner_connected(self, runner_id: str) -> bool:
        return runner_id in self.connected

    def is_runner_socket_live(self, runner_id: str) -> bool:
        return runner_id in self.connected


@dataclass
class FakeRunnerManager:
    registry: _FakeRegistry
    dispatch: AsyncMock

    @property
    def relay(self) -> SimpleNamespace:
        return SimpleNamespace(dispatch_and_wait=self.dispatch)

    def connect(self, device: Device) -> None:
        self.registry.connected.add(str(device.device_id))

    @property
    def sent_kwargs(self) -> dict[str, Any]:
        assert self.dispatch.await_count == 1
        return dict(self.dispatch.await_args.kwargs)


@pytest.fixture()
def fake_runner_manager(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeRunnerManager]:
    fake = FakeRunnerManager(registry=_FakeRegistry(), dispatch=AsyncMock())
    monkeypatch.setattr(
        runner_ws_manager_module, "_runner_websocket_manager", fake, raising=True
    )
    yield fake


@pytest_asyncio.fixture()
async def owner(async_db_session: AsyncSession) -> User:
    return await _make_user(async_db_session, "rdr_owner")


@pytest_asyncio.fixture()
async def stranger(async_db_session: AsyncSession) -> User:
    return await _make_user(async_db_session, "rdr_stranger")


async def _call(
    client: httpx.AsyncClient, case: RouteCase, runner_id: UUID | None = None
) -> httpx.Response:
    params = {"runner_id": str(runner_id)} if runner_id else None
    return await client.post(case.path, params=params, json=case.body)


# =============================================================================
# Selection
# =============================================================================


@pytest.mark.parametrize("case", ROUTE_CASES, ids=lambda c: c.name)
async def test_503_when_no_runner_connected(
    case: RouteCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    owner: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    await _make_device(async_db_session, user=owner, name="offline")
    async with make_client(owner) as client:
        resp = await _call(client, case)
    assert resp.status_code == 503, resp.text
    detail = resp.json()["detail"]
    assert detail["error"] == "no_runner_connected"
    assert detail["endpoint"] == case.endpoint
    fake_runner_manager.dispatch.assert_not_awaited()


@pytest.mark.parametrize("case", ROUTE_CASES, ids=lambda c: c.name)
async def test_foreign_or_unknown_runner_id_is_404(
    case: RouteCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    owner: User,
    stranger: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    theirs = await _make_device(async_db_session, user=stranger, name="theirs")
    fake_runner_manager.connect(theirs)  # connected, but not the caller's
    unknown_id = uuid4()
    async with make_client(owner) as client:
        foreign = await _call(client, case, theirs.device_id)
        unknown = await _call(client, case, unknown_id)
    assert foreign.status_code == 404, foreign.text
    assert foreign.json()["detail"] == {
        "error": "runner_not_found",
        "runner_id": str(theirs.device_id),
    }
    assert unknown.status_code == 404, unknown.text
    assert unknown.json()["detail"] == {
        "error": "runner_not_found",
        "runner_id": str(unknown_id),
    }
    fake_runner_manager.dispatch.assert_not_awaited()


@pytest.mark.parametrize("case", ROUTE_CASES, ids=lambda c: c.name)
async def test_explicit_unregistered_runner_is_503_not_repicked(
    case: RouteCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    owner: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    mine_off = await _make_device(async_db_session, user=owner, name="mine-off")
    mine_on = await _make_device(async_db_session, user=owner, name="mine-on")
    fake_runner_manager.connect(mine_on)
    async with make_client(owner) as client:
        resp = await _call(client, case, mine_off.device_id)
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["error"] == "no_runner_connected"
    assert resp.json()["detail"]["endpoint"] == case.endpoint
    fake_runner_manager.dispatch.assert_not_awaited()


# =============================================================================
# Dispatch failures
# =============================================================================


@pytest.mark.parametrize("case", ROUTE_CASES, ids=lambda c: c.name)
async def test_disconnect_mid_dispatch_is_503(
    case: RouteCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    owner: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    device = await _make_device(async_db_session, user=owner, name="flaky")
    fake_runner_manager.connect(device)
    fake_runner_manager.dispatch.side_effect = RunnerNotConnectedError("gone")
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            resp = await _call(client, case)
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["error"] == "no_runner_connected"
    assert resp.json()["detail"]["endpoint"] == case.endpoint
    events = _own(logs, case)
    assert [e["event"] for e in events] == [
        f"{case.prefix}_dispatch",
        f"{case.prefix}_runner_disconnected_mid_dispatch",
    ]
    assert events[1] == {
        "event": f"{case.prefix}_runner_disconnected_mid_dispatch",
        "log_level": "warning",
        "runner_id": str(device.device_id),
        "request_id": fake_runner_manager.sent_kwargs["request_id"],
    }


@pytest.mark.parametrize("case", ROUTE_CASES, ids=lambda c: c.name)
async def test_timeout_is_504_with_the_routes_timeout(
    case: RouteCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    owner: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    device = await _make_device(async_db_session, user=owner, name="slow")
    fake_runner_manager.connect(device)
    fake_runner_manager.dispatch.side_effect = RunnerCommandTimeoutError(
        str(device.device_id), "req", case.timeout_s
    )
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            resp = await _call(client, case)
    assert resp.status_code == 504, resp.text
    request_id = fake_runner_manager.sent_kwargs["request_id"]
    assert resp.json()["detail"] == {
        "error": "runner_timeout",
        "endpoint": case.endpoint,
        "request_id": request_id,
    }
    assert fake_runner_manager.sent_kwargs["timeout_s"] == case.timeout_s
    events = _own(logs, case)
    assert [e["event"] for e in events] == [
        f"{case.prefix}_dispatch",
        f"{case.prefix}_timeout",
    ]
    assert events[1] == {
        "event": f"{case.prefix}_timeout",
        "log_level": "error",
        "runner_id": str(device.device_id),
        "request_id": request_id,
    }
