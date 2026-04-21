"""Tests for cleanup tasks.

The cleanup task functions internally instantiate ``AsyncSessionLocal`` for a
fresh connection. In tests we monkey-patch those symbols to return the caller's
``async_db_session`` so data written by the test (inside its rollback
transaction) is visible to the task.
"""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.device_session import DeviceSession
from app.models.session_activity import SessionActivity
from app.worker.scheduler import run_all_cleanup_tasks
from app.worker.tasks import (
    cleanup_expired_device_sessions,
    cleanup_expired_sessions,
    cleanup_old_analytics_events,
    cleanup_token_blacklist,
)


def _patch_async_session_local(monkeypatch, session):
    """Redirect AsyncSessionLocal used by cleanup tasks to ``session``.

    ``async with`` the returned object must yield ``session`` itself without
    closing it (the test fixture owns the lifecycle and will roll back).
    """

    class _SessionProxy:
        def __init__(self, inner):
            self._inner = inner

        async def __aenter__(self):
            return self._inner

        async def __aexit__(self, exc_type, exc, tb):
            return None

        # Some tasks call ``await db.commit()``. On the wrapped session this
        # would close the outer fixture transaction, so we turn commits into
        # flushes to keep the transaction open for rollback.
        # (Handled via patching below.)

    def _factory(*args, **kwargs):
        return _SessionProxy(session)

    # Replace commit with flush so the fixture transaction survives.
    original_commit = session.commit

    async def _flush_only():
        await session.flush()

    session.commit = _flush_only  # type: ignore[method-assign]

    # Patch symbols in each cleanup task module that imports AsyncSessionLocal.
    monkeypatch.setattr(
        "app.db.session.AsyncSessionLocal",
        _factory,
        raising=False,
    )
    return original_commit


@pytest.mark.asyncio
async def test_cleanup_expired_sessions(async_db_session, test_user, monkeypatch):
    """Test cleanup of expired SessionActivity records."""
    _patch_async_session_local(monkeypatch, async_db_session)

    expired_session = SessionActivity(
        user_id=test_user.id,
        jti=str(uuid4()),
        first_login_at=datetime.now(UTC) - timedelta(days=60),
        last_activity_at=datetime.now(UTC) - timedelta(days=30),
        absolute_expiry_at=datetime.now(UTC) - timedelta(days=1),
    )
    async_db_session.add(expired_session)

    active_session = SessionActivity(
        user_id=test_user.id,
        jti=str(uuid4()),
        first_login_at=datetime.now(UTC),
        last_activity_at=datetime.now(UTC),
        absolute_expiry_at=datetime.now(UTC) + timedelta(days=30),
    )
    async_db_session.add(active_session)
    await async_db_session.flush()

    ctx: dict[str, object] = {}
    result = await cleanup_expired_sessions(ctx)

    assert result["status"] == "success"
    assert result["deleted_count"] == 1

    sessions = await async_db_session.execute(select(SessionActivity))
    remaining_sessions = sessions.scalars().all()

    assert len(remaining_sessions) == 1
    assert remaining_sessions[0].id == active_session.id


@pytest.mark.asyncio
async def test_cleanup_expired_device_sessions(
    async_db_session, test_user, monkeypatch
):
    """Test cleanup of old DeviceSession records."""
    _patch_async_session_local(monkeypatch, async_db_session)

    old_device = DeviceSession(
        id=uuid4(),
        user_id=test_user.id,
        device_fingerprint="old-device-fingerprint",
        ip_address="192.168.1.1",
        user_agent="Old Browser",
        last_seen=datetime.now(UTC) - timedelta(days=91),
        last_ip="192.168.1.1",
    )
    async_db_session.add(old_device)

    recent_device = DeviceSession(
        id=uuid4(),
        user_id=test_user.id,
        device_fingerprint="recent-device-fingerprint",
        ip_address="192.168.1.2",
        user_agent="Recent Browser",
        last_seen=datetime.now(UTC) - timedelta(days=10),
        last_ip="192.168.1.2",
    )
    async_db_session.add(recent_device)
    await async_db_session.flush()

    ctx: dict[str, object] = {}
    result = await cleanup_expired_device_sessions(ctx)

    assert result["status"] == "success"
    assert result["deleted_count"] == 1
    assert result["days_to_keep"] == 90

    devices = await async_db_session.execute(select(DeviceSession))
    remaining_devices = devices.scalars().all()

    assert len(remaining_devices) == 1
    assert remaining_devices[0].id == recent_device.id


