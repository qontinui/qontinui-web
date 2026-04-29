"""WebSocket handler for test execution streaming.

Provides real-time test execution monitoring, allowing qontinui-runner to stream
test results (transitions, screenshots, deficiencies) to the backend and broadcast
updates to dashboard clients via Redis pub/sub.
"""

from typing import Any
from uuid import UUID

import structlog
from pydantic import ValidationError
from qontinui_schemas.common import utc_now

from app.config.redis_config import get_redis
from app.crud import runner_crud
from app.crud import runner_session as runner_session_crud
from app.schemas.testing_ws import WSTestMessage
from app.services.websocket_manager import get_websocket_manager
from app.websockets.base import BaseWebSocketHandler, WebSocketContext
from app.websockets.message_types import create_timestamp
from app.websockets.testing.orchestrator import TestOrchestrator

logger = structlog.get_logger(__name__)


class TestingWebSocketHandler(BaseWebSocketHandler):
    """WebSocket handler for test execution streaming from runners.

    Handles the WebSocket connection lifecycle and delegates business logic
    to the TestOrchestrator. Broadcasts test updates to dashboard clients
    via Redis pub/sub.
    """

    # Configuration
    connection_rate_limit = 5
    connection_rate_window = 60
    message_rate_limit = 100
    message_rate_window = 60
    heartbeat_interval = 30.0
    stale_connection_timeout = 90.0

    @property
    def endpoint_name(self) -> str:
        """Name of this endpoint for logging."""
        return "testing_ws"

    def __init__(self) -> None:
        """Initialize the handler."""
        super().__init__()
        self.orchestrator: TestOrchestrator | None = None
        self.connection_record: Any | None = None
        self.ws_manager: Any | None = None

    async def on_connect(
        self,
        context: WebSocketContext,
        **kwargs: Any,
    ) -> bool | None:
        """Called when a connection is established.

        Sets up the test orchestrator and connection record.

        Args:
            context: WebSocket context.
            **kwargs: Additional arguments.

        Returns:
            False to close the connection, None/True to continue.
        """
        # Log connection record — upsert a parent Runner row plus a
        # RunnerSession (audit) row for this WS connection.
        try:
            client_host = (
                context.websocket.client.host if context.websocket.client else None
            )
            runner_row = await runner_crud.register_runner(
                db=context.db,
                user_id=context.user.id,
                name="Testing Runner",
                hostname=client_host or "localhost",
                port=0,
                capabilities=[],
                restate_enabled=False,
                restate_healthy=False,
                runner_token_id=None,
            )
            self.connection_record = await runner_session_crud.create_session_record(
                db=context.db,
                runner_id=runner_row.id,
                user_id=context.user.id,
                ip_address=client_host,
            )
            self.logger.info(
                "testing_runner_session_logged",
                runner_id=str(runner_row.id),
                session_pk=self.connection_record.id,
            )
        except Exception as e:
            self.logger.error(
                "testing_runner_session_log_failed",
                error=str(e),
                error_type=type(e).__name__,
            )

        # Initialize orchestrator
        self.orchestrator = TestOrchestrator(
            db=context.db,
            user=context.user,
            connection_record_id=(
                self.connection_record.id if self.connection_record else None
            ),
        )

        # Get WebSocket manager for broadcasting
        redis_client = await get_redis()
        self.ws_manager = await get_websocket_manager(redis_client)

        # Send connection acknowledgment
        await context.websocket.send_json(
            {
                "type": "connected",
                "user_id": str(context.user_id),
                "auth_method": "jwt",
                "timestamp": create_timestamp(),
            }
        )

        return True

    async def on_message(
        self,
        context: WebSocketContext,
        data: dict[str, Any],
    ) -> None:
        """Handle incoming WebSocket messages.

        Routes messages to the appropriate handler based on message type.

        Args:
            context: WebSocket context.
            data: Parsed JSON message data.
        """
        # Validate message format
        try:
            message = WSTestMessage(**data)
        except ValidationError as e:
            await context.websocket.send_json(
                {
                    "type": "error",
                    "message": f"Invalid message format: {str(e)}",
                    "timestamp": create_timestamp(),
                }
            )
            return

        message_type = message.type

        if message_type == "heartbeat":
            await self._handle_heartbeat(context)

        elif message_type == "ping":
            await self._handle_ping(context)

        elif message_type == "session_start":
            await self._handle_session_start(context, message.data)

        elif message_type == "transition_started":
            await self._handle_transition_started(context, message.data)

        elif message_type == "transition_completed":
            await self._handle_transition_completed(context, message.data)

        elif message_type == "screenshot":
            await self._handle_screenshot(context, message.data)

        elif message_type == "deficiency":
            await self._handle_deficiency(context, message.data)

        elif message_type == "session_end":
            await self._handle_session_end(context, message.data)

        else:
            await context.websocket.send_json(
                {
                    "type": "error",
                    "message": f"Unknown message type: {message_type}",
                    "timestamp": create_timestamp(),
                }
            )

    async def _handle_heartbeat(self, context: WebSocketContext) -> None:
        """Handle heartbeat message."""
        await context.websocket.send_json(
            {
                "type": "heartbeat_ack",
                "timestamp": create_timestamp(),
            }
        )

    async def _handle_ping(self, context: WebSocketContext) -> None:
        """Handle ping message."""
        context.update_activity()
        await context.websocket.send_json(
            {
                "type": "pong",
                "timestamp": create_timestamp(),
            }
        )

    async def _handle_session_start(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle session_start message."""
        if not self.orchestrator:
            return

        response = await self.orchestrator.handle_session_start(data)

        if response["type"] == "session_started":
            test_run_id = UUID(response["test_run_id"])
            # Broadcast to dashboard clients
            if self.ws_manager:
                await self.ws_manager.broadcast(
                    str(test_run_id),
                    {
                        "type": "test_run_started",
                        "test_run_id": str(test_run_id),
                        "timestamp": utc_now().isoformat() + "Z",
                    },
                )

        await context.websocket.send_json(response)

    async def _handle_transition_started(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle transition_started message."""
        if not self.orchestrator:
            return

        response = await self.orchestrator.handle_transition_started(data)

        # Broadcast to dashboard clients
        if (
            self.orchestrator.test_run_id
            and response["type"] == "transition_started_ack"
            and self.ws_manager
        ):
            await self.ws_manager.broadcast(
                str(self.orchestrator.test_run_id),
                {
                    "type": "transition_started",
                    **data,
                    "timestamp": utc_now().isoformat() + "Z",
                },
            )

        await context.websocket.send_json(response)

    async def _handle_transition_completed(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle transition_completed message."""
        if not self.orchestrator:
            return

        response = await self.orchestrator.handle_transition_completed(data)

        # Broadcast to dashboard clients
        if (
            self.orchestrator.test_run_id
            and response["type"] == "transition_completed_ack"
            and self.ws_manager
        ):
            await self.ws_manager.broadcast(
                str(self.orchestrator.test_run_id),
                {
                    "type": "transition_completed",
                    **data,
                    "timestamp": utc_now().isoformat() + "Z",
                },
            )

        await context.websocket.send_json(response)

    async def _handle_screenshot(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle screenshot message."""
        if not self.orchestrator:
            return

        response = await self.orchestrator.handle_screenshot(data)
        await context.websocket.send_json(response)

    async def _handle_deficiency(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle deficiency message."""
        if not self.orchestrator:
            return

        response = await self.orchestrator.handle_deficiency(data)

        # Broadcast to dashboard clients
        if (
            self.orchestrator.test_run_id
            and response["type"] == "deficiency_recorded"
            and self.ws_manager
        ):
            await self.ws_manager.broadcast(
                str(self.orchestrator.test_run_id),
                {
                    "type": "deficiency_found",
                    "deficiency_id": response["deficiency_id"],
                    "severity": data.get("severity"),
                    "title": data.get("title"),
                    "timestamp": utc_now().isoformat() + "Z",
                },
            )

        await context.websocket.send_json(response)

    async def _handle_session_end(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle session_end message."""
        if not self.orchestrator:
            return

        # Store test_run_id before it's cleared
        test_run_id = self.orchestrator.test_run_id

        response = await self.orchestrator.handle_session_end(data)

        # Broadcast to dashboard clients
        if test_run_id and response["type"] == "session_ended" and self.ws_manager:
            await self.ws_manager.broadcast(
                str(test_run_id),
                {
                    "type": "test_run_ended",
                    "test_run_id": str(test_run_id),
                    "status": response["status"],
                    "timestamp": utc_now().isoformat() + "Z",
                },
            )

        await context.websocket.send_json(response)

    async def on_disconnect(self, context: WebSocketContext) -> None:
        """Called when the connection is closing.

        Cleans up the connection record.

        Args:
            context: WebSocket context.
        """
        # Close session row
        if self.connection_record and context.db:
            try:
                await runner_session_crud.close_session_record(
                    db=context.db,
                    session_pk=self.connection_record.id,
                )
                self.logger.info(
                    "testing_runner_session_closed",
                    session_pk=self.connection_record.id,
                )
            except Exception as e:
                self.logger.error(
                    "testing_runner_session_close_failed",
                    error=str(e),
                )


# Module-level handler instance
testing_handler = TestingWebSocketHandler()
