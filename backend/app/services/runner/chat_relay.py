"""
Chat Relay Service for mobile-runner chat communication.

Handles chat message routing via Redis pub/sub channels.
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


class ChatRelayService:
    """
    Handles chat message routing via Redis pub/sub.

    Channels:
    - runner:chat:{runner_id} - Mobile -> Runner chat messages
    - runner:chat_response:{runner_id} - Runner -> Mobile chat responses
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

    async def send_chat_to_runner(
        self, runner_id: str, message: dict[str, Any]
    ) -> bool:
        """
        Send a chat message from mobile to runner via Redis pub/sub.

        Returns:
            True if sent successfully, False if runner not connected
        """
        if not self._registry.is_runner_connected(runner_id):
            return False

        channel = f"runner:chat:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(message))
            logger.debug(
                "chat_sent_to_runner",
                runner_id=runner_id,
                message_type=message.get("type"),
            )
            return True
        except Exception as e:
            logger.error(
                "chat_send_failed",
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
        channel = f"runner:chat_response:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(response))
            logger.debug(
                "chat_response_published",
                runner_id=runner_id,
                response_type=response.get("type"),
            )
        except Exception as e:
            logger.error(
                "chat_response_publish_failed",
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
        Start listening for chat messages from mobile and forward to runner.

        Args:
            runner_id: Runner connection ID.
            runner_websocket: Runner's WebSocket connection.
            send_fn: Optional synchronized send function. If provided, used instead
                of calling runner_websocket.send_json directly, to avoid concurrent
                sends from multiple relay services on the same WebSocket.

        Returns the listener task.
        """
        listener_task = asyncio.create_task(
            self._listen_for_chat(runner_id, runner_websocket, send_fn=send_fn)
        )
        self._runner_listeners[runner_id] = listener_task
        return listener_task

    async def stop_runner_listener(self, runner_id: str) -> None:
        """Stop the runner chat listener."""
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
        """Notify all connected mobiles with a message directly (not via pub/sub)."""
        # Mobile websockets are tracked by their listener keys
        # We iterate over listeners for this runner_id and send directly
        # Note: Unlike frontends, mobiles don't have a registry - they use pub/sub
        # For direct notification, publish to the response channel
        channel = f"runner:chat_response:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(message))
            logger.debug(
                "mobiles_notified",
                runner_id=runner_id,
                message_type=message.get("type"),
            )
        except Exception as e:
            logger.error(
                "mobile_notify_failed",
                runner_id=runner_id,
                error=str(e),
            )

    async def _listen_for_chat(
        self,
        runner_id: str,
        runner_websocket: WebSocket,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None,
    ) -> None:
        """Listen for chat messages from mobile and forward to runner."""
        channel = f"runner:chat:{runner_id}"
        pubsub = self._redis.pubsub()

        async def _send(data: dict[str, Any]) -> None:
            if send_fn is not None:
                await send_fn(data)
            else:
                await runner_websocket.send_json(data)

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "runner_chat_listener_started",
                runner_id=runner_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        chat_msg = json.loads(message["data"])
                        await _send(chat_msg)
                        logger.debug(
                            "chat_forwarded_to_runner",
                            runner_id=runner_id,
                            message_type=chat_msg.get("type"),
                        )
                    except BENIGN_SEND_EXCEPTIONS as e:
                        logger.info(
                            "runner_ws_disconnected_during_chat_forward",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        break
                    except Exception as e:
                        logger.error(
                            "chat_forward_failed",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        # Continue processing — don't break on transient errors
                        continue

        except asyncio.CancelledError:
            logger.info(
                "runner_chat_listener_cancelled",
                runner_id=runner_id,
            )
        except Exception as e:
            logger.error(
                "runner_chat_listener_error",
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
        channel = f"runner:chat_response:{runner_id}"
        pubsub = self._redis.pubsub()

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "mobile_response_listener_started",
                runner_id=runner_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        response = json.loads(message["data"])
                        await mobile_websocket.send_json(response)
                        logger.debug(
                            "response_forwarded_to_mobile",
                            runner_id=runner_id,
                            response_type=response.get("type"),
                        )
                    except BENIGN_SEND_EXCEPTIONS as e:
                        logger.info(
                            "mobile_ws_disconnected_during_response_forward",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        break
                    except Exception as e:
                        logger.error(
                            "response_forward_to_mobile_failed",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        # Continue processing — don't break on transient errors
                        continue

        except asyncio.CancelledError:
            logger.info(
                "mobile_response_listener_cancelled",
                runner_id=runner_id,
            )
        except Exception as e:
            logger.error(
                "mobile_response_listener_error",
                runner_id=runner_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
