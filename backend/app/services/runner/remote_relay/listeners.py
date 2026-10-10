"""The per-target return route of the remote-terminal relay.

``ListenerPool`` owns one Redis pubsub listener per (source socket, target): it
subscribes the target's response channels, asks the runner to forward terminal
output while someone listens (``terminal_subscribe`` / ``terminal_unsubscribe``
are matched one-for-one), routes every frame it hears through the core's
``route_target_frame``, and tears down what a listener that died on its own was
routing for. It also publishes the remote-only target frames other replicas'
listeners pick up (``publish_target_frame``).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import structlog

from app.services.runner.remote_relay.core import RelayCore
from app.services.runner.remote_relay.end import EndCoordinator
from app.services.runner.remote_relay.protocol import CODE_LISTENER_LOST
from app.services.runner.remote_relay.registry import (
    remote_response_channel,
    response_channel,
)
from app.services.runner.remote_relay.state import _SourceSession

logger = structlog.get_logger(__name__)


class ListenerPool:
    """Pubsub listener lifecycle, publish, and listener-lost (plan D2)."""

    def __init__(self, core: RelayCore, end: EndCoordinator) -> None:
        self.core = core
        self.end = end

    async def publish_target_frame(self, device_id: Any, msg: dict[str, Any]) -> None:
        """Publish a TARGET frame only the remote path consumes.

        Called by ``devices_ws`` on the TARGET's replica for
        ``is_remote_only_target_frame`` frames; the source's replica picks it
        up on ``remote_response_channel``. Never raises into the device loop.
        """
        try:
            redis = await self.core._get_redis()
            await redis.publish(
                remote_response_channel(str(device_id)), json.dumps(msg)
            )
        except Exception as exc:  # noqa: BLE001 - mirror terminal_relay's publish arms
            logger.error(
                "remote_terminal_response_publish_failed",
                target_device_id=str(device_id),
                frame_type=msg.get("type"),
                error=str(exc),
            )

    async def _ensure_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> None:
        if target_device_id in session.listeners:
            return
        redis = await self.core._get_redis()
        pubsub = redis.pubsub()
        channels = [
            response_channel(target_device_id),
            remote_response_channel(target_device_id),
        ]
        try:
            await pubsub.subscribe(*channels)
        except Exception:
            await self._close_pubsub(pubsub)
            raise
        task = asyncio.create_task(
            self._run_listener(session, target_device_id, pubsub)
        )
        session.listeners[target_device_id] = (pubsub, task)
        # Same subscription the mobile watcher path sends on connect: the
        # runner forwards terminal_output/terminal_exit only while it has a
        # subscriber, and keeps a counter, so one subscribe per listener is
        # matched by one unsubscribe in ``_stop_listener``.
        try:
            if await session.manager.relay.send_command_to_runner(
                target_device_id,
                {"type": "terminal_subscribe", "runner_id": target_device_id},
            ):
                if target_device_id in session.listeners:
                    session.subscribed.add(target_device_id)
                else:
                    # The listener was torn down while the subscribe was in
                    # flight (a ``runner_disconnected`` or a dead pubsub
                    # reached ``_stop_listener`` / ``_listener_lost`` before
                    # the record existed, so their unsubscribe was a no-op).
                    # Nothing will tear this record down later — match the
                    # increment now instead of orphaning it.
                    session.subscribed.add(target_device_id)
                    await self._unsubscribe_runner(session, target_device_id)
        except Exception as exc:  # noqa: BLE001 - the attach itself still stands
            logger.warning(
                "remote_terminal_subscribe_failed",
                target_device_id=target_device_id,
                error=str(exc),
            )
        logger.info(
            "remote_terminal_listener_started",
            source_device_id=session.device_id,
            target_device_id=target_device_id,
            channels=channels,
        )

    async def _stop_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> None:
        entry = session.listeners.pop(target_device_id, None)
        if entry is None:
            return
        pubsub, task = entry
        if task is asyncio.current_task():
            # Reached from inside the listener itself (a ``terminal_exit`` on
            # the socket's last attachment to this target). Finish routing
            # this frame; a sibling task cancels and closes us right after.
            self.core.spawn_background(
                self._finish_listener(session, target_device_id, pubsub, task)
            )
            return
        await self._finish_listener(session, target_device_id, pubsub, task)

    async def _finish_listener(
        self,
        session: _SourceSession,
        target_device_id: str,
        pubsub: Any,
        task: asyncio.Task[None],
    ) -> None:
        task.cancel()
        # Wait for the task to actually leave ``pubsub.listen()`` before this
        # coroutine drives the same PubSub: two coroutines on one pubsub
        # connection desynchronise its reply stream.
        await asyncio.gather(task, return_exceptions=True)
        await self._close_pubsub(pubsub)
        await self._unsubscribe_runner(session, target_device_id)

    async def _close_pubsub(self, pubsub: Any) -> None:
        try:
            await asyncio.shield(pubsub.unsubscribe())
        except Exception:  # noqa: BLE001 - best effort cleanup
            pass
        try:
            await asyncio.shield(pubsub.close())
        except Exception:  # noqa: BLE001 - best effort cleanup
            pass

    async def _run_listener(
        self, session: _SourceSession, target_device_id: str, pubsub: Any
    ) -> None:
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    data = message["data"]
                    if isinstance(data, bytes | bytearray):
                        data = data.decode("utf-8")
                    frame = json.loads(data)
                    if isinstance(frame, dict):
                        await self.core.route_target_frame(
                            session, target_device_id, frame
                        )
                except Exception as exc:  # noqa: BLE001 - one bad frame must not end the route
                    logger.error(
                        "remote_terminal_route_failed",
                        source_device_id=session.device_id,
                        target_device_id=target_device_id,
                        error=str(exc),
                    )
        except asyncio.CancelledError:
            logger.info(
                "remote_terminal_listener_cancelled",
                source_device_id=session.device_id,
                target_device_id=target_device_id,
            )
            raise
        except Exception as exc:  # noqa: BLE001 - mirror terminal_relay's listener arms
            logger.error(
                "remote_terminal_listener_error",
                source_device_id=session.device_id,
                target_device_id=target_device_id,
                error=str(exc),
            )
        finally:
            # A listener that ends on its own (the pubsub died) must not leave
            # its registration behind, its pubsub open, or — worse — its
            # attachments registered with no return route: the source would
            # keep sending input into a route that answers nothing. When
            # ``_stop_listener`` ended us, it already popped the entry and
            # its finisher closes the pubsub after we have left ``listen()``.
            entry = session.listeners.get(target_device_id)
            if entry is not None and entry[1] is asyncio.current_task():
                session.listeners.pop(target_device_id, None)
                await self._listener_lost(session, target_device_id, pubsub)

    async def _listener_lost(
        self, session: _SourceSession, target_device_id: str, pubsub: Any
    ) -> None:
        """Tear down what a self-terminated listener was routing for.

        The entry is already popped, so ``_drop_attachment``'s own
        ``_stop_listener`` is a no-op here and the runner-side unsubscribe
        (matched to this listener's subscribe) is sent explicitly.

        Ends in flight to that target are answered FIRST, typed
        ``listener_lost``: their reply can no longer reach this socket, so
        waiting out the end TTL would only delay the same UNKNOWN verdict.
        """
        await self.end._settle_pending_ends_on_target(
            session,
            target_device_id,
            code=CODE_LISTENER_LOST,
            message="return route to the target was lost; the end's outcome is unknown",
        )
        for att in list(session.grants.values()):
            if att.target_device_id != target_device_id:
                continue
            await self.core._evict(
                session,
                att,
                code=CODE_LISTENER_LOST,
                message="return route to the target was lost",
            )
        await self._close_pubsub(pubsub)
        await self._unsubscribe_runner(session, target_device_id)

    async def _unsubscribe_runner(
        self, session: _SourceSession, target_device_id: str
    ) -> None:
        """Send the ``terminal_unsubscribe`` matching ``_ensure_listener``.

        Sent only when ``_ensure_listener`` actually published this socket's
        subscribe (``session.subscribed``): the runner's counter is shared by
        every subscriber, so an unsubscribe with no matching subscribe would
        take down a PEER's subscription rather than being a no-op. Saturation
        at zero only protects the count when nobody else is subscribed.

        When it is sent, it is published UNCONDITIONALLY — never gated on the
        target's socket being registered in *this* process. The runner's
        ``terminal_subscriber_count``
        is a process-lifetime counter it never resets, and terminal-output
        forwarding is latched on ``count > 0``, so a *dropped* unsubscribe is
        not a benign miss: it leaves the target's device-wide terminal
        firehose on for the rest of that runner's process life. The default
        in-process gate dropped exactly the two cases that matter — the
        target reconnecting to a *different* backend replica between attach
        and detach, and a momentary local deregistration at detach time — so
        the counter never came back down.

        ``require_local_connection=False`` hands the frame to Redis pub/sub on
        ``runner:commands:{rid}``, the channel the replica holding the socket
        is subscribed to, so the unsubscribe reaches the runner wherever it is
        terminated. Publishing to an absent runner is harmless: nothing is
        subscribed to the channel, and the runner's decrement saturates at
        zero.

        The matching ``terminal_subscribe`` stays on the local gate on
        purpose, mirroring the mobile watcher path: a dropped subscribe is
        transient and the attach itself already fails closed when the target
        is not local (``_forward`` -> ``send_terminal`` gates on the socket
        being live here, with no opt-out), whereas a dropped unsubscribe is
        permanent.
        """
        if target_device_id not in session.subscribed:
            return
        session.subscribed.discard(target_device_id)
        try:
            await session.manager.relay.send_command_to_runner(
                target_device_id,
                {"type": "terminal_unsubscribe", "runner_id": target_device_id},
                require_local_connection=False,
            )
        except Exception as exc:  # noqa: BLE001 - the runner may already be gone
            logger.debug(
                "remote_terminal_unsubscribe_failed",
                target_device_id=target_device_id,
                error=str(exc),
            )
