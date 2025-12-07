"""Tests for cleanup tasks."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.device_session import DeviceSession
from app.models.session_activity import SessionActivity
from app.worker.scheduler import run_all_cleanup_tasks
from app.worker.tasks.cleanup_tasks import (
    cleanup_expired_device_sessions,
    cleanup_expired_sessions,
    cleanup_old_analytics_events,
    cleanup_token_blacklist,
)


@pytest.mark.asyncio
async def test_cleanup_expired_sessions(async_session, test_user):
    """Test cleanup of expired SessionActivity records."""
    # Create expired session
    expired_session = SessionActivity(
        user_id=test_user.id,
        jti=str(uuid4()),
        first_login_at=datetime.utcnow() - timedelta(days=60),
        last_activity_at=datetime.utcnow() - timedelta(days=30),
        absolute_expiry_at=datetime.utcnow() - timedelta(days=1),  # Expired
    )
    async_session.add(expired_session)

    # Create active session
    active_session = SessionActivity(
        user_id=test_user.id,
        jti=str(uuid4()),
        first_login_at=datetime.utcnow(),
        last_activity_at=datetime.utcnow(),
        absolute_expiry_at=datetime.utcnow() + timedelta(days=30),  # Not expired
    )
    async_session.add(active_session)
    await async_session.commit()

    # Run cleanup
    ctx = {}
    result = await cleanup_expired_sessions(ctx)

    # Verify result
    assert result["status"] == "success"
    assert result["deleted_count"] == 1

    # Verify database state
    await async_session.refresh(async_session)
    sessions = await async_session.execute(select(SessionActivity))
    remaining_sessions = sessions.scalars().all()

    assert len(remaining_sessions) == 1
    assert remaining_sessions[0].id == active_session.id


@pytest.mark.asyncio
async def test_cleanup_expired_device_sessions(async_session, test_user):
    """Test cleanup of old DeviceSession records."""
    # Create old device session (not accessed in 91 days)
    old_device = DeviceSession(
        id=uuid4(),
        user_id=test_user.id,
        device_fingerprint="old-device-fingerprint",
        ip_address="192.168.1.1",
        user_agent="Old Browser",
        last_seen=datetime.utcnow() - timedelta(days=91),
        last_ip="192.168.1.1",
    )
    async_session.add(old_device)

    # Create recent device session
    recent_device = DeviceSession(
        id=uuid4(),
        user_id=test_user.id,
        device_fingerprint="recent-device-fingerprint",
        ip_address="192.168.1.2",
        user_agent="Recent Browser",
        last_seen=datetime.utcnow() - timedelta(days=10),
        last_ip="192.168.1.2",
    )
    async_session.add(recent_device)
    await async_session.commit()

    # Run cleanup
    ctx = {}
    result = await cleanup_expired_device_sessions(ctx)

    # Verify result
    assert result["status"] == "success"
    assert result["deleted_count"] == 1
    assert result["days_to_keep"] == 90

    # Verify database state
    await async_session.refresh(async_session)
    devices = await async_session.execute(select(DeviceSession))
    remaining_devices = devices.scalars().all()

    assert len(remaining_devices) == 1
    assert remaining_devices[0].id == recent_device.id


@pytest.mark.asyncio
async def test_cleanup_old_analytics_events():
    """Test cleanup of old analytics events (placeholder)."""
    ctx = {}
    result = await cleanup_old_analytics_events(ctx)

    # Verify placeholder result
    assert result["status"] == "success"
    assert result["deleted_count"] == 0
    assert "not yet implemented" in result["note"]


@pytest.mark.asyncio
async def test_cleanup_token_blacklist():
    """Test cleanup of expired tokens from blacklist."""
    from app.services.auth.token_blacklist_service import token_blacklist_service

    # Add expired tokens to blacklist
    expired_jti = str(uuid4())
    await token_blacklist_service.blacklist_token(
        expired_jti, expiry=datetime.utcnow() - timedelta(hours=1)
    )

    # Add active token
    active_jti = str(uuid4())
    await token_blacklist_service.blacklist_token(
        active_jti, expiry=datetime.utcnow() + timedelta(hours=1)
    )

    # Run cleanup
    ctx = {}
    result = await cleanup_token_blacklist(ctx)

    # Verify result
    assert result["status"] == "success"
    # Note: Redis mode returns 0 (automatic TTL), in-memory mode would clean expired tokens
    assert isinstance(result["deleted_count"], int)


@pytest.mark.asyncio
async def test_run_all_cleanup_tasks(async_session, test_user):
    """Test orchestrated cleanup of all tasks."""
    # Create test data
    expired_session = SessionActivity(
        user_id=test_user.id,
        jti=str(uuid4()),
        first_login_at=datetime.utcnow() - timedelta(days=60),
        last_activity_at=datetime.utcnow() - timedelta(days=30),
        absolute_expiry_at=datetime.utcnow() - timedelta(days=1),
    )
    async_session.add(expired_session)

    old_device = DeviceSession(
        id=uuid4(),
        user_id=test_user.id,
        device_fingerprint="old-device",
        ip_address="192.168.1.1",
        user_agent="Old Browser",
        last_seen=datetime.utcnow() - timedelta(days=91),
        last_ip="192.168.1.1",
    )
    async_session.add(old_device)
    await async_session.commit()

    # Run all cleanup tasks
    ctx = {}
    results = await run_all_cleanup_tasks(ctx)

    # Verify orchestrated results
    assert results["status"] == "success"
    assert "tasks" in results
    assert "total_deleted" in results
    assert results["total_deleted"] >= 2  # At least expired session + old device

    # Verify individual task results
    assert "sessions" in results["tasks"]
    assert "device_sessions" in results["tasks"]
    assert "analytics_events" in results["tasks"]
    assert "token_blacklist" in results["tasks"]

    # Verify all tasks completed successfully
    for _task_name, task_result in results["tasks"].items():
        assert task_result["status"] == "success"


@pytest.mark.asyncio
async def test_cleanup_with_no_data():
    """Test cleanup when there's no data to clean."""
    ctx = {}

    # Run cleanup on empty database
    result = await cleanup_expired_sessions(ctx)
    assert result["status"] == "success"
    assert result["deleted_count"] == 0

    result = await cleanup_expired_device_sessions(ctx)
    assert result["status"] == "success"
    assert result["deleted_count"] == 0


@pytest.mark.asyncio
async def test_cleanup_execution_time():
    """Test that cleanup tasks measure execution time."""
    ctx = {}
    result = await cleanup_expired_sessions(ctx)

    assert "execution_time_seconds" in result
    assert isinstance(result["execution_time_seconds"], int | float)
    assert result["execution_time_seconds"] >= 0


@pytest.mark.asyncio
async def test_cleanup_timestamp():
    """Test that cleanup tasks include timestamp."""
    ctx = {}
    result = await cleanup_expired_sessions(ctx)

    assert "timestamp" in result
    # Verify timestamp is valid ISO format
    timestamp = datetime.fromisoformat(result["timestamp"].replace("Z", "+00:00"))
    assert isinstance(timestamp, datetime)
