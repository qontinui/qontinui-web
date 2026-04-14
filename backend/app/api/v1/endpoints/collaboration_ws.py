"""WebSocket endpoints for real-time collaboration.

Provides real-time presence, cursor tracking, resource locking,
and activity broadcasting for collaborative project editing.

This module provides a thin endpoint layer that delegates to the refactored
WebSocket infrastructure in app.websockets.collaboration.
"""

from app.websockets.collaboration import collaboration_handler
from fastapi import APIRouter, WebSocket

router = APIRouter()


@router.websocket("/ws/projects/{project_id}/collaboration")
async def collaboration_websocket(
    websocket: WebSocket,
    project_id: str,
    token: str,
) -> None:
    """WebSocket endpoint for real-time collaboration.

    Connection URL:
        ws://localhost:8000/api/v1/ws/projects/{project_id}/collaboration?token=<jwt_token>

    Query Parameters:
        token: JWT access token for authentication

    Message Types (Client -> Server):
        - heartbeat: Keep connection alive
          {"type": "heartbeat"}

        - cursor_move: Update cursor position
          {"type": "cursor_move", "data": {"x": 100, "y": 200, "workflow_id": "wf123"}}

        - lock_acquire: Acquire resource lock
          {"type": "lock_acquire", "data": {"resource_type": "workflow", "resource_id": "wf123"}}

        - lock_release: Release resource lock
          {"type": "lock_release", "data": {"resource_id": "wf123"}}

        - resource_update: Broadcast resource update
          {"type": "resource_update", "data": {
              "resource_type": "workflow",
              "resource_id": "wf123",
              "action": "modified",
              "changes": {...}
          }}

        - comment_add: Add a comment
          {"type": "comment_add", "data": {
              "content": "Great work!",
              "workflow_id": "wf123",
              "position": {"x": 100, "y": 200},
              "mentions": ["user-id-1"]
          }}

        - activity: Log activity
          {"type": "activity", "data": {
              "action_type": "created",
              "resource_type": "state",
              "resource_id": "state123",
              "resource_name": "LoginState"
          }}

    Message Types (Server -> Client):
        - presence_update: User joined/left/active
        - cursor_move: Real-time cursor position
        - lock_acquired: Someone started editing
        - lock_released: Someone stopped editing
        - resource_updated: Workflow/state/image changed
        - comment_added: New comment
        - activity: Any project activity
        - error: Error message
        - active_users: List of currently active users
        - rate_limit_exceeded: Rate limit exceeded

    Features:
        - Connection pooling per project
        - Automatic heartbeat/ping-pong
        - Graceful disconnect handling
        - Auto-release locks on disconnect
        - Broadcast to all project members except sender
        - Rate limiting per user (60 messages per minute)
        - Message validation
    """
    await collaboration_handler.handle_connection(
        websocket, token=token, project_id=project_id
    )
