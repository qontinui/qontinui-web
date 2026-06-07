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
from collections.abc import Callable, Coroutine
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
from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS

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
        # Per-runner SHARED inbound listener: a single pubsub connection +
        # listener task that multiplexes the command/chat/terminal
        # runner-direction channels onto one pooled Redis connection (see
        # ``register``). runner_id -> (pubsub, task).
        self._inbound_listeners: dict[str, tuple[Any, asyncio.Task]] = {}

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
        # issue pooled commands, and — critically — the inbound listener runs
        # ``pubsub.subscribe`` and holds a pooled connection until the task is
        # cancelled and its ``finally`` runs ``pubsub.close()``.
        #
        # The three runner-direction channels (commands / chat / terminal) are
        # multiplexed onto a SINGLE shared pubsub connection per runner via
        # ``_start_inbound_listener`` — previously each relay opened its own
        # dedicated pubsub, costing 3 pooled connections per registration. Under
        # runner-reconnect churn that 3x amplification exhausted the pool
        # (``redis.exceptions.ConnectionError: Too many connections``), aborting
        # registration; collapsing 3 -> 1 removes the amplification.
        #
        # If a step raises midway, the caller's except path closes the socket
        # and returns WITHOUT calling ``unregister`` — so the in-memory registry
        # entry, send lock, and the listener task + its pubsub connection would
        # be orphaned. Wrap the whole body so that on ANY failure we tear down
        # every resource acquired so far (cancelling the listener returns its
        # pubsub connection to the pool) before re-raising. The success path is
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

            await self._start_inbound_listener(rid, send_fn=locked_send)
        except Exception:
            await self._rollback_partial_registration(rid)
            raise

        logger.info(
            "runner_ws_registered",
            runner_id=rid,
            user_id=str(user_id),
            runner_name=runner_name,
        )

    # ------------------------------------------------------------------
    # Shared inbound (runner-direction) listener
    # ------------------------------------------------------------------

    def _inbound_channels(self, rid: str) -> dict[str, str]:
        """Map each runner-direction Redis channel to its owning relay name.

        Each relay exposes ``runner_channel`` so the channel strings stay
        defined in one place per relay; the manager only multiplexes them.
        """
        return {
            self._relay.runner_channel(rid): "command",
            self._chat_relay.runner_channel(rid): "chat",
            self._terminal_relay.runner_channel(rid): "terminal",
        }

    async def _start_inbound_listener(
        self,
        rid: str,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> None:
        """Subscribe ONE shared pubsub to all runner-direction channels.

        Replaces the three dedicated pubsub connections (one per relay) with a
        single multiplexed pubsub + listener task. Every message on any of the
        command/chat/terminal channels is forwarded to the runner WS via the
        shared ``send_fn`` (the per-runner send lock), preserving the prior
        routing — the runner receives the same frames regardless of which
        channel carried them.
        """
        pubsub = self._redis.pubsub()
        channels = list(self._inbound_channels(rid).keys())
        await pubsub.subscribe(*channels)
        task = asyncio.create_task(self._run_inbound_listener(rid, pubsub, send_fn))
        self._inbound_listeners[rid] = (pubsub, task)
        logger.info(
            "runner_inbound_listener_started",
            runner_id=rid,
            channels=channels,
        )

    async def _run_inbound_listener(
        self,
        rid: str,
        pubsub: Any,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> None:
        """Forward messages from any multiplexed channel to the runner WS."""
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    data = message["data"]
                    if isinstance(data, bytes | bytearray):
                        data = data.decode("utf-8")
                    frame = json.loads(data)
                    await send_fn(frame)
                except BENIGN_SEND_EXCEPTIONS as e:
                    logger.info(
                        "runner_ws_disconnected_during_inbound_forward",
                        runner_id=rid,
                        error=str(e),
                    )
                    break
                except Exception as e:
                    logger.error(
                        "runner_inbound_forward_failed",
                        runner_id=rid,
                        error=str(e),
                    )
                    continue
        except asyncio.CancelledError:
            logger.info("runner_inbound_listener_cancelled", runner_id=rid)
        except Exception as e:
            logger.error(
                "runner_inbound_listener_error",
                runner_id=rid,
                error=str(e),
            )
        finally:
            # The connection is also closed by ``_stop_inbound_listener`` on the
            # cancel path; closing twice is harmless. Shield so a cancellation
            # delivered while we are mid-cleanup does not skip the close and leak
            # the pooled connection.
            await self._close_pubsub(pubsub)

    @staticmethod
    async def _close_pubsub(pubsub: Any) -> None:
        """Unsubscribe + close a pubsub, tolerant of cancellation and errors."""
        try:
            await asyncio.shield(pubsub.unsubscribe())
        except Exception:  # noqa: BLE001 - best effort cleanup
            pass
        try:
            await asyncio.shield(pubsub.close())
        except Exception:  # noqa: BLE001 - best effort cleanup
            pass

    async def _stop_inbound_listener(self, rid: str) -> None:
        """Cancel the shared inbound listener and close its pubsub.

        Cancels the task, awaits it so its ``finally`` runs, then closes the
        pubsub explicitly (idempotent) so the single pooled connection is
        returned to the pool deterministically even if the listener's own
        cleanup was interrupted by the cancellation.
        """
        entry = self._inbound_listeners.pop(rid, None)
        if entry is None:
            return
        pubsub, task = entry
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001 - defensive
            logger.warning(
                "inbound_listener_await_after_cancel_failed",
                runner_id=rid,
                error=str(exc),
            )
        await self._close_pubsub(pubsub)

    async def _rollback_partial_registration(self, rid: str) -> None:
        """Tear down resources acquired by a ``register`` that failed midway.

        Cancels the shared inbound listener task (so its ``finally`` runs
        ``pubsub.close()`` and the single pubsub connection returns to the
        pool), drops the in-memory registry entry and send lock, and best-effort
        clears the Redis connection state. Each step is independently guarded so
        one failing teardown never masks another — the goal is to leak nothing
        on the failure path. Safe to call when a step never ran (the listener /
        registry helpers are no-ops for unknown ids).
        """
        try:
            await self._stop_inbound_listener(rid)
        except Exception as exc:
            logger.warning(
                "register_rollback_step_failed",
                runner_id=rid,
                step="inbound_listener",
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

        # Cancel the shared inbound listener (commands/chat/terminal multiplex);
        # its ``finally`` unsubscribes and closes the single pubsub connection.
        await self._stop_inbound_listener(rid)

        # Notify mobile + frontend clients of the disconnect.
        from qontinui_schemas.common import utc_now

        await self._chat_relay.notify_mobiles(
            rid,
            {
                "type": "runner_disconnected",
                "runner_id": rid,
                "timestamp": utc_now().isoformat(),
            },
        )
        await self._terminal_relay.notify_mobiles(
            rid,
            {
                "type": "runner_disconnected",
                "runner_id": rid,
                "timestamp": utc_now().isoformat(),
            },
        )
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
        self,
        runner_id: UUID | str,
        payload: dict[str, Any],
        *,
        require_local_connection: bool = True,
    ) -> bool:
        """Send a typed ``dispatch`` message to the runner over its WS.

        When ``require_local_connection`` is ``False`` the in-process
        connectivity gate is skipped and the dispatch is published via Redis
        pub/sub regardless of whether the socket lives on this replica — for
        cross-process dispatch where connectivity was already confirmed via
        Redis (see ``is_connected_redis``).
        """
        rid = _rid(runner_id)
        msg = {"type": "dispatch", **payload}
        return await self._relay.send_command_to_runner(
            rid, msg, require_local_connection=require_local_connection
        )

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
