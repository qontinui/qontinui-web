"""
Runner WebSocket Manager — unified runner WS orchestration (Phase 2B).

Replaces the old ``RunnerConnectionManager`` keyed by integer
``connection_id``. The unified runner architecture (see
``unified-runner-architecture.md``) keys everything by ``runner_id`` —
the canonical UUID of a row in the ``runners`` table — and the manager
fans messages to/from per-consumer (frontend / mobile) WebSockets.

Architecture:
- Runners connect to ``WS /api/v1/runners/ws`` and register with their
  ``runner_id`` (a UUID stringified to a string here).
- Frontend connects to ``WS /api/v1/runners/{runner_id}/command`` to send
  commands.
- Mobile connects to ``WS /api/v1/runners/{runner_id}/chat`` /
  ``/{runner_id}/terminal`` for chat/terminal relay.
- Commands and responses fan out via Redis pub/sub on
  ``runner:commands:{runner_id}``, ``runner:responses:{runner_id}``,
  ``runner:chat:{runner_id}``, ``runner:chat_response:{runner_id}``,
  ``runner:terminal:{runner_id}`` and ``runner:terminal_response:{runner_id}``.

The internal services (``WebSocketConnectionRegistry``,
``RunnerStateRepository``, ``CommandRelayService``,
``ChatRelayService``, ``TerminalRelayService``,
``RunnerEventPublisher``) all consume the runner-id string verbatim;
nothing in the architecture cares about the original-integer shape any
more.
"""

import asyncio
import json
from typing import Any
from uuid import UUID

import structlog
from fastapi import WebSocket
from redis import asyncio as aioredis

from app.services.runner.chat_relay import ChatRelayService
from app.services.runner.command_relay import CommandRelayService
from app.services.runner.connection_registry import WebSocketConnectionRegistry
from app.services.runner.event_publisher import RunnerEventPublisher
from app.services.runner.state_repository import RunnerStateRepository
from app.services.runner.terminal_relay import TerminalRelayService

logger = structlog.get_logger(__name__)

# Redis TTL for the user:{user_id}:runners reverse-lookup set entries.
# Matches the per-runner TTL used by RunnerStateRepository so a stale
# user-set entry expires roughly in lockstep with the runner it points to.
USER_RUNNERS_TTL_SECONDS = 300

# Wake-intent Redis key prefix and TTL. Used by the wake-from-web flow.
WAKE_INTENT_KEY_PREFIX = "wake_intent"
WAKE_INTENT_TTL_SECONDS = 60


def _rid(runner_id: UUID | str) -> str:
    """Coerce a runner identifier to its canonical string form."""
    return str(runner_id)


