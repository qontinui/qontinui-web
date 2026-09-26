"""Direct tests for ``POST /api/v1/events/phase-completed``.

Phase 5 of ``2026-09-12-residual-work-from-the-april-2026-plan-audit``. The
handler (``ingest_phase_completed`` in ``app/api/v1/endpoints/events.py``) was
previously exercised only incidentally; the two test files an earlier plan
cited for it were never committed. Its attribution branches are where
misattribution would hide, so each is pinned here:

* explicit ``runner_id`` owned by the caller -> 202, row attributed to it;
* explicit ``runner_id`` that does not exist -> 404;
* explicit ``runner_id`` owned by another user -> 403 and NOTHING written;
* no ``runner_id`` -> the most-recently-heartbeated *paired* device wins;
* no ``runner_id`` and no paired device -> 202, NULL runner, "server-device";
* the companion ``WorkflowEvent`` row and the background push dispatch;
* a missing device bearer -> 401.

Layering mirrors ``tests/test_plan_library_followups.py``: the events router is
mounted on a bare ``FastAPI`` and driven through ``httpx.AsyncClient`` over
``ASGITransport`` so the handler shares the test's asyncio loop and the
rolled-back ``async_db_session``. Device authentication is replaced with an
``app.dependency_overrides`` entry for ``get_authenticated_device`` — the
override fixture is :func:`_build_app`'s ``device_user`` argument; passing
``None`` leaves the real dependency in place (used by the 401 case).

The push fan-out is never run for real: ``_dispatch_push_for_event_id`` is
patched on the endpoint module, and the ASGI transport runs the scheduled
background task against the mock after the response is sent.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DeviceTokenContext, get_async_db, get_authenticated_device
from app.api.v1.endpoints import events as events_module
from app.models.device import Device
from app.models.phase_result import PhaseResult
from app.models.user import User
from app.models.workflow_event import WorkflowEvent, WorkflowEventType

pytestmark = pytest.mark.asyncio

API_PREFIX = "/api/v1/events"
ENDPOINT = f"{API_PREFIX}/phase-completed"


def _build_app(*, db_session: AsyncSession, device_user: User | None) -> FastAPI:
    """Mount the events router with the DB (and optionally device auth) overridden.

    ``device_user`` set: ``get_authenticated_device`` resolves to a
    :class:`DeviceTokenContext` for that user without any JWT or JWKS.
    ``device_user`` ``None``: the real dependency stays, so an unauthenticated
    request exercises the actual bearer scheme.
    """
    app = FastAPI()

    async def _db_override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override

    if device_user is not None:
        ctx = DeviceTokenContext(
            claims={
                "device_id": str(uuid4()),
                "user_id": str(device_user.id),
                "tenant_id": "tenant-test",
            },
            user=device_user,
        )
        app.dependency_overrides[get_authenticated_device] = lambda: ctx

    app.include_router(events_module.router, prefix=API_PREFIX)
    return app


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


async def _make_device(
    db: AsyncSession,
    *,
    user: User,
    name: str,
    paired: bool = True,
    last_heartbeat: datetime | None = None,
) -> Device:
    device = Device(
        device_id=uuid4(),
        user_id=user.id,
        name=name,
        hostname=name,
        state="healthy",
        capability_user_paired=paired,
        paired_at=datetime.now(UTC) if paired else None,
        last_heartbeat=last_heartbeat,
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


def _payload(*, execution_id: str, runner_id: UUID | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "execution_id": execution_id,
        "phase": "verification",
        "iteration": 2,
        "stage_index": 1,
        "success": True,
        "all_passed": False,
        "duration_ms": 1234,
        "step_results": [
            {"step_index": 0, "step_type": "command", "duration_ms": 12},
        ],
    }
    if runner_id is not None:
        body["runner_id"] = str(runner_id)
    return body


async def _phase_results(db: AsyncSession, execution_id: str) -> list[PhaseResult]:
    rows = await db.execute(
        select(PhaseResult).where(PhaseResult.execution_id == execution_id)
    )
    return list(rows.scalars().all())


async def _workflow_events(db: AsyncSession, execution_id: str) -> list[WorkflowEvent]:
    rows = await db.execute(
        select(WorkflowEvent).where(WorkflowEvent.run_id == execution_id)
    )
    return list(rows.scalars().all())


@pytest_asyncio.fixture()
async def caller(async_db_session: AsyncSession) -> User:
    return await _make_user(async_db_session, "phase_caller")


@pytest.fixture()
def dispatch_mock() -> Any:
    """Replace the push fan-out so no real dispatch ever runs."""
    with patch.object(
        events_module, "_dispatch_push_for_event_id", new=AsyncMock()
    ) as mock:
        yield mock


ClientFactory = Callable[[User | None], httpx.AsyncClient]


@pytest.fixture()
def make_client(async_db_session: AsyncSession) -> ClientFactory:
    def _factory(device_user: User | None) -> httpx.AsyncClient:
        app = _build_app(db_session=async_db_session, device_user=device_user)
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    return _factory


# ===========================================================================
# Explicit runner_id
# ===========================================================================


async def test_explicit_runner_owned_by_caller_is_attributed(
    async_db_session: AsyncSession,
    caller: User,
    make_client: ClientFactory,
    dispatch_mock: AsyncMock,
) -> None:
    device = await _make_device(async_db_session, user=caller, name="owned-runner")
    # A newer-heartbeated paired device must NOT win over the explicit id.
    await _make_device(
        async_db_session,
        user=caller,
        name="decoy-runner",
        last_heartbeat=datetime.now(UTC),
    )
    execution_id = f"exec-{uuid4().hex}"

    async with make_client(caller) as client:
        resp = await client.post(
            ENDPOINT,
            json=_payload(execution_id=execution_id, runner_id=device.device_id),
        )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["runner_id"] == str(device.device_id)
    assert body["execution_id"] == execution_id

    rows = await _phase_results(async_db_session, execution_id)
    assert len(rows) == 1
    assert rows[0].runner_id == device.device_id
    assert str(rows[0].id) == body["id"]

    events = await _workflow_events(async_db_session, execution_id)
    assert len(events) == 1
    assert events[0].device_id == str(device.device_id)
    assert events[0].runner_name == "owned-runner"


async def test_explicit_runner_that_does_not_exist_is_404(
    async_db_session: AsyncSession,
    caller: User,
    make_client: ClientFactory,
    dispatch_mock: AsyncMock,
) -> None:
    execution_id = f"exec-{uuid4().hex}"

    async with make_client(caller) as client:
        resp = await client.post(
            ENDPOINT, json=_payload(execution_id=execution_id, runner_id=uuid4())
        )

    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "Device not found"
    assert await _phase_results(async_db_session, execution_id) == []
    assert await _workflow_events(async_db_session, execution_id) == []
    dispatch_mock.assert_not_called()


async def test_explicit_runner_owned_by_another_user_is_403_and_writes_nothing(
    async_db_session: AsyncSession,
    caller: User,
    make_client: ClientFactory,
    dispatch_mock: AsyncMock,
) -> None:
    stranger = await _make_user(async_db_session, "phase_stranger")
    foreign = await _make_device(async_db_session, user=stranger, name="foreign-runner")
    execution_id = f"exec-{uuid4().hex}"
    phase_rows_before = await async_db_session.scalar(
        select(func.count()).select_from(PhaseResult)
    )
    event_rows_before = await async_db_session.scalar(
        select(func.count()).select_from(WorkflowEvent)
    )

    async with make_client(caller) as client:
        resp = await client.post(
            ENDPOINT,
            json=_payload(execution_id=execution_id, runner_id=foreign.device_id),
        )

    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == "Device belongs to a different user"
    # Nothing written at all — not just nothing for this execution id.
    assert await _phase_results(async_db_session, execution_id) == []
    assert await _workflow_events(async_db_session, execution_id) == []
    assert (
        await async_db_session.scalar(select(func.count()).select_from(PhaseResult))
        == phase_rows_before
    )
    assert (
        await async_db_session.scalar(select(func.count()).select_from(WorkflowEvent))
        == event_rows_before
    )
    dispatch_mock.assert_not_called()


# ===========================================================================
# Fallback attribution (no runner_id)
# ===========================================================================


async def test_fallback_picks_most_recently_heartbeated_paired_device(
    async_db_session: AsyncSession,
    caller: User,
    make_client: ClientFactory,
    dispatch_mock: AsyncMock,
) -> None:
    now = datetime.now(UTC)
    await _make_device(
        async_db_session,
        user=caller,
        name="older-paired",
        last_heartbeat=now - timedelta(hours=1),
    )
    newer = await _make_device(
        async_db_session,
        user=caller,
        name="newer-paired",
        last_heartbeat=now - timedelta(minutes=1),
    )
    # The freshest heartbeat of all, but not user-paired: must be ignored.
    await _make_device(
        async_db_session,
        user=caller,
        name="unpaired-freshest",
        paired=False,
        last_heartbeat=now,
    )
    # Another user's paired device with the freshest heartbeat: never chosen.
    stranger = await _make_user(async_db_session, "phase_stranger")
    await _make_device(
        async_db_session, user=stranger, name="stranger-paired", last_heartbeat=now
    )
    execution_id = f"exec-{uuid4().hex}"

    async with make_client(caller) as client:
        resp = await client.post(ENDPOINT, json=_payload(execution_id=execution_id))

    assert resp.status_code == 202, resp.text
    assert resp.json()["runner_id"] == str(newer.device_id)

    rows = await _phase_results(async_db_session, execution_id)
    assert len(rows) == 1
    assert rows[0].runner_id == newer.device_id

    events = await _workflow_events(async_db_session, execution_id)
    assert len(events) == 1
    assert events[0].device_id == str(newer.device_id)
    assert events[0].runner_name == "newer-paired"


async def test_fallback_with_no_paired_device_writes_null_runner(
    async_db_session: AsyncSession,
    caller: User,
    make_client: ClientFactory,
    dispatch_mock: AsyncMock,
) -> None:
    # An unpaired device exists but must not be used for attribution.
    await _make_device(
        async_db_session,
        user=caller,
        name="unpaired-only",
        paired=False,
        last_heartbeat=datetime.now(UTC),
    )
    execution_id = f"exec-{uuid4().hex}"

    async with make_client(caller) as client:
        resp = await client.post(ENDPOINT, json=_payload(execution_id=execution_id))

    assert resp.status_code == 202, resp.text
    assert resp.json()["runner_id"] is None

    rows = await _phase_results(async_db_session, execution_id)
    assert len(rows) == 1
    assert rows[0].runner_id is None

    events = await _workflow_events(async_db_session, execution_id)
    assert len(events) == 1
    assert events[0].device_id == "server-device"
    assert events[0].runner_name == "unknown"


# ===========================================================================
# Companion WorkflowEvent + background dispatch
# ===========================================================================


async def test_companion_event_and_push_dispatch(
    async_db_session: AsyncSession,
    caller: User,
    make_client: ClientFactory,
    dispatch_mock: AsyncMock,
) -> None:
    device = await _make_device(async_db_session, user=caller, name="event-runner")
    execution_id = f"exec-{uuid4().hex}"

    async with make_client(caller) as client:
        resp = await client.post(
            ENDPOINT,
            json=_payload(execution_id=execution_id, runner_id=device.device_id),
        )

    assert resp.status_code == 202, resp.text
    phase_result_id = resp.json()["id"]

    events = await _workflow_events(async_db_session, execution_id)
    assert len(events) == 1
    event = events[0]
    assert event.event_type == WorkflowEventType.PHASE_COMPLETED.value
    assert event.event_type == "phase_completed"
    assert event.run_id == execution_id
    assert event.user_id == caller.id
    # ``WorkflowEvent.payload`` is a classic ``Column(JSONB)``; read it as a dict.
    payload = cast(dict[str, Any], event.payload)
    assert payload["phase_result_id"] == phase_result_id
    assert payload["phase"] == "verification"
    assert payload["success"] is True
    assert payload["all_passed"] is False
    assert payload["iteration"] == 2
    assert payload["stage_index"] == 1
    assert payload["duration_ms"] == 1234
    assert event.summary == "Phase 'verification' succeeded in 1234ms"

    # Exactly one background task, the shared dispatcher, keyed on the new
    # event's id (a UUID, not the string form).
    dispatch_mock.assert_awaited_once()
    await_args = dispatch_mock.await_args
    assert await_args is not None
    (dispatched_id,), kwargs = await_args
    assert kwargs == {}
    assert isinstance(dispatched_id, UUID)
    assert dispatched_id == event.id


# ===========================================================================
# Authentication
# ===========================================================================


async def test_missing_device_token_is_401(
    async_db_session: AsyncSession,
    make_client: ClientFactory,
    dispatch_mock: AsyncMock,
) -> None:
    execution_id = f"exec-{uuid4().hex}"

    async with make_client(None) as client:
        resp = await client.post(ENDPOINT, json=_payload(execution_id=execution_id))

    assert resp.status_code == 401, resp.text
    assert await _phase_results(async_db_session, execution_id) == []
    assert await _workflow_events(async_db_session, execution_id) == []
    dispatch_mock.assert_not_called()
