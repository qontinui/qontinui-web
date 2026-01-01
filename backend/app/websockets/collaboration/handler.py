"""WebSocket handler for real-time collaboration.

Provides real-time presence, cursor tracking, resource locking,
and activity broadcasting for collaborative project editing.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from pydantic import ValidationError

from app.crud.project import get_project
from app.services.websocket_manager import connection_manager
from app.utils.authorization import verify_project_access
from app.websockets.base import BaseWebSocketHandler, WebSocketContext
from app.websockets.collaboration.message_handlers import (
    WSMessage,
    handle_ack,
    handle_activity,
    handle_comment_add,
    handle_cursor_move,
    handle_heartbeat,
    handle_lock_acquire,
    handle_lock_release,
    handle_resend,
    handle_resource_update,
    handle_sync_state,
)
from app.websockets.collaboration.sync_manager import CollaborationSyncManager

logger = structlog.get_logger(__name__)


class CollaborationWebSocketHandler(BaseWebSocketHandler):
    """WebSocket handler for real-time collaboration.

    Handles the WebSocket connection lifecycle for collaborative editing,
    including presence tracking, cursor synchronization, resource locking,
    and activity broadcasting.
    """

    # Configuration
    connection_rate_limit = 5
    connection_rate_window = 60
    message_rate_limit = 60
    message_rate_window = 60
    heartbeat_interval = 120.0
    stale_connection_timeout = 300.0

    @property
    def endpoint_name(self) -> str:
        """Name of this endpoint for logging."""
        return "collaboration_ws"

    def __init__(self) -> None:
        """Initialize the handler."""
        super().__init__()
        self.sync_manager: CollaborationSyncManager | None = None
        self.project_id: str | None = None
        self.connection: Any | None = None

    async def on_connect(
        self,
        context: WebSocketContext,
        **kwargs: Any,
    ) -> bool | None:
        """Called when a connection is established.

        Verifies project access and initializes collaboration state.

        Args:
            context: WebSocket context.
            **kwargs: Must include 'project_id'.

        Returns:
            False to close the connection, None/True to continue.
        """
        self.project_id = kwargs.get("project_id")
        if not self.project_id:
            await self._send_error(context.websocket, "Missing project_id")
            return False

        # Verify project access
        try:
            project = await get_project(context.db, project_id=UUID(self.project_id))
            if not project:
                await context.websocket.close(
                    code=status.WS_1008_POLICY_VIOLATION, reason="Project not found"
                )
                return False

            verify_project_access(project, context.user, "collaborate")
        except HTTPException:
            await context.websocket.close(
                code=status.WS_1008_POLICY_VIOLATION, reason="Access denied"
            )
            return False

        # Initialize sync manager
        self.sync_manager = CollaborationSyncManager(
            db=context.db,
            project_id=self.project_id,
            user=context.user,
        )

        # Add connection to manager
        self.connection = await connection_manager.connect(
            self.project_id, context.websocket, context.user
        )

        # Send current active users list
        active_users = connection_manager.get_active_users(self.project_id)
        await context.websocket.send_json(
            {
                "type": "active_users",
                "users": active_users,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

        # Send initial connection state
        connection_state = await connection_manager.get_connection_state(
            self.project_id, context.user_id
        )
        if connection_state:
            await context.websocket.send_json(
                {
                    "type": "connection_state",
                    "state": connection_state,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )

        self.logger.info(
            "collaboration_ws_connected",
            project_id=self.project_id,
            user_id=str(context.user_id),
            username=context.user.username,
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
        if not self.project_id or not self.sync_manager:
            return

        # Check rate limit via connection manager
        allowed, _ = connection_manager.check_rate_limit(
            context.user_id, max_messages=60, window_seconds=60
        )

        if not allowed:
            await context.websocket.send_json(
                {
                    "type": "rate_limit_exceeded",
                    "message": "Too many messages. Please slow down.",
                }
            )
            self.logger.warning(
                "collaboration_ws_rate_limit",
                project_id=self.project_id,
                user_id=str(context.user_id),
            )
            return

        # Validate message
        try:
            message = WSMessage(**data)
        except ValidationError as e:
            await context.websocket.send_json(
                {
                    "type": "error",
                    "message": f"Invalid message format: {str(e)}",
                }
            )
            return

        message_type = message.type

        # Route to appropriate handler
        if message_type == "heartbeat":
            await handle_heartbeat(context, self.project_id)

        elif message_type == "ack":
            await handle_ack(context, self.project_id, message.data)

        elif message_type == "resend":
            await handle_resend(context, self.project_id, message.data)

        elif message_type == "sync_state":
            await handle_sync_state(context, self.project_id)

        elif message_type == "cursor_move":
            await handle_cursor_move(context, self.project_id, message.data)

        elif message_type == "lock_acquire":
            await handle_lock_acquire(
                context, self.project_id, message.data, self.sync_manager
            )

        elif message_type == "lock_release":
            await handle_lock_release(
                context, self.project_id, message.data, self.sync_manager
            )

        elif message_type == "resource_update":
            await handle_resource_update(
                context, self.project_id, message.data, self.sync_manager
            )

        elif message_type == "comment_add":
            await handle_comment_add(
                context, self.project_id, message.data, self.sync_manager
            )

        elif message_type == "activity":
            await handle_activity(
                context, self.project_id, message.data, self.sync_manager
            )

        else:
            await context.websocket.send_json(
                {
                    "type": "error",
                    "message": f"Unknown message type: {message_type}",
                }
            )

    async def on_disconnect(self, context: WebSocketContext) -> None:
        """Called when the connection is closing.

        Releases locks and removes connection from manager.

        Args:
            context: WebSocket context.
        """
        if self.sync_manager:
            try:
                await self.sync_manager.release_all_user_locks()
            except Exception as e:
                self.logger.error(
                    "collaboration_ws_lock_cleanup_error",
                    project_id=self.project_id,
                    user_id=str(context.user_id),
                    error=str(e),
                )

        if self.connection and self.project_id:
            await connection_manager.disconnect(self.project_id, context.websocket)


# Module-level handler instance
collaboration_handler = CollaborationWebSocketHandler()
