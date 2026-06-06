"""
Terminal Relay Service for mobile-runner terminal communication.

Handles terminal I/O routing via Redis pub/sub channels.
"""

import asyncio
import json
from collections.abc import Callable, Coroutine
from typing import Any

import structlog
from fastapi import WebSocket
from redis import asyncio as aioredis

from app.services.runner.connection_registry import WebSocketConnectionRegistry
from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS

logger = structlog.get_logger(__name__)


class TerminalRelayService:
    """
    Handles terminal I/O routing via Redis pub/sub.

    Channels:
    - runner:terminal:{runner_id} - Mobile -> Runner terminal messages
    - runner:terminal_response:{runner_id} - Runner -> Mobile terminal responses
    """

    def __init__(
        self,
        redis_client: aioredis.Redis,
        registry: WebSocketConnectionRegistry,
    ):
        self._redis = redis_client
        self._registry = registry
        # runner_id -> asyncio.Task (listener tasks)
        self._runner_listeners: dict[str, asyncio.Task] = {}
        self._mobile_listeners: dict[str, asyncio.Task] = {}

    async def send_terminal_to_runner(
        self, runner_id: str, message: dict[str, Any]
    ) -> bool:
        """
        Send a terminal message from mobile to runner via Redis pub/sub.

        Returns:
            True if sent successfully, False if runner not connected
        """
        if not self._registry.is_runner_connected(runner_id):
            return False

        channel = f"runner:terminal:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(message))
            logger.debug(
                "terminal_sent_to_runner",
                runner_id=runner_id,
                message_type=message.get("type"),
            )
            return True
        except Exception as e:
            logger.error(
                "terminal_send_failed",
                runner_id=runner_id,
                error=str(e),
            )
            return False

    async def send_response_to_mobiles(
        self, runner_id: str, response: dict[str, Any]
    ) -> None:
        """
        Send a response from runner to all connected mobiles via Redis pub/sub.
        """
        channel = f"runner:terminal_response:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(response))
            logger.debug(
                "terminal_response_published",
                runner_id=runner_id,
                response_type=response.get("type"),
            )
        except Exception as e:
            logger.error(
                "terminal_response_publish_failed",
                runner_id=runner_id,
                error=str(e),
            )

    async def start_runner_listener(
        self,
        runner_id: str,
        runner_websocket: WebSocket,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None,
    ) -> asyncio.Task:
        """
        Start listening for terminal messages from mobile and forward to runner.

        Args:
            runner_id: Runner connection ID.
            runner_websocket: Runner's WebSocket connection.
            send_fn: Optional synchronized send function. If provided, used instead
                of calling runner_websocket.send_json directly, to avoid concurrent
                sends from multiple relay services on the same WebSocket.

        Returns the listener task.
        """
        listener_task = asyncio.create_task(
            self._listen_for_terminal(runner_id, runner_websocket, send_fn=send_fn)
        )
        self._runner_listeners[runner_id] = listener_task
        return listener_task

    async def stop_runner_listener(self, runner_id: str) -> None:
        """Stop the runner terminal listener."""
        if runner_id in self._runner_listeners:
            self._runner_listeners[runner_id].cancel()
            del self._runner_listeners[runner_id]

    async def start_mobile_listener(
        self, runner_id: str, mobile_websocket: WebSocket
    ) -> asyncio.Task:
        """
        Start listening for responses from runner and forward to mobile.

        Returns the listener task.
        """
        listener_key = f"{runner_id}:{id(mobile_websocket)}"
        listener_task = asyncio.create_task(
            self._listen_for_responses(runner_id, mobile_websocket, listener_key)
        )
        self._mobile_listeners[listener_key] = listener_task
        return listener_task

    async def stop_mobile_listener(
        self, runner_id: str, mobile_websocket: WebSocket
    ) -> None:
        """Stop a mobile response listener."""
        listener_key = f"{runner_id}:{id(mobile_websocket)}"
        if listener_key in self._mobile_listeners:
            self._mobile_listeners[listener_key].cancel()
            del self._mobile_listeners[listener_key]

    async def notify_mobiles(self, runner_id: str, message: dict[str, Any]) -> None:
        """Notify all connected mobiles with a message via the response channel."""
        channel = f"runner:terminal_response:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(message))
            logger.debug(
                "terminal_mobiles_notified",
                runner_id=runner_id,
                message_type=message.get("type"),
            )
        except Exception as e:
            logger.error(
                "terminal_mobile_notify_failed",
                runner_id=runner_id,
                error=str(e),
            )

    async def _listen_for_terminal(
        self,
        runner_id: str,
        runner_websocket: WebSocket,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None,
    ) -> None:
        """Listen for terminal messages from mobile and forward to runner."""
        channel = f"runner:terminal:{runner_id}"
        pubsub = self._redis.pubsub()

        async def _send(data: dict[str, Any]) -> None:
            if send_fn is not None:
                await send_fn(data)
            else:
                await runner_websocket.send_json(data)

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "runner_terminal_listener_started",
                runner_id=runner_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        terminal_msg = json.loads(message["data"])
                        await _send(terminal_msg)
                        logger.debug(
                            "terminal_forwarded_to_runner",
                            runner_id=runner_id,
                            message_type=terminal_msg.get("type"),
                        )
                    except BENIGN_SEND_EXCEPTIONS as e:
                        logger.info(
                            "runner_ws_disconnected_during_terminal_forward",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        break
                    except Exception as e:
                        logger.error(
                            "terminal_forward_failed",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        continue

        except asyncio.CancelledError:
            logger.info(
                "runner_terminal_listener_cancelled",
                runner_id=runner_id,
            )
            raise
        except Exception as e:
            logger.error(
                "runner_terminal_listener_error",
                runner_id=runner_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    async def _listen_for_responses(
        self, runner_id: str, mobile_websocket: WebSocket, listener_key: str
    ) -> None:
        """Listen for responses from runner and forward to mobile."""
        channel = f"runner:terminal_response:{runner_id}"
        pubsub = self._redis.pubsub()

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "mobile_terminal_response_listener_started",
                runner_id=runner_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        response = json.loads(message["data"])
                        await mobile_websocket.send_json(response)
                        logger.debug(
                            "terminal_response_forwarded_to_mobile",
                            runner_id=runner_id,
                            response_type=response.get("type"),
                        )
                    except BENIGN_SEND_EXCEPTIONS as e:
                        logger.info(
                            "mobile_ws_disconnected_during_terminal_response_forward",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        break
                    except Exception as e:
                        logger.error(
                            "terminal_response_forward_to_mobile_failed",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        continue

        except asyncio.CancelledError:
            logger.info(
                "mobile_terminal_response_listener_cancelled",
                runner_id=runner_id,
            )
            raise
        except Exception as e:
            logger.error(
                "mobile_terminal_response_listener_error",
                runner_id=runner_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
