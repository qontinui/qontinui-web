"""WebSocket endpoints for real-time annotation collaboration.

Provides real-time collaboration for annotation editing including:
- Cursor position tracking
- Element selection broadcasting
- Real-time element updates (add, modify, delete)
- User presence in annotation sessions
"""

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, Field, ValidationError

from app.models.user import User
from app.websockets.base import BaseWebSocketHandler, WebSocketContext
from app.websockets.message_types import create_timestamp

logger = structlog.get_logger(__name__)
router = APIRouter()


# ============================================================================
# Message Schemas
# ============================================================================


class AnnotationWSMessage(BaseModel):
    """Base WebSocket message for annotation collaboration."""

    type: str = Field(..., description="Message type identifier")
    data: dict[str, Any] = Field(default_factory=dict, description="Message payload")


class CursorMoveData(BaseModel):
    """Cursor movement data."""

    x: float
    y: float
    viewport_id: str | None = None


class ElementSelectData(BaseModel):
    """Element selection data."""

    element_ids: list[str]


class ElementUpdateData(BaseModel):
    """Element update data."""

    element_id: str
    changes: dict[str, Any]


class ElementAddData(BaseModel):
    """New element data."""

    element: dict[str, Any]


class ElementDeleteData(BaseModel):
    """Element deletion data."""

    element_ids: list[str]


class ElementMoveData(BaseModel):
    """Element move data."""

    element_ids: list[str]
    delta_x: float
    delta_y: float


class ElementResizeData(BaseModel):
    """Element resize data."""

    element_id: str
    bbox: dict[str, float]


# ============================================================================
# Connection Manager
# ============================================================================


class AnnotationConnectionManager:
    """Manages WebSocket connections for annotation collaboration sessions.

    Each annotation set has its own room where connected users can collaborate
    in real-time on annotations.
    """

    def __init__(self) -> None:
        # annotation_set_id -> {websocket: user_info}
        self.active_connections: dict[str, dict[WebSocket, dict[str, Any]]] = {}
        # Track user colors for consistent display
        self.user_colors: dict[str, str] = {}
        self.color_palette = [
            "#3B82F6",  # blue
            "#10B981",  # green
            "#F59E0B",  # amber
            "#EF4444",  # red
            "#8B5CF6",  # purple
            "#EC4899",  # pink
            "#06B6D4",  # cyan
            "#F97316",  # orange
        ]
        self.next_color_index = 0

    def _assign_color(self, user_id: str) -> str:
        """Assign a consistent color to a user."""
        if user_id not in self.user_colors:
            self.user_colors[user_id] = self.color_palette[
                self.next_color_index % len(self.color_palette)
            ]
            self.next_color_index += 1
        return self.user_colors[user_id]

    async def connect(
        self,
        annotation_set_id: str,
        websocket: WebSocket,
        user: User,
    ) -> dict[str, Any]:
        """Connect a user to an annotation collaboration session.

        Args:
            annotation_set_id: The annotation set being edited.
            websocket: The WebSocket connection.
            user: The authenticated user.

        Returns:
            User info dictionary with assigned color.
        """
        if annotation_set_id not in self.active_connections:
            self.active_connections[annotation_set_id] = {}

        user_id = str(user.id)
        color = self._assign_color(user_id)

        user_info: dict[str, Any] = {
            "id": user_id,
            "name": user.full_name or user.email,
            "email": user.email,
            "color": color,
            "cursor": None,
            "selection": [],
            "connected_at": datetime.now(UTC).isoformat() + "Z",
        }

        self.active_connections[annotation_set_id][websocket] = user_info

        # Broadcast user join to others
        await self.broadcast(
            annotation_set_id,
            {
                "type": "user_join",
                "data": user_info,
                "timestamp": create_timestamp(),
            },
            exclude=websocket,
        )

        return user_info

    async def disconnect(
        self,
        annotation_set_id: str,
        websocket: WebSocket,
    ) -> None:
        """Disconnect a user from an annotation collaboration session.

        Args:
            annotation_set_id: The annotation set being edited.
            websocket: The WebSocket connection.
        """
        if annotation_set_id not in self.active_connections:
            return

        user_info = self.active_connections[annotation_set_id].pop(websocket, None)

        if user_info:
            # Broadcast user leave to others
            await self.broadcast(
                annotation_set_id,
                {
                    "type": "user_leave",
                    "data": {"id": user_info["id"], "name": user_info["name"]},
                    "timestamp": create_timestamp(),
                },
            )

        # Cleanup empty rooms
        if not self.active_connections[annotation_set_id]:
            del self.active_connections[annotation_set_id]

    async def broadcast(
        self,
        annotation_set_id: str,
        message: dict[str, Any],
        exclude: WebSocket | None = None,
    ) -> None:
        """Broadcast a message to all users in an annotation session.

        Args:
            annotation_set_id: The annotation set room.
            message: The message to broadcast.
            exclude: Optional WebSocket to exclude from broadcast.
        """
        if annotation_set_id not in self.active_connections:
            return

        disconnected: list[WebSocket] = []

        for ws in self.active_connections[annotation_set_id]:
            if ws != exclude:
                try:
                    await ws.send_json(message)
                except Exception as e:
                    logger.warning(
                        "annotation_ws_broadcast_error",
                        annotation_set_id=annotation_set_id,
                        error=str(e),
                    )
                    disconnected.append(ws)

        # Cleanup disconnected sockets
        for ws in disconnected:
            await self.disconnect(annotation_set_id, ws)

    def get_active_users(self, annotation_set_id: str) -> list[dict[str, Any]]:
        """Get list of active users in an annotation session.

        Args:
            annotation_set_id: The annotation set room.

        Returns:
            List of user info dictionaries.
        """
        if annotation_set_id not in self.active_connections:
            return []
        return list(self.active_connections[annotation_set_id].values())

    def update_user_cursor(
        self,
        annotation_set_id: str,
        websocket: WebSocket,
        x: float,
        y: float,
        viewport_id: str | None = None,
    ) -> None:
        """Update a user's cursor position.

        Args:
            annotation_set_id: The annotation set room.
            websocket: The user's WebSocket.
            x: Cursor X position.
            y: Cursor Y position.
            viewport_id: Optional viewport identifier.
        """
        if annotation_set_id not in self.active_connections:
            return
        if websocket not in self.active_connections[annotation_set_id]:
            return

        self.active_connections[annotation_set_id][websocket]["cursor"] = {
            "x": x,
            "y": y,
            "viewport_id": viewport_id,
        }

    def update_user_selection(
        self,
        annotation_set_id: str,
        websocket: WebSocket,
        element_ids: list[str],
    ) -> None:
        """Update a user's element selection.

        Args:
            annotation_set_id: The annotation set room.
            websocket: The user's WebSocket.
            element_ids: List of selected element IDs.
        """
        if annotation_set_id not in self.active_connections:
            return
        if websocket not in self.active_connections[annotation_set_id]:
            return

        self.active_connections[annotation_set_id][websocket]["selection"] = element_ids


