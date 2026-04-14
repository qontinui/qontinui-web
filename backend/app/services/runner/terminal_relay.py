"""
Terminal Relay Service for mobile-runner terminal communication.

Handles terminal I/O routing via Redis pub/sub channels.
"""

import asyncio
import json
from collections.abc import Callable, Coroutine
from typing import Any

import structlog
from fastapi import WebSocket, WebSocketDisconnect
from redis import asyncio as aioredis

from app.services.runner.connection_registry import WebSocketConnectionRegistry

logger = structlog.get_logger(__name__)


class TerminalRelayService:
    """
    Handles terminal I/O routing via Redis pub/sub.

    Channels:
    - runner:terminal:{connection_id} - Mobile -> Runner terminal messages
    - runner:terminal_response:{connection_id} - Runner -> Mobile terminal responses
    """

    def __init__(
        self,
        redis_client: aioredis.Redis,
        registry: WebSocketConnectionRegistry,
    ):
        self._redis = redis_client
        self._registry = registry
        # connection_id -> asyncio.Task (listener tasks)
        self._runner_listeners: dict[int, asyncio.Task] = {}
        self._mobile_listeners: dict[str, asyncio.Task] = {}

    async def send_terminal_to_runner(
        self, connection_id: int, message: dict[str, Any]
    ) -> bool:
        """
        Send a terminal message from mobile to runner via Redis pub/sub.

        Returns:
            True if sent successfully, False if runner not connected
        """
        if not self._registry.is_runner_connected(connection_id):
            return False

        channel = f"runner:terminal:{connection_id}"
        try:
            await self._redis.publish(channel, json.dumps(message))
            logger.debug(
                "terminal_sent_to_runner",
                connection_id=connection_id,
                message_type=message.get("type"),
            )
            return True
        except Exception as e:
            logger.error(
                "terminal_send_failed",
                connection_id=connection_id,
                error=str(e),
            )
            return False

    async def send_response_to_mobiles(
        self, connection_id: int, response: dict[str, Any]
    ) -> None:
        """
        Send a response from runner to all connected mobiles via Redis pub/sub.
        """
        channel = f"runner:terminal_response:{connection_id}"
        try:
            await self._redis.publish(channel, json.dumps(response))
            logger.debug(
                "terminal_response_published",
                connection_id=connection_id,
                response_type=response.get("type"),
            )
        except Exception as e:
            logger.error(
                "terminal_response_publish_failed",
                connection_id=connection_id,
                error=str(e),
            )

    async def start_runner_listener(
        self,
        connection_id: int,
        runner_websocket: WebSocket,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None,
    ) -> asyncio.Task:
        """
        Start listening for terminal messages from mobile and forward to runner.

        Args:
            connection_id: Runner connection ID.
            runner_websocket: Runner's WebSocket connection.
            send_fn: Optional synchronized send function. If provided, used instead
                of calling runner_websocket.send_json directly, to avoid concurrent
                sends from multiple relay services on the same WebSocket.

        Returns the listener task.
        """
        listener_task = asyncio.create_task(
            self._listen_for_terminal(connection_id, runner_websocket, send_fn=send_fn)
        )
        self._runner_listeners[connection_id] = listener_task
        return listener_task

    async def stop_runner_listener(self, connection_id: int) -> None:
        """Stop the runner terminal listener."""
        if connection_id in self._runner_listeners:
            self._runner_listeners[connection_id].cancel()
            del self._runner_listeners[connection_id]

    async def start_mobile_listener(
        self, connection_id: int, mobile_websocket: WebSocket
    ) -> asyncio.Task:
        """
        Start listening for responses from runner and forward to mobile.

        Returns the listener task.
        """
        listener_key = f"{connection_id}:{id(mobile_websocket)}"
        listener_task = asyncio.create_task(
            self._listen_for_responses(connection_id, mobile_websocket, listener_key)
        )
        self._mobile_listeners[listener_key] = listener_task
        return listener_task

    async def stop_mobile_listener(
        self, connection_id: int, mobile_websocket: WebSocket
    ) -> None:
        """Stop a mobile response listener."""
        listener_key = f"{connection_id}:{id(mobile_websocket)}"
        if listener_key in self._mobile_listeners:
            self._mobile_listeners[listener_key].cancel()
            del self._mobile_listeners[listener_key]

    async def notify_mobiles(self, connection_id: int, message: dict[str, Any]) -> None:
        """Notify all connected mobiles with a message via the response channel."""
        channel = f"runner:terminal_response:{connection_id}"
        try:
            await self._redis.publish(channel, json.dumps(message))
            logger.debug(
                "terminal_mobiles_notified",
                connection_id=connection_id,
                message_type=message.get("type"),
            )
        except Exception as e:
            logger.error(
                "terminal_mobile_notify_failed",
                connection_id=connection_id,
                error=str(e),
            )

    async def _listen_for_terminal(
        self,
        connection_id: int,
        runner_websocket: WebSocket,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None,
    ) -> None:
        """Listen for terminal messages from mobile and forward to runner."""
        channel = f"runner:terminal:{connection_id}"
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
                connection_id=connection_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        terminal_msg = json.loads(message["data"])
                        await _send(terminal_msg)
                        logger.debug(
                            "terminal_forwarded_to_runner",
                            connection_id=connection_id,
                            message_type=terminal_msg.get("type"),
                        )
                    except WebSocketDisconnect:
                        logger.info(
                            "runner_ws_disconnected_during_terminal_forward",
                            connection_id=connection_id,
                        )
                        break
                    except Exception as e:
                        logger.error(
                            "terminal_forward_failed",
                            connection_id=connection_id,
                            error=str(e),
                        )
                        continue

        except asyncio.CancelledError:
            logger.info(
                "runner_terminal_listener_cancelled",
                connection_id=connection_id,
            )
            raise
        except Exception as e:
            logger.error(
                "runner_terminal_listener_error",
                connection_id=connection_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    async def _listen_for_responses(
        self, connection_id: int, mobile_websocket: WebSocket, listener_key: str
    ) -> None:
        """Listen for responses from runner and forward to mobile."""
        channel = f"runner:terminal_response:{connection_id}"
        pubsub = self._redis.pubsub()

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "mobile_terminal_response_listener_started",
                connection_id=connection_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        response = json.loads(message["data"])
                        await mobile_websocket.send_json(response)
                        logger.debug(
                            "terminal_response_forwarded_to_mobile",
                            connection_id=connection_id,
                            response_type=response.get("type"),
                        )
                    except WebSocketDisconnect:
                        logger.info(
                            "mobile_ws_disconnected_during_terminal_response_forward",
                            connection_id=connection_id,
                        )
                        break
                    except Exception as e:
                        logger.error(
                            "terminal_response_forward_to_mobile_failed",
                            connection_id=connection_id,
                            error=str(e),
                        )
                        continue

        except asyncio.CancelledError:
            logger.info(
                "mobile_terminal_response_listener_cancelled",
                connection_id=connection_id,
            )
            raise
        except Exception as e:
            logger.error(
                "mobile_terminal_response_listener_error",
                connection_id=connection_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
