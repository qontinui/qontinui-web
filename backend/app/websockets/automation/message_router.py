"""Message routing and dispatch for automation WebSocket.

Routes incoming WebSocket messages to appropriate handlers based on
message type. Separates routing logic from business logic.
"""

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from app.models.user import User
from app.websockets.automation.connection_handler import ConnectionHandler
from app.websockets.automation.issue_handlers import (handle_issue_detected,
                                                      handle_issue_updated,
                                                      handle_issues_sync)
from app.websockets.automation.message_handlers import (handle_input_event,
                                                        handle_screenshot)
from app.websockets.automation.relay_handlers import (handle_command_response,
                                                      handle_execution_event,
                                                      handle_extraction_event,
                                                      handle_tree_event,
                                                      handle_unknown_message)
from app.websockets.automation.schemas import WSMessage, make_timestamp
from app.websockets.automation.session_manager import SessionManager
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

# Type alias for message handler methods
MessageHandler = Callable[
    ["MessageRouter", WSMessage, dict[str, Any]],
    Awaitable[dict[str, Any] | None],
]


class MessageRouter:
    """Routes WebSocket messages to appropriate handlers.

    Provides a clean separation between message routing and business logic.
    Each message type has a dedicated handler method.
    """

    def __init__(
        self,
        connection: ConnectionHandler,
        session: SessionManager,
    ):
        """Initialize message router.

        Args:
            connection: Connection handler for sending responses.
            session: Session manager for session state.
        """
        self.connection = connection
        self.session = session

    @property
    def db(self) -> AsyncSession:
        """Get database session."""
        assert self.connection.db is not None
        return self.connection.db

    @property
    def user(self) -> User:
        """Get authenticated user."""
        assert self.connection.user is not None
        return self.connection.user

    async def route_message(
        self,
        data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Route a message to the appropriate handler.

        Args:
            data: Raw message data from WebSocket.

        Returns:
            Response to send back, or None if no response needed.
        """
        # Validate message format
        try:
            message = WSMessage(**data)
        except ValidationError as e:
            return {
                "type": "error",
                "message": f"Invalid message format: {str(e)}",
            }

        message_type = message.type
        handler = self._get_handler(message_type)

        if handler:
            return await handler(message, data)
        else:
            return await self._handle_unknown(message)

    def _get_handler(
        self,
        message_type: str,
    ) -> Callable[[WSMessage, dict[str, Any]], Awaitable[dict[str, Any] | None]] | None:
        """Get handler for a message type.

        Args:
            message_type: Type of the message.

        Returns:
            Handler method or None.
        """
        handlers: dict[
            str,
            Callable[[WSMessage, dict[str, Any]], Awaitable[dict[str, Any] | None]],
        ] = {
            "heartbeat": self._handle_heartbeat,
            "runner_info": self._handle_runner_info,
            "session_start": self._handle_session_start,
            "session_end": self._handle_session_end,
            "log": self._handle_log,
            "screenshot": self._handle_screenshot,
            "input_event": self._handle_input_event,
            "command_response": self._handle_command_response,
            "tree_event": self._handle_tree_event,
            "issue_detected": self._handle_issue_detected,
            "issue_updated": self._handle_issue_updated,
            "issues_sync": self._handle_issues_sync,
            "pong": self._handle_pong,
            "chat_response": self._handle_chat_response,
            "chat_session_state": self._handle_chat_response,
            "chat_message_ack": self._handle_chat_response,
            "chat_running_tasks": self._handle_chat_response,
            "chat_created": self._handle_chat_response,
            "terminal_output": self._handle_terminal_response,
            "terminal_exit": self._handle_terminal_response,
            "terminal_sessions": self._handle_terminal_response,
            "terminal_created": self._handle_terminal_response,
            "terminal_closed": self._handle_terminal_response,
            "terminal_buffer_response": self._handle_terminal_response,
        }

        # Check exact match first
        if message_type in handlers:
            return handlers[message_type]

        # Check extraction events
        if message_type.startswith("extraction_"):
            return self._handle_extraction_event

        # Check execution events
        if message_type in (
            "image_recognition",
            "action_execution",
            "execution_started",
            "execution_completed",
            "state_changed",
            "progress",
            "error",
        ):
            return self._handle_execution_event

        return None

    async def _handle_heartbeat(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle heartbeat message."""
        await self.connection.refresh_connection_ttl()
        return {
            "type": "heartbeat_ack",
            "timestamp": make_timestamp(),
        }

    async def _handle_runner_info(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle runner info message."""
        runner_name = message.data.get("runner_name")
        if runner_name:
            await self.connection.update_runner_name(runner_name)

        runner_port = message.data.get("runner_port")
        if runner_port is not None:
            try:
                await self.connection.update_runner_port(int(runner_port))
            except (ValueError, TypeError):
                logger.warning(
                    "invalid_runner_port",
                    runner_port=runner_port,
                )

        logger.info(
            "runner_info_received",
            connection_id=(
                self.connection.connection_record.id
                if self.connection.connection_record
                else None
            ),
            runner_name=runner_name,
            runner_port=runner_port,
            runner_hostname=message.data.get("runner_hostname"),
            runner_os=message.data.get("runner_os"),
            runner_version=message.data.get("runner_version"),
        )

        return {
            "type": "runner_info_ack",
            "timestamp": make_timestamp(),
        }

    async def _handle_session_start(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle session start message."""
        session_id = (
            UUID(message.data.get("session_id"))
            if message.data.get("session_id")
            else None
        )
        workflow_name = message.data.get("workflow_name", "Unknown")
        request_id = raw_data.get("request_id")

        # Update runner name if provided
        runner_name = message.data.get("runner_name")
        if runner_name:
            await self.connection.update_runner_name(runner_name)

        # Start session
        response = await self.session.start_session(
            session_id=session_id,
            workflow_name=workflow_name,
            request_id=request_id,
        )

        # Broadcast session_start event to status channel
        if response.get("type") != "error":
            session_start_event = {
                "type": "session_start",
                "session_id": str(session_id) if session_id else str(uuid.uuid4()),
                "project_id": (
                    str(message.data.get("project_id"))
                    if message.data.get("project_id")
                    else None
                ),
                "runner_version": message.data.get("runner_version"),
                "runner_os": message.data.get("runner_os"),
                "runner_hostname": message.data.get("runner_hostname"),
                "workflow_name": workflow_name,
                "timestamp": make_timestamp(),
            }
            await self.connection.broadcast_status_event(session_start_event)

        return response

    async def _handle_session_end(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle session end message."""
        status = message.data.get("status", "completed")
        response = self.session.end_session(status)

        # Broadcast session_end event
        if response.get("type") != "error":
            session_end_event = {
                "type": "session_end",
                "session_id": (
                    str(self.session.session_id) if self.session.session_id else None
                ),
                "status": status,
                "error_message": message.data.get("error_message"),
                "timestamp": make_timestamp(),
            }
            await self.connection.broadcast_status_event(session_end_event)

        return response

    async def _handle_log(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle log message."""
        error = self.session.require_session()
        if error:
            return error

        log_level = message.data.get("level", "info")
        log_message = message.data.get("message", "")

        logger.info(
            "automation_log",
            user_id=str(self.user.id),
            level=log_level,
            message=log_message,
        )

        # Broadcast log event
        log_event = {
            "type": "log",
            "log_id": str(uuid.uuid4()),
            "session_id": (
                str(self.session.session_id) if self.session.session_id else None
            ),
            "level": log_level,
            "message": log_message,
            "log_data": message.data.get("data"),
            "sequence_number": message.data.get("sequence_number", 0),
            "timestamp": make_timestamp(),
        }
        await self.connection.broadcast_status_event(log_event)

        return {
            "type": "log_received",
            "timestamp": make_timestamp(),
        }

    async def _handle_screenshot(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle screenshot message."""
        error = self.session.require_session()
        if error:
            return error

        response = await handle_screenshot(
            message.data,
            self.db,
            self.user.id,
            self.session.session_id,
        )

        # Broadcast screenshot event if successful
        if response.get("type") == "screenshot_stored":
            screenshot_id = response.get("screenshot_id")
            metadata = message.data.get("metadata", {})

            # Generate presigned URL
            try:
                from app.services.storage.object_storage import object_storage

                s3_key = f"automation/{self.user.id}/{self.session.session_id}/{screenshot_id}.png"
                presigned_url = object_storage.backend.generate_presigned_url(
                    key=s3_key,
                    expiration=3600 * 24 * 7,  # 7 days
                )
            except Exception as e:
                logger.error("screenshot_presigned_url_failed", error=str(e))
                presigned_url = None

            screenshot_event = {
                "type": "screenshot",
                "screenshot_id": screenshot_id,
                "session_id": (
                    str(self.session.session_id) if self.session.session_id else None
                ),
                "name": metadata.get(
                    "name",
                    f"Screenshot {datetime.now(UTC).strftime('%H:%M:%S')}",
                ),
                "width": metadata.get("width", 0),
                "height": metadata.get("height", 0),
                "presigned_url": presigned_url,
                "automation_metadata": metadata,
                "timestamp": make_timestamp(),
            }
            await self.connection.broadcast_status_event(screenshot_event)
            logger.info(
                "screenshot_broadcast",
                user_id=str(self.user.id),
                screenshot_id=screenshot_id,
            )

        return response

    async def _handle_input_event(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle input event message."""
        error = self.session.require_session()
        if error:
            return error

        return await handle_input_event(
            message.data,
            self.db,
            self.session.session_id,
        )

    async def _handle_command_response(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle command response from runner."""
        return await handle_command_response(
            message=message,
            raw_data=raw_data,
            send_to_frontends=self.connection.send_to_frontends,
            connection_id=self._get_connection_id(),
        )

    async def _handle_extraction_event(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle web extraction events from runner."""
        return await handle_extraction_event(
            message=message,
            raw_data=raw_data,
            send_to_frontends=self.connection.send_to_frontends,
            connection_id=self._get_connection_id(),
        )

    async def _handle_tree_event(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle tree event from runner."""
        return await handle_tree_event(
            message=message,
            raw_data=raw_data,
            db=self.db,
            send_to_frontends=self.connection.send_to_frontends,
            connection_id=self._get_connection_id(),
        )

    async def _handle_execution_event(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle execution events from runner."""
        return await handle_execution_event(
            message=message,
            raw_data=raw_data,
            send_to_frontends=self.connection.send_to_frontends,
            connection_id=self._get_connection_id(),
        )

    async def _handle_issue_detected(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle detected issue from runner."""
        return await handle_issue_detected(
            message=message,
            raw_data=raw_data,
            db=self.db,
            user_id=self.user.id,
            session_id=self.session.session_id,
            send_to_frontends=self.connection.send_to_frontends,
        )

    async def _handle_issue_updated(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle issue status update from runner."""
        return await handle_issue_updated(
            message=message,
            raw_data=raw_data,
            user_id=self.user.id,
            session_id=self.session.session_id,
            send_to_frontends=self.connection.send_to_frontends,
        )

    async def _handle_issues_sync(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Handle bulk issues sync from runner."""
        return await handle_issues_sync(
            message=message,
            raw_data=raw_data,
            db=self.db,
            user_id=self.user.id,
            session_id=self.session.session_id,
        )

    async def _handle_chat_response(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Forward chat response to connected mobiles."""
        await self.connection.send_chat_to_mobiles(raw_data)
        return None

    async def _handle_terminal_response(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Forward terminal response to connected mobiles."""
        await self.connection.send_terminal_to_mobiles(raw_data)
        return None

    async def _handle_pong(
        self,
        message: WSMessage,
        raw_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Handle pong response - silently ignore."""
        return None

    async def _handle_unknown(
        self,
        message: WSMessage,
    ) -> dict[str, Any]:
        """Handle unknown message type - relay to frontend anyway."""
        return await handle_unknown_message(
            message=message,
            send_to_frontends=self.connection.send_to_frontends,
            connection_id=self._get_connection_id(),
        )

    def _get_connection_id(self) -> Any:
        """Get connection ID for logging."""
        return (
            self.connection.connection_record.id
            if self.connection.connection_record
            else None
        )