# Global connection manager instance
annotation_manager = AnnotationConnectionManager()


# ============================================================================
# WebSocket Handler
# ============================================================================


class AnnotationWebSocketHandler(BaseWebSocketHandler):
    """WebSocket handler for annotation collaboration.

    Handles real-time collaboration features:
    - Cursor position synchronization
    - Element selection broadcasting
    - Real-time element updates (add, update, delete)
    - User presence tracking
    """

    # Configuration
    connection_rate_limit = 10
    connection_rate_window = 60
    message_rate_limit = 120  # Higher limit for cursor updates
    message_rate_window = 60
    heartbeat_interval = 30.0
    stale_connection_timeout = 120.0

    def __init__(self) -> None:
        """Initialize the handler."""
        super().__init__()
        self.annotation_set_id: str | None = None
        self.user_info: dict[str, Any] | None = None

    @property
    def endpoint_name(self) -> str:
        """Name of this endpoint for logging."""
        return "annotations_ws"

    async def on_connect(
        self,
        context: WebSocketContext,
        **kwargs: Any,
    ) -> bool | None:
        """Called when a connection is established.

        Args:
            context: WebSocket context.
            **kwargs: Must include 'annotation_set_id'.

        Returns:
            False to close the connection, None/True to continue.
        """
        self.annotation_set_id = kwargs.get("annotation_set_id")
        if not self.annotation_set_id:
            await self._send_error(context.websocket, "Missing annotation_set_id")
            return False

        # Connect to the annotation room
        self.user_info = await annotation_manager.connect(
            self.annotation_set_id,
            context.websocket,
            context.user,
        )

        # Send list of active users to the new connection
        active_users = annotation_manager.get_active_users(self.annotation_set_id)
        await context.websocket.send_json(
            {
                "type": "active_users",
                "data": {"users": active_users},
                "timestamp": create_timestamp(),
            }
        )

        # Send connection confirmation
        await context.websocket.send_json(
            {
                "type": "connected",
                "data": {
                    "user_id": str(context.user_id),
                    "color": self.user_info["color"],
                    "annotation_set_id": self.annotation_set_id,
                },
                "timestamp": create_timestamp(),
            }
        )

        self.logger.info(
            "annotations_ws_connected",
            annotation_set_id=self.annotation_set_id,
            user_id=str(context.user_id),
            user_name=context.user.full_name or context.user.email,
        )

        return True

    async def on_message(
        self,
        context: WebSocketContext,
        data: dict[str, Any],
    ) -> None:
        """Handle incoming WebSocket messages.

        Routes messages to the appropriate handler based on type.

        Args:
            context: WebSocket context.
            data: Parsed JSON message data.
        """
        if not self.annotation_set_id:
            return

        # Validate message structure
        try:
            message = AnnotationWSMessage(**data)
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

        # Route to appropriate handler
        if message_type == "heartbeat":
            await self._handle_heartbeat(context)

        elif message_type == "cursor_move":
            await self._handle_cursor_move(context, message.data)

        elif message_type == "element_select":
            await self._handle_element_select(context, message.data)

        elif message_type == "element_update":
            await self._handle_element_update(context, message.data)

        elif message_type == "element_add":
            await self._handle_element_add(context, message.data)

        elif message_type == "element_delete":
            await self._handle_element_delete(context, message.data)

        elif message_type == "element_move":
            await self._handle_element_move(context, message.data)

        elif message_type == "element_resize":
            await self._handle_element_resize(context, message.data)

        elif message_type == "sync_request":
            await self._handle_sync_request(context)

        else:
            await context.websocket.send_json(
                {
                    "type": "error",
                    "message": f"Unknown message type: {message_type}",
                    "timestamp": create_timestamp(),
                }
            )

    async def on_disconnect(self, context: WebSocketContext) -> None:
        """Called when the connection is closing.

        Args:
            context: WebSocket context.
        """
        if self.annotation_set_id:
            await annotation_manager.disconnect(
                self.annotation_set_id,
                context.websocket,
            )
            self.logger.info(
                "annotations_ws_disconnected",
                annotation_set_id=self.annotation_set_id,
                user_id=str(context.user_id),
            )

    async def _handle_heartbeat(self, context: WebSocketContext) -> None:
        """Handle heartbeat message."""
        await context.websocket.send_json(
            {
                "type": "heartbeat_ack",
                "timestamp": create_timestamp(),
            }
        )

    async def _handle_cursor_move(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle cursor movement message."""
        try:
            cursor_data = CursorMoveData(**data)
        except ValidationError:
            return

        if not self.annotation_set_id or not self.user_info:
            return

        # Update stored cursor position
        annotation_manager.update_user_cursor(
            self.annotation_set_id,
            context.websocket,
            cursor_data.x,
            cursor_data.y,
            cursor_data.viewport_id,
        )

        # Broadcast to others
        await annotation_manager.broadcast(
            self.annotation_set_id,
            {
                "type": "cursor_move",
                "data": {
                    "user_id": self.user_info["id"],
                    "name": self.user_info["name"],
                    "color": self.user_info["color"],
                    "x": cursor_data.x,
                    "y": cursor_data.y,
                    "viewport_id": cursor_data.viewport_id,
                },
                "timestamp": create_timestamp(),
            },
            exclude=context.websocket,
        )

    async def _handle_element_select(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle element selection message."""
        try:
            select_data = ElementSelectData(**data)
        except ValidationError:
            return

        if not self.annotation_set_id or not self.user_info:
            return

        # Update stored selection
        annotation_manager.update_user_selection(
            self.annotation_set_id,
            context.websocket,
            select_data.element_ids,
        )

        # Broadcast to others
        await annotation_manager.broadcast(
            self.annotation_set_id,
            {
                "type": "element_select",
                "data": {
                    "user_id": self.user_info["id"],
                    "name": self.user_info["name"],
                    "color": self.user_info["color"],
                    "element_ids": select_data.element_ids,
                },
                "timestamp": create_timestamp(),
            },
            exclude=context.websocket,
        )

    async def _handle_element_update(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle element update message."""
        try:
            update_data = ElementUpdateData(**data)
        except ValidationError:
            return

        if not self.annotation_set_id or not self.user_info:
            return

        # Broadcast to others
        await annotation_manager.broadcast(
            self.annotation_set_id,
            {
                "type": "element_update",
                "data": {
                    "user_id": self.user_info["id"],
                    "element_id": update_data.element_id,
                    "changes": update_data.changes,
                },
                "timestamp": create_timestamp(),
            },
            exclude=context.websocket,
        )

    async def _handle_element_add(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle element add message."""
        try:
            add_data = ElementAddData(**data)
        except ValidationError:
            return

        if not self.annotation_set_id or not self.user_info:
            return

        # Broadcast to others
        await annotation_manager.broadcast(
            self.annotation_set_id,
            {
                "type": "element_add",
                "data": {
                    "user_id": self.user_info["id"],
                    "element": add_data.element,
                },
                "timestamp": create_timestamp(),
            },
            exclude=context.websocket,
        )

    async def _handle_element_delete(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle element delete message."""
        try:
            delete_data = ElementDeleteData(**data)
        except ValidationError:
            return

        if not self.annotation_set_id or not self.user_info:
            return

        # Broadcast to others
        await annotation_manager.broadcast(
            self.annotation_set_id,
            {
                "type": "element_delete",
                "data": {
                    "user_id": self.user_info["id"],
                    "element_ids": delete_data.element_ids,
                },
                "timestamp": create_timestamp(),
            },
            exclude=context.websocket,
        )

    async def _handle_element_move(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle element move message."""
        try:
            move_data = ElementMoveData(**data)
        except ValidationError:
            return

        if not self.annotation_set_id or not self.user_info:
            return

        # Broadcast to others
        await annotation_manager.broadcast(
            self.annotation_set_id,
            {
                "type": "element_move",
                "data": {
                    "user_id": self.user_info["id"],
                    "element_ids": move_data.element_ids,
                    "delta_x": move_data.delta_x,
                    "delta_y": move_data.delta_y,
                },
                "timestamp": create_timestamp(),
            },
            exclude=context.websocket,
        )

    async def _handle_element_resize(
        self, context: WebSocketContext, data: dict[str, Any]
    ) -> None:
        """Handle element resize message."""
        try:
            resize_data = ElementResizeData(**data)
        except ValidationError:
            return

        if not self.annotation_set_id or not self.user_info:
            return

        # Broadcast to others
        await annotation_manager.broadcast(
            self.annotation_set_id,
            {
                "type": "element_resize",
                "data": {
                    "user_id": self.user_info["id"],
                    "element_id": resize_data.element_id,
                    "bbox": resize_data.bbox,
                },
                "timestamp": create_timestamp(),
            },
            exclude=context.websocket,
        )

    async def _handle_sync_request(self, context: WebSocketContext) -> None:
        """Handle sync request message - send current state to requester."""
        if not self.annotation_set_id:
            return

        active_users = annotation_manager.get_active_users(self.annotation_set_id)
        await context.websocket.send_json(
            {
                "type": "sync_response",
                "data": {"users": active_users},
                "timestamp": create_timestamp(),
            }
        )


# ============================================================================
# WebSocket Endpoint
# ============================================================================


@router.websocket("/ws/annotations/{annotation_set_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    annotation_set_id: str,
    token: str | None = None,
) -> None:
    """WebSocket endpoint for real-time annotation collaboration.

    Connection URL:
        ws://localhost:8000/api/v1/ws/annotations/{annotation_set_id}?token=<jwt_token>

    Query Parameters:
        token: JWT access token for authentication

    Message Types (Client -> Server):
        - heartbeat: Keep connection alive
          {"type": "heartbeat"}

        - cursor_move: Update cursor position
          {"type": "cursor_move", "data": {"x": 100, "y": 200, "viewport_id": "canvas"}}

        - element_select: Update element selection
          {"type": "element_select", "data": {"element_ids": ["elem_1", "elem_2"]}}

        - element_update: Update element properties
          {"type": "element_update", "data": {"element_id": "elem_1", "changes": {"label": "Button"}}}

        - element_add: Add new element
          {"type": "element_add", "data": {"element": {...}}}

        - element_delete: Delete elements
          {"type": "element_delete", "data": {"element_ids": ["elem_1"]}}

        - element_move: Move elements
          {"type": "element_move", "data": {"element_ids": ["elem_1"], "delta_x": 10, "delta_y": 20}}

        - element_resize: Resize element
          {"type": "element_resize", "data": {"element_id": "elem_1", "bbox": {"x": 0, "y": 0, "width": 100, "height": 50}}}

        - sync_request: Request current collaboration state
          {"type": "sync_request"}

    Message Types (Server -> Client):
        - connected: Connection established
        - active_users: List of currently connected users
        - user_join: User joined the session
        - user_leave: User left the session
        - cursor_move: Real-time cursor position from other users
        - element_select: Element selection from other users
        - element_update: Element update from other users
        - element_add: New element from other users
        - element_delete: Element deletion from other users
        - element_move: Element movement from other users
        - element_resize: Element resize from other users
        - sync_response: Response to sync_request
        - error: Error message
        - heartbeat_ack: Heartbeat acknowledgment
    """
    # Create a new handler instance for this connection
    handler = AnnotationWebSocketHandler()
    await handler.handle_connection(
        websocket,
        token=token,
        annotation_set_id=annotation_set_id,
    )