class RunnerWebSocketManager:
    """
    Unified facade orchestrating per-runner WebSocket sessions.

    Keyed by ``runner_id`` (UUID string) end-to-end. Singleton instance
    accessed via :func:`get_runner_websocket_manager`.
    """

    def __init__(self, redis_client: aioredis.Redis):
        self._registry = WebSocketConnectionRegistry()
        self._state_repo = RunnerStateRepository(redis_client)
        self._relay = CommandRelayService(redis_client, self._registry)
        self._chat_relay = ChatRelayService(redis_client, self._registry)
        self._terminal_relay = TerminalRelayService(redis_client, self._registry)
        self._publisher = RunnerEventPublisher(redis_client)
        self._redis = redis_client
        # Per-runner locks to synchronize WebSocket sends across relay services
        self._ws_send_locks: dict[str, asyncio.Lock] = {}

        logger.info("runner_websocket_manager_initialized")

    # ========================================================================
    # Runner Registration
    # ========================================================================

    async def register(
        self,
        runner_id: UUID | str,
        websocket: WebSocket,
        user_id: UUID,
        runner_name: str | None = None,
        ip_address: str | None = None,
        connected_at: str | None = None,
    ) -> None:
        """
        Register a runner WebSocket connection.

        Stores connection state in Redis for persistence across server
        restarts and starts the per-relay listener loops.
        """
        rid = _rid(runner_id)

        # Registration must be ALL-OR-NOTHING. Each step below acquires a
        # resource that holds a Redis connection for the lifetime of the
        # registration: ``save_connection_state`` / ``_save_user_runner_mapping``
        # issue pooled commands, and — critically — each relay
        # ``start_runner_listener`` spawns a task that runs ``pubsub.subscribe``
        # and holds a *dedicated* pooled connection until the task is cancelled
        # and its ``finally`` runs ``pubsub.close()``.
        #
        # If a step raises midway (observed on prod: the ``self._redis.set`` in
        # ``save_connection_state`` raising ``redis.exceptions.ConnectionError:
        # Too many connections`` under runner-reconnect churn), the caller's
        # except path closes the socket and returns WITHOUT calling
        # ``unregister`` — so the in-memory registry entry, send lock, and any
        # listener tasks + their pubsub connections are orphaned. Each failed
        # reconnect then drains the pool a little further, a self-reinforcing
        # leak until the pool is exhausted and every registration fails.
        #
        # Wrap the whole body so that on ANY failure we tear down every
        # resource acquired so far (cancelling listeners returns their pubsub
        # connections to the pool) before re-raising. The success path is
        # unchanged.
        self._registry.register_runner(rid, websocket)
        self._ws_send_locks[rid] = asyncio.Lock()

        try:
            await self._state_repo.save_connection_state(
                runner_id=rid,
                user_id=str(user_id),
                connected_at=connected_at or "",
                runner_name=runner_name,
                ip_address=ip_address,
            )
            await self._save_user_runner_mapping(user_id, rid)

            send_lock = self._ws_send_locks[rid]

            async def locked_send(data: dict[str, Any]) -> None:
                async with send_lock:
                    await websocket.send_json(data)

            await self._relay.start_runner_listener(rid, websocket, send_fn=locked_send)
            await self._chat_relay.start_runner_listener(
                rid, websocket, send_fn=locked_send
            )
            await self._terminal_relay.start_runner_listener(
                rid, websocket, send_fn=locked_send
            )
        except Exception:
            await self._rollback_partial_registration(rid)
            raise

        logger.info(
            "runner_ws_registered",
            runner_id=rid,
            user_id=str(user_id),
            runner_name=runner_name,
        )

    async def _rollback_partial_registration(self, rid: str) -> None:
        """Tear down resources acquired by a ``register`` that failed midway.

        Cancels any relay listener tasks (so their ``finally`` runs
        ``pubsub.close()`` and the dedicated pubsub connection returns to the
        pool), drops the in-memory registry entry and send lock, and best-effort
        clears the Redis connection state. Each step is independently guarded so
        one failing teardown never masks another — the goal is to leak nothing
        on the failure path. Safe to call when a step never ran (the relay
        ``stop_runner_listener`` / registry helpers are no-ops for unknown ids).
        """
        for name, teardown in (
            ("command_listener", self._relay.stop_runner_listener),
            ("chat_listener", self._chat_relay.stop_runner_listener),
            ("terminal_listener", self._terminal_relay.stop_runner_listener),
        ):
            try:
                await teardown(rid)
            except Exception as exc:
                logger.warning(
                    "register_rollback_step_failed",
                    runner_id=rid,
                    step=name,
                    error=str(exc),
                )

        try:
            self._registry.unregister_runner(rid)
        except Exception as exc:
            logger.warning(
                "register_rollback_step_failed",
                runner_id=rid,
                step="registry_unregister",
                error=str(exc),
            )

        self._ws_send_locks.pop(rid, None)

        try:
            await self._state_repo.delete_connection_state(rid)
        except Exception as exc:
            logger.warning(
                "register_rollback_step_failed",
                runner_id=rid,
                step="delete_connection_state",
                error=str(exc),
            )

        logger.info("runner_ws_register_rolled_back", runner_id=rid)

    async def unregister(
        self,
        runner_id: UUID | str,
        user_id: UUID | None = None,
    ) -> None:
        """Unregister a runner WebSocket connection."""
        rid = _rid(runner_id)

        if user_id is None:
            metadata = await self._state_repo.get_connection_metadata(rid)
            if metadata:
                try:
                    user_id = UUID(metadata.get("user_id"))
                except Exception:
                    pass

        await self._state_repo.delete_connection_state(rid)

        if user_id is not None:
            await self._remove_user_runner_mapping(user_id, rid)

        self._registry.unregister_runner(rid)

        await self._relay.stop_runner_listener(rid)

        # Notify mobile + frontend clients before stopping listeners
        from qontinui_schemas.common import utc_now

        await self._chat_relay.notify_mobiles(
            rid,
            {
                "type": "runner_disconnected",
                "runner_id": rid,
                "timestamp": utc_now().isoformat(),
            },
        )
        await self._chat_relay.stop_runner_listener(rid)
        await self._terminal_relay.notify_mobiles(
            rid,
            {
                "type": "runner_disconnected",
                "runner_id": rid,
                "timestamp": utc_now().isoformat(),
            },
        )
        await self._terminal_relay.stop_runner_listener(rid)
        self._ws_send_locks.pop(rid, None)
        await self._relay.notify_frontends(
            rid,
            {"type": "runner_disconnected", "timestamp": utc_now().isoformat()},
        )

        logger.info("runner_ws_unregistered", runner_id=rid)

    # ========================================================================
    # Frontend / Mobile registration helpers
    # ========================================================================

    async def connect_frontend(
        self, runner_id: UUID | str, websocket: WebSocket, user_id: UUID
    ) -> bool:
        """Register a frontend WebSocket against a connected runner."""
        rid = _rid(runner_id)
        if not self._registry.is_runner_connected(rid):
            logger.warning(
                "frontend_connect_runner_not_found",
                runner_id=rid,
                user_id=str(user_id),
            )
            return False
        self._registry.register_frontend(rid, websocket)
        await self._relay.start_frontend_listener(rid, websocket)
        return True

    async def disconnect_frontend(
        self, runner_id: UUID | str, websocket: WebSocket
    ) -> None:
        """Unregister a frontend WebSocket from a runner."""
        rid = _rid(runner_id)
        self._registry.unregister_frontend(rid, websocket)
        await self._relay.stop_frontend_listener(rid, websocket)

    async def connect_mobile_chat(
        self, runner_id: UUID | str, websocket: WebSocket, user_id: UUID
    ) -> bool:
        """Register a mobile chat WebSocket."""
        rid = _rid(runner_id)
        if not self._registry.is_runner_connected(rid):
            return False
        await self._chat_relay.start_mobile_listener(rid, websocket)
        return True

    async def disconnect_mobile_chat(
        self, runner_id: UUID | str, websocket: WebSocket
    ) -> None:
        """Unregister a mobile chat WebSocket."""
        rid = _rid(runner_id)
        await self._chat_relay.stop_mobile_listener(rid, websocket)

    async def connect_mobile_terminal(
        self, runner_id: UUID | str, websocket: WebSocket, user_id: UUID
    ) -> bool:
        """Register a mobile terminal WebSocket. Always starts listener so events still flow."""
        rid = _rid(runner_id)
        runner_connected = self._registry.is_runner_connected(rid)
        await self._terminal_relay.start_mobile_listener(rid, websocket)
        if runner_connected:
            # Tell the runner a mobile is now watching this terminal so it
            # starts forwarding terminal_output/terminal_exit frames. The
            # runner keeps a subscriber counter, so one subscribe per connect
            # is correct even with multiple mobiles on the same runner.
            await self._relay.send_command_to_runner(
                rid, {"type": "terminal_subscribe", "runner_id": rid}
            )
        return runner_connected

    async def disconnect_mobile_terminal(
        self, runner_id: UUID | str, websocket: WebSocket
    ) -> None:
        rid = _rid(runner_id)
        await self._terminal_relay.stop_mobile_listener(rid, websocket)
        # Best-effort: the runner may already be gone on disconnect, which is
        # fine — its subscriber counter is decremented per unsubscribe.
        try:
            await self._relay.send_command_to_runner(
                rid, {"type": "terminal_unsubscribe", "runner_id": rid}
            )
        except Exception as exc:
            logger.debug(
                "terminal_unsubscribe_send_failed",
                runner_id=rid,
                error=str(exc),
            )

    # ========================================================================
    # Outbound sends (typed)
    # ========================================================================

    async def send_dispatch(
        self, runner_id: UUID | str, payload: dict[str, Any]
    ) -> bool:
        """Send a typed ``dispatch`` message to the runner over its WS."""
        rid = _rid(runner_id)
        msg = {"type": "dispatch", **payload}
        return await self._relay.send_command_to_runner(rid, msg)

    async def send_command(
        self, runner_id: UUID | str, command: dict[str, Any]
    ) -> bool:
        """Send a generic command from frontend to runner."""
        rid = _rid(runner_id)
        return await self._relay.send_command_to_runner(rid, command)

    async def send_chat(self, runner_id: UUID | str, message: dict[str, Any]) -> bool:
        """Send a chat message from mobile to runner."""
        rid = _rid(runner_id)
        return await self._chat_relay.send_chat_to_runner(rid, message)

    async def send_terminal(
        self, runner_id: UUID | str, message: dict[str, Any]
    ) -> bool:
        """Send a terminal message from mobile to runner."""
        rid = _rid(runner_id)
        return await self._terminal_relay.send_terminal_to_runner(rid, message)

    async def send_response_to_frontends(
        self, runner_id: UUID | str, response: dict[str, Any]
    ) -> None:
        rid = _rid(runner_id)
        await self._relay.send_response_to_frontends(rid, response)

    async def send_chat_response_to_mobiles(
        self, runner_id: UUID | str, response: dict[str, Any]
    ) -> None:
        rid = _rid(runner_id)
        await self._chat_relay.send_response_to_mobiles(rid, response)

    async def send_terminal_response_to_mobiles(
        self, runner_id: UUID | str, response: dict[str, Any]
    ) -> None:
        rid = _rid(runner_id)
        await self._terminal_relay.send_response_to_mobiles(rid, response)

    # ========================================================================
    # Service accessors (read-only) — used by HTTP handlers that need to
    # dispatch+await over the runner WS bridge.
    # ========================================================================

    @property
    def relay(self) -> CommandRelayService:
        """Public accessor for the underlying command relay.

        Used by HTTP handlers calling :meth:`CommandRelayService.dispatch_and_wait`.
        """
        return self._relay

    @property
    def registry(self) -> WebSocketConnectionRegistry:
        """Public accessor for the WS connection registry.

        Used by the runner-selection helper to filter user-owned runners
        down to those connected to *this* web process.
        """
        return self._registry

    # ========================================================================
    # Connection-state queries
    # ========================================================================

    def is_connected(self, runner_id: UUID | str) -> bool:
        """In-process check (memory only)."""
        return self._registry.is_runner_connected(_rid(runner_id))

    async def is_connected_redis(self, runner_id: UUID | str) -> bool:
        """Cross-process check via Redis."""
        return await self._state_repo.is_connected_redis(_rid(runner_id))

    def get_websocket(self, runner_id: UUID | str) -> WebSocket | None:
        return self._registry.get_runner_websocket(_rid(runner_id))

    def get_connected_ids(self) -> list[str]:
        """In-process connected runner IDs."""
        return self._registry.get_connected_runner_ids()

    async def get_all_connected_ids(self) -> list[str]:
        """All-process connected runner IDs (Redis-backed)."""
        return await self._state_repo.get_all_connected_ids()

    async def refresh_ttl(self, runner_id: UUID | str) -> bool:
        return await self._state_repo.refresh_ttl(_rid(runner_id))

    # ========================================================================
    # Status publishing
    # ========================================================================

    async def publish_runner_connected(
        self,
        runner_id: UUID | str,
        user_id: UUID,
        runner_name: str | None,
        connected_at: str,
        ip_address: str | None = None,
    ) -> None:
        """Publish a ``runner_connected`` status event."""
        from datetime import datetime

        from qontinui_schemas.common import utc_now

        rid = _rid(runner_id)
        try:
            ts = datetime.fromisoformat(connected_at) if connected_at else utc_now()
        except ValueError:
            ts = utc_now()

        await self._publisher.publish_runner_connected(
            user_id=user_id,
            runner_id=rid,
            runner_name=runner_name,
            connected_at=ts,
            ip_address=ip_address,
        )

    async def publish_runner_disconnected(
        self, runner_id: UUID | str, user_id: UUID
    ) -> None:
        rid = _rid(runner_id)
        await self._publisher.publish_runner_disconnected(user_id, rid)

    # ========================================================================
    # User → Runner reverse lookup (for wake-intent flow)
    # ========================================================================

    @staticmethod
    def _user_runners_key(user_id: str | UUID) -> str:
        return f"user:{user_id}:runners"

    async def _save_user_runner_mapping(self, user_id: UUID, runner_id: str) -> None:
        key = self._user_runners_key(user_id)
        try:
            await self._redis.sadd(key, runner_id)  # type: ignore[misc]
            await self._redis.expire(key, USER_RUNNERS_TTL_SECONDS)
        except Exception as e:
            logger.error(
                "user_runner_mapping_save_failed",
                runner_id=runner_id,
                user_id=str(user_id),
                error=str(e),
            )

    async def _remove_user_runner_mapping(self, user_id: UUID, runner_id: str) -> None:
        key = self._user_runners_key(user_id)
        try:
            await self._redis.srem(key, runner_id)  # type: ignore[misc]
        except Exception as e:
            logger.error(
                "user_runner_mapping_remove_failed",
                runner_id=runner_id,
                user_id=str(user_id),
                error=str(e),
            )

    async def is_user_online(self, user_id: str | UUID) -> str | None:
        """
        Return one live ``runner_id`` for ``user_id`` if any is online.
        Replaces the old integer-keyed ``is_user_online`` on the legacy
        manager.
        """
        key = self._user_runners_key(user_id)
        try:
            members = await self._redis.smembers(key)  # type: ignore[misc]
        except Exception as e:
            logger.error(
                "user_runners_lookup_failed",
                user_id=str(user_id),
                error=str(e),
            )
            return None

        if not members:
            return None

        for raw in members:
            value = raw.decode() if isinstance(raw, bytes) else raw
            if not isinstance(value, str):
                value = str(value)
            if await self.is_connected_redis(value):
                return value
            try:
                await self._redis.srem(key, value)  # type: ignore[misc]
            except Exception:
                pass
        return None

    # ========================================================================
    # Wake intents (fulfill on registration)
    # ========================================================================

    @staticmethod
    def _wake_intent_pattern(user_id: str | UUID) -> str:
        return f"{WAKE_INTENT_KEY_PREFIX}:{user_id}:*"

    # Wake-intent auto-trigger removed; callers fulfill explicitly via
    # fulfill_wake_intent() once a runner has fully registered (the Phase
    # 4B web flow polls /runners/{id}/wake → fulfill).
    async def fulfill_wake_intent(
        self, user_id: str, runner_id: UUID | str
    ) -> dict[str, Any] | None:
        """Find and consume a pending wake intent for ``user_id``."""
        rid = _rid(runner_id)
        pattern = self._wake_intent_pattern(user_id)
        try:
            keys: list[Any] = await self._redis.keys(pattern)
        except Exception as e:
            logger.error(
                "wake_intent_scan_failed",
                user_id=user_id,
                runner_id=rid,
                error=str(e),
            )
            return None

        for raw_key in keys:
            key = raw_key.decode() if isinstance(raw_key, bytes) else raw_key
            try:
                raw_value = await self._redis.get(key)
            except Exception as e:
                logger.error(
                    "wake_intent_get_failed",
                    user_id=user_id,
                    key=key,
                    error=str(e),
                )
                continue

            if raw_value is None:
                continue

            try:
                payload: dict[str, Any] = json.loads(raw_value)
            except (TypeError, ValueError) as e:
                logger.warning(
                    "wake_intent_payload_invalid",
                    user_id=user_id,
                    key=key,
                    error=str(e),
                )
                try:
                    await self._redis.delete(key)
                except Exception:
                    pass
                continue

            try:
                await self._redis.delete(key)
            except Exception as e:
                logger.error(
                    "wake_intent_delete_failed",
                    user_id=user_id,
                    key=key,
                    error=str(e),
                )

            if "intent_id" not in payload:
                tail = key.split(":")[-1]
                payload["intent_id"] = tail

            return payload

        return None

    # ========================================================================
    # Force disconnect
    # ========================================================================

    async def disconnect_runner(self, runner_id: UUID | str) -> bool:
        """Forcefully close a runner WebSocket."""
        rid = _rid(runner_id)
        websocket = self._registry.get_runner_websocket(rid)
        if not websocket:
            return False
        try:
            await websocket.close()
            logger.info("runner_force_disconnected", runner_id=rid)
            return True
        except Exception as e:
            logger.error(
                "runner_force_disconnect_failed",
                runner_id=rid,
                error=str(e),
            )
            return False


# Singleton instance
_runner_websocket_manager: RunnerWebSocketManager | None = None


async def get_runner_websocket_manager(
    redis_client: aioredis.Redis,
) -> RunnerWebSocketManager:
    """Return the process-wide singleton :class:`RunnerWebSocketManager`."""
    global _runner_websocket_manager
    if _runner_websocket_manager is None:
        _runner_websocket_manager = RunnerWebSocketManager(redis_client)
    return _runner_websocket_manager
