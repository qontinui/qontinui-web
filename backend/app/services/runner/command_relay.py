"""
Command Relay Service for frontend-runner communication.

Handles command/response routing via Redis pub/sub channels.
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


class CommandRelayService:
    """
    Handles command/response routing via Redis pub/sub.

    Channels:
    - runner:commands:{runner_id} - Frontend -> Runner commands
    - runner:responses:{runner_id} - Runner -> Frontend responses
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
        self._frontend_listeners: dict[str, asyncio.Task] = {}

    async def send_command_to_runner(
        self, runner_id: str, command: dict[str, Any]
    ) -> bool:
        """
        Send a command from frontend to runner via Redis pub/sub.

        Returns:
            True if sent successfully, False if runner not connected
        """
        if not self._registry.is_runner_connected(runner_id):
            return False

        channel = f"runner:commands:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(command))
            logger.debug(
                "command_sent_to_runner",
                runner_id=runner_id,
                command_type=command.get("type"),
            )
            return True
        except Exception as e:
            logger.error(
                "command_send_failed",
                runner_id=runner_id,
                error=str(e),
            )
            return False

    async def send_response_to_frontends(
        self, runner_id: str, response: dict[str, Any]
    ) -> None:
        """
        Send a response from runner to all connected frontends via Redis pub/sub.
        """
        channel = f"runner:responses:{runner_id}"
        try:
            await self._redis.publish(channel, json.dumps(response))
            logger.debug(
                "response_published",
                runner_id=runner_id,
                response_type=response.get("type"),
            )
        except Exception as e:
            logger.error(
                "response_publish_failed",
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
        Start listening for commands from frontend and forward to runner.

        Args:
            runner_id: Runner connection ID.
            runner_websocket: Runner's WebSocket connection.
            send_fn: Optional synchronized send function. If provided, used instead
                of calling runner_websocket.send_json directly, to avoid concurrent
                sends from multiple relay services on the same WebSocket.

        Returns the listener task.
        """
        listener_task = asyncio.create_task(
            self._listen_for_commands(runner_id, runner_websocket, send_fn=send_fn)
        )
        self._runner_listeners[runner_id] = listener_task
        return listener_task

    async def stop_runner_listener(self, runner_id: str) -> None:
        """Stop the runner command listener."""
        if runner_id in self._runner_listeners:
            self._runner_listeners[runner_id].cancel()
            del self._runner_listeners[runner_id]

    async def start_frontend_listener(
        self, runner_id: str, frontend_websocket: WebSocket
    ) -> asyncio.Task:
        """
        Start listening for responses from runner and forward to frontend.

        Returns the listener task.
        """
        listener_key = f"{runner_id}:{id(frontend_websocket)}"
        listener_task = asyncio.create_task(
            self._listen_for_responses(runner_id, frontend_websocket, listener_key)
        )
        self._frontend_listeners[listener_key] = listener_task
        return listener_task

    async def stop_frontend_listener(
        self, runner_id: str, frontend_websocket: WebSocket
    ) -> None:
        """Stop a frontend response listener."""
        listener_key = f"{runner_id}:{id(frontend_websocket)}"
        if listener_key in self._frontend_listeners:
            self._frontend_listeners[listener_key].cancel()
            del self._frontend_listeners[listener_key]

    async def notify_frontends(self, runner_id: str, message: dict[str, Any]) -> None:
        """Notify all connected frontends with a message directly (not via pub/sub)."""
        websockets = self._registry.get_frontend_websockets(runner_id)
        if not websockets:
            return

        failed = []
        for ws in websockets:
            try:
                await ws.send_json(message)
            except Exception:
                failed.append(ws)

        # Clean up failed connections
        for ws in failed:
            self._registry.unregister_frontend(runner_id, ws)

    async def _listen_for_commands(
        self,
        runner_id: str,
        runner_websocket: WebSocket,
        send_fn: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None,
    ) -> None:
        """Listen for commands from frontend and forward to runner."""
        channel = f"runner:commands:{runner_id}"
        pubsub = self._redis.pubsub()

        async def _send(data: dict[str, Any]) -> None:
            if send_fn is not None:
                await send_fn(data)
            else:
                await runner_websocket.send_json(data)

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "runner_command_listener_started",
                runner_id=runner_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        command = json.loads(message["data"])
                        await _send(command)
                        logger.debug(
                            "command_forwarded_to_runner",
                            runner_id=runner_id,
                            command_type=command.get("type"),
                        )
                    except WebSocketDisconnect:
                        logger.info(
                            "runner_ws_disconnected_during_command_forward",
                            runner_id=runner_id,
                        )
                        break
                    except Exception as e:
                        logger.error(
                            "command_forward_failed",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        # Continue processing — don't break on transient errors
                        continue

        except asyncio.CancelledError:
            logger.info(
                "runner_command_listener_cancelled",
                runner_id=runner_id,
            )
        except Exception as e:
            logger.error(
                "runner_command_listener_error",
                runner_id=runner_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    async def _listen_for_responses(
        self, runner_id: str, frontend_websocket: WebSocket, listener_key: str
    ) -> None:
        """Listen for responses from runner and forward to frontend."""
        channel = f"runner:responses:{runner_id}"
        pubsub = self._redis.pubsub()

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "frontend_response_listener_started",
                runner_id=runner_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        response = json.loads(message["data"])
                        await frontend_websocket.send_json(response)
                        logger.debug(
                            "response_forwarded_to_frontend",
                            runner_id=runner_id,
                            response_type=response.get("type"),
                        )
                    except Exception as e:
                        logger.error(
                            "response_forward_failed",
                            runner_id=runner_id,
                            error=str(e),
                        )
                        break

        except asyncio.CancelledError:
            logger.info(
                "frontend_response_listener_cancelled",
                runner_id=runner_id,
            )
        except Exception as e:
            logger.error(
                "frontend_response_listener_error",
                runner_id=runner_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