@pytest.mark.asyncio
async def test_cleanup_old_analytics_events(async_db_session, monkeypatch):
    """Test cleanup of old analytics events."""
    _patch_async_session_local(monkeypatch, async_db_session)
    ctx: dict[str, object] = {}
    result = await cleanup_old_analytics_events(ctx)

    # The task now executes a real DELETE; with no analytics rows present
    # the result is still success with zero deletions and the configured
    # retention window surfaced in the payload.
    assert result["status"] == "success"
    assert result["deleted_count"] == 0
    assert result["days_to_keep"] >= 1


@pytest.mark.asyncio
async def test_cleanup_token_blacklist():
    """Test cleanup of expired tokens from blacklist."""
    from app.services.auth.token_blacklist_service import token_blacklist_service

    expired_jti = str(uuid4())
    await token_blacklist_service.blacklist_token(
        expired_jti, expiry=datetime.now(UTC) - timedelta(hours=1)
    )

    active_jti = str(uuid4())
    await token_blacklist_service.blacklist_token(
        active_jti, expiry=datetime.now(UTC) + timedelta(hours=1)
    )

    ctx: dict[str, object] = {}
    result = await cleanup_token_blacklist(ctx)

    assert result["status"] == "success"
    # Note: Redis mode returns 0 (automatic TTL), in-memory mode would clean expired tokens
    assert isinstance(result["deleted_count"], int)


@pytest.mark.asyncio
async def test_run_all_cleanup_tasks(async_db_session, test_user, monkeypatch):
    """Test orchestrated cleanup of all tasks."""
    _patch_async_session_local(monkeypatch, async_db_session)

    expired_session = SessionActivity(
        user_id=test_user.id,
        jti=str(uuid4()),
        first_login_at=datetime.now(UTC) - timedelta(days=60),
        last_activity_at=datetime.now(UTC) - timedelta(days=30),
        absolute_expiry_at=datetime.now(UTC) - timedelta(days=1),
    )
    async_db_session.add(expired_session)

    old_device = DeviceSession(
        id=uuid4(),
        user_id=test_user.id,
        device_fingerprint="old-device",
        ip_address="192.168.1.1",
        user_agent="Old Browser",
        last_seen=datetime.now(UTC) - timedelta(days=91),
        last_ip="192.168.1.1",
    )
    async_db_session.add(old_device)
    await async_db_session.flush()

    ctx: dict[str, object] = {}
    results = await run_all_cleanup_tasks(ctx)

    # Orchestrator aggregates across many optional tasks (S3 archive,
    # automation cleanup, etc.) that rely on real Redis/S3 infra. In the
    # unit-test environment those auxiliary tasks may report partial
    # success, so we tolerate either "success" or "partial_success" and
    # assert the core deletions happened.
    assert results["status"] in ("success", "partial_success")
    assert "tasks" in results
    assert "total_deleted" in results
    assert results["total_deleted"] >= 2  # expired session + old device

    assert "sessions" in results["tasks"]
    assert "device_sessions" in results["tasks"]
    assert "analytics_events" in results["tasks"]
    assert "token_blacklist" in results["tasks"]

    # The core DB-only cleanup tasks must succeed.
    for core_task in ("sessions", "device_sessions", "analytics_events"):
        assert results["tasks"][core_task]["status"] == "success"


@pytest.mark.asyncio
async def test_cleanup_with_no_data(async_db_session, monkeypatch):
    """Test cleanup when there's no data to clean."""
    _patch_async_session_local(monkeypatch, async_db_session)
    ctx: dict[str, object] = {}

    result = await cleanup_expired_sessions(ctx)
    assert result["status"] == "success"
    assert result["deleted_count"] == 0

    result = await cleanup_expired_device_sessions(ctx)
    assert result["status"] == "success"
    assert result["deleted_count"] == 0


@pytest.mark.asyncio
async def test_cleanup_execution_time(async_db_session, monkeypatch):
    """Test that cleanup tasks measure execution time."""
    _patch_async_session_local(monkeypatch, async_db_session)
    ctx: dict[str, object] = {}
    result = await cleanup_expired_sessions(ctx)

    assert "execution_time_seconds" in result
    assert isinstance(result["execution_time_seconds"], int | float)
    assert result["execution_time_seconds"] >= 0


@pytest.mark.asyncio
async def test_cleanup_timestamp(async_db_session, monkeypatch):
    """Test that cleanup tasks include timestamp."""
    _patch_async_session_local(monkeypatch, async_db_session)
    ctx: dict[str, object] = {}
    result = await cleanup_expired_sessions(ctx)

    assert "timestamp" in result
    # Verify timestamp is valid ISO format
    timestamp = datetime.fromisoformat(result["timestamp"].replace("Z", "+00:00"))
    assert isinstance(timestamp, datetime)


# Keep the asynccontextmanager import available for possible future use.
_ = asynccontextmanager
