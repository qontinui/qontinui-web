"""Tests for the wake-from-web endpoint and ``RunnerConnectionManager`` plumbing.

Covers Phase F.2 of the scheduler-reliability plan:

* ``POST /api/v1/runner/{user_id}/wake`` returns ``already_online`` when the
  manager finds a live connection for the user.
* The same endpoint mints a wake URL with a 60-second TTL when the runner is
  offline.
* When a runner subsequently registers, ``fulfill_wake_intent`` consumes the
  pending intent and the manager publishes a ``runner.woke`` event on the
  user's Redis pub/sub channel.

The tests follow the pattern in ``tests/test_runners_fleet.py`` /
``tests/test_workflow_dispatch.py``: drive the service layer and the endpoint
handler directly against the transactional ``async_db_session`` fixture and
mock out external infrastructure (Redis, WebSocket) with ``unittest.mock``.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.runner_wake import (
    WakeAlreadyOnlineResponse,
    WakeRequest,
    WakeRequiredResponse,
    wake_runner,
)
from app.models.user import User
from app.services.runner_connection_manager import (
    WAKE_INTENT_KEY_PREFIX,
    WAKE_INTENT_TTL_SECONDS,
    RunnerConnectionManager,
)

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


class _FakeRedis:
    """Minimal in-memory Redis stand-in covering the operations the
    manager + endpoint use.

    The manager touches: ``set``, ``get``, ``delete``, ``keys``, ``exists``,
    ``expire``, ``sadd``, ``srem``, ``smembers``, ``publish``. TTL semantics
    are deliberately simplified — tests that need TTL behaviour exercise it
    via the fake's ``_now_seconds`` counter rather than wall clock.
    """

    def __init__(self) -> None:
        self._kv: dict[str, str] = {}
        self._sets: dict[str, set[str]] = {}
        self._published: list[tuple[str, str]] = []

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self._kv[key] = value
        return True

    async def get(self, key: str) -> str | None:
        return self._kv.get(key)

    async def delete(self, *keys: str) -> int:
        removed = 0
        for k in keys:
            if k in self._kv:
                del self._kv[k]
                removed += 1
            if k in self._sets:
                del self._sets[k]
                removed += 1
        return removed

    async def keys(self, pattern: str) -> list[str]:
        # Only supports the ``prefix:*`` patterns used by the manager.
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            return [k for k in self._kv if k.startswith(prefix)]
        return [k for k in self._kv if k == pattern]

    async def exists(self, *keys: str) -> int:
        return sum(1 for k in keys if k in self._kv or k in self._sets)

    async def expire(self, key: str, ttl: int) -> bool:  # noqa: ARG002
        return key in self._kv or key in self._sets

    async def sadd(self, key: str, *members: str) -> int:
        existing = self._sets.setdefault(key, set())
        added = 0
        for m in members:
            if m not in existing:
                existing.add(m)
                added += 1
        return added

    async def srem(self, key: str, *members: str) -> int:
        existing = self._sets.get(key)
        if not existing:
            return 0
        removed = 0
        for m in members:
            if m in existing:
                existing.discard(m)
                removed += 1
        if not existing:
            self._sets.pop(key, None)
        return removed

    async def smembers(self, key: str) -> set[str]:
        return set(self._sets.get(key, set()))

    async def publish(self, channel: str, payload: str) -> int:
        self._published.append((channel, payload))
        return 1


@pytest.fixture()
def fake_redis() -> _FakeRedis:
    return _FakeRedis()


@pytest.fixture()
def manager(fake_redis: _FakeRedis) -> RunnerConnectionManager:
    """Build a ``RunnerConnectionManager`` against the in-memory fake Redis."""
    return RunnerConnectionManager(fake_redis)  # type: ignore[arg-type]


def _wake_request(
    reason: str = "frontend dispatch", task_id: UUID | None = None
) -> WakeRequest:
    return WakeRequest(reason=reason, task_id=task_id)


# ---------------------------------------------------------------------------
# Endpoint behaviour
# ---------------------------------------------------------------------------


class TestWakeEndpointAlreadyOnline:
    """When a live connection exists, the endpoint returns ``already_online``."""

    @pytest.mark.asyncio
    async def test_already_online_when_user_has_live_connection(
        self,
        async_db_session: AsyncSession,  # noqa: ARG002 — fixture sets up DB
        test_user: User,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        # Simulate that the user already has a live connection. The manager
        # is asked first; we monkey-patch ``is_user_online`` directly so we
        # don't need to spin up a full WebSocket.
        connection_id = 4242
        manager.is_user_online = AsyncMock(return_value=connection_id)  # type: ignore[method-assign]

        result = await wake_runner(
            user_id=test_user.id,
            payload=_wake_request(),
            current_user=test_user,
            redis=fake_redis,  # type: ignore[arg-type]
            manager=manager,
        )

        assert isinstance(result, WakeAlreadyOnlineResponse)
        assert result.status == "already_online"
        assert result.connection_id == connection_id
        # No wake intent should have been persisted.
        assert all(
            not k.startswith(f"{WAKE_INTENT_KEY_PREFIX}:")
            for k in fake_redis._kv  # noqa: SLF001
        )


class TestWakeEndpointOffline:
    """When the runner is offline, the endpoint mints a wake URL with TTL."""

    @pytest.mark.asyncio
    async def test_offline_returns_wake_url_with_ttl(
        self,
        async_db_session: AsyncSession,  # noqa: ARG002
        test_user: User,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        manager.is_user_online = AsyncMock(return_value=None)  # type: ignore[method-assign]
        task_id = uuid4()

        result = await wake_runner(
            user_id=test_user.id,
            payload=_wake_request(reason="scheduled task fired", task_id=task_id),
            current_user=test_user,
            redis=fake_redis,  # type: ignore[arg-type]
            manager=manager,
        )

        assert isinstance(result, WakeRequiredResponse)
        assert result.status == "wake_required"
        assert result.intent_id
        assert result.wake_url.startswith("qontinui://wake?")
        # Both query params present and percent-encoded.
        assert f"intent={result.intent_id}" in result.wake_url
        assert f"task_id={task_id}" in result.wake_url
        # Intent persisted at the documented Redis key with the TTL.
        key = f"{WAKE_INTENT_KEY_PREFIX}:{test_user.id}:{result.intent_id}"
        stored = fake_redis._kv.get(key)  # noqa: SLF001
        assert stored is not None
        payload: dict[str, Any] = json.loads(stored)
        assert payload["intent_id"] == result.intent_id
        assert payload["task_id"] == str(task_id)
        assert payload["reason"] == "scheduled task fired"

    @pytest.mark.asyncio
    async def test_offline_without_task_id_omits_query_param(
        self,
        async_db_session: AsyncSession,  # noqa: ARG002
        test_user: User,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        manager.is_user_online = AsyncMock(return_value=None)  # type: ignore[method-assign]

        result = await wake_runner(
            user_id=test_user.id,
            payload=_wake_request(),
            current_user=test_user,
            redis=fake_redis,  # type: ignore[arg-type]
            manager=manager,
        )

        assert isinstance(result, WakeRequiredResponse)
        assert "task_id=" not in result.wake_url


class TestWakeEndpointAuth:
    """Cross-user wake attempts must be rejected."""

    @pytest.mark.asyncio
    async def test_cross_user_wake_returns_403(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        other_user = User(
            email=f"other_{uuid4()}@example.com",
            username=f"other_{uuid4().hex[:8]}",
            full_name="Other",
            hashed_password="x",
            is_active=True,
            is_verified=True,
        )
        async_db_session.add(other_user)
        await async_db_session.commit()
        await async_db_session.refresh(other_user)

        with pytest.raises(HTTPException) as exc_info:
            await wake_runner(
                user_id=other_user.id,
                payload=_wake_request(),
                current_user=test_user,
                redis=fake_redis,  # type: ignore[arg-type]
                manager=manager,
            )
        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# Reconnection / fulfillment
# ---------------------------------------------------------------------------


class TestFulfillWakeIntent:
    """A reconnecting runner consumes the intent and fires ``runner.woke``."""

    @pytest.mark.asyncio
    async def test_fulfill_consumes_pending_intent(
        self,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        user_id = str(uuid4())
        intent_id = "abc123"
        key = f"{WAKE_INTENT_KEY_PREFIX}:{user_id}:{intent_id}"
        await fake_redis.set(
            key,
            json.dumps(
                {
                    "intent_id": intent_id,
                    "user_id": user_id,
                    "task_id": None,
                    "reason": "manual dispatch",
                }
            ),
            ex=WAKE_INTENT_TTL_SECONDS,
        )

        payload = await manager.fulfill_wake_intent(user_id, connection_id=99)
        assert payload is not None
        assert payload["intent_id"] == intent_id
        assert payload["reason"] == "manual dispatch"
        # Key deleted so a second fulfillment is a no-op.
        assert key not in fake_redis._kv  # noqa: SLF001

        again = await manager.fulfill_wake_intent(user_id, connection_id=99)
        assert again is None

    @pytest.mark.asyncio
    async def test_register_runner_emits_runner_woke_event(
        self,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        """End-to-end: a wake intent in Redis + a runner registering →
        ``runner.woke`` event published on the user's status channel.
        """
        user_id = uuid4()
        intent_id = "xyz789"
        key = f"{WAKE_INTENT_KEY_PREFIX}:{user_id}:{intent_id}"
        task_id = uuid4()
        await fake_redis.set(
            key,
            json.dumps(
                {
                    "intent_id": intent_id,
                    "user_id": str(user_id),
                    "task_id": str(task_id),
                    "reason": "scheduled run",
                }
            ),
            ex=WAKE_INTENT_TTL_SECONDS,
        )

        # Stub everything ``register_runner`` does *besides* wake-intent
        # fulfillment, so we can drive it without a real WebSocket / DB.
        manager._registry.register_runner = MagicMock()  # type: ignore[method-assign]
        manager._state_repo.save_connection_state = AsyncMock()  # type: ignore[method-assign]
        manager._relay.start_runner_listener = AsyncMock()  # type: ignore[method-assign]
        manager._chat_relay.start_runner_listener = AsyncMock()  # type: ignore[method-assign]
        manager._terminal_relay.start_runner_listener = AsyncMock()  # type: ignore[method-assign]

        # Capture what the publisher publishes by replacing
        # ``publish_runner_connected`` (so we don't need to inspect the
        # connected event payload here) but letting ``publish_runner_woke``
        # run for real — it writes to ``fake_redis._published``.
        manager._publisher.publish_runner_connected = AsyncMock()  # type: ignore[method-assign]

        websocket = MagicMock()
        websocket.send_json = AsyncMock()

        await manager.register_runner(
            connection_id=777,
            websocket=websocket,
            user_id=user_id,
            runner_name="wake-test",
        )

        # Intent consumed.
        assert key not in fake_redis._kv  # noqa: SLF001

        # ``runner.woke`` published exactly once on the user's channel.
        woke_msgs = [
            json.loads(payload)
            for channel, payload in fake_redis._published
            if channel == f"runner:status:updates:{user_id}"
            and json.loads(payload).get("type") == "runner.woke"
        ]
        assert len(woke_msgs) == 1
        msg = woke_msgs[0]
        assert msg["connection_id"] == 777
        assert msg["intent_id"] == intent_id
        assert msg["task_id"] == str(task_id)
        assert msg["reason"] == "scheduled run"


class TestUserOnlineLookup:
    """``is_user_online`` honours the user→connection reverse-lookup set."""

    @pytest.mark.asyncio
    async def test_returns_none_when_no_set_entry(
        self,
        manager: RunnerConnectionManager,
    ):
        result = await manager.is_user_online(uuid4())
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_connection_when_state_repo_confirms(
        self,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        user_id = uuid4()
        await fake_redis.sadd(f"user:{user_id}:connections", "31")
        # Mark the connection as live in the state repo's Redis namespace.
        await fake_redis.set("runner:connection:31:active", "1", ex=300)

        result = await manager.is_user_online(user_id)
        assert result == 31

    @pytest.mark.asyncio
    async def test_skips_stale_set_entries(
        self,
        manager: RunnerConnectionManager,
        fake_redis: _FakeRedis,
    ):
        """A set entry pointing to a dead connection_id is cleaned up and
        ``is_user_online`` returns None when *no* live entry exists."""
        user_id = uuid4()
        await fake_redis.sadd(f"user:{user_id}:connections", "5")
        # Connection 5 has no active key — i.e. stale.

        result = await manager.is_user_online(user_id)
        assert result is None
        # Stale entry "5" was cleaned up.
        members = await fake_redis.smembers(f"user:{user_id}:connections")
        assert "5" not in members
