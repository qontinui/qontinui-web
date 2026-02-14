"""Message handlers for collaboration WebSocket.

Handles individual message types for real-time collaboration.
"""

from datetime import datetime
from typing import Any

import structlog
from pydantic import BaseModel

from app.models.collaboration import ActionType, ResourceType
from app.services.websocket_manager import connection_manager
from app.websockets.base import WebSocketContext
from app.websockets.collaboration.sync_manager import CollaborationSyncManager

logger = structlog.get_logger(__name__)


class WSMessage(BaseModel):
    """Base WebSocket message."""

    type: str
    data: dict[str, Any] = {}


async def handle_heartbeat(
    context: WebSocketContext,
    project_id: str,
) -> None:
    """Handle heartbeat message."""
    await connection_manager.update_heartbeat(project_id, context.user_id)
    await context.websocket.send_json(
        {
            "type": "heartbeat_ack",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    )


async def handle_ack(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
) -> None:
    """Handle message acknowledgment."""
    sequence = data.get("sequence")

    if not sequence or not isinstance(sequence, int):
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Missing or invalid sequence number",
            }
        )
        return

    acknowledged = await connection_manager.acknowledge_message(
        project_id, context.user_id, sequence
    )

    if acknowledged:
        logger.debug(
            "collaboration_ws_ack_received",
            project_id=project_id,
            user_id=str(context.user_id),
            sequence=sequence,
        )


async def handle_resend(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
) -> None:
    """Handle message resend request."""
    from_sequence = data.get("from_sequence")

    if not from_sequence or not isinstance(from_sequence, int):
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Missing or invalid from_sequence",
            }
        )
        return

    resent_count = await connection_manager.resend_messages(
        project_id, context.user_id, from_sequence
    )

    logger.info(
        "collaboration_ws_resend_requested",
        project_id=project_id,
        user_id=str(context.user_id),
        from_sequence=from_sequence,
        resent_count=resent_count,
    )

    await context.websocket.send_json(
        {
            "type": "resend_complete",
            "from_sequence": from_sequence,
            "count": resent_count,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    )


async def handle_sync_state(
    context: WebSocketContext,
    project_id: str,
) -> None:
    """Handle sync state request."""
    state = await connection_manager.get_connection_state(project_id, context.user_id)

    if state:
        await context.websocket.send_json(
            {
                "type": "sync_state_response",
                "state": state,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )
    else:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Connection state not found",
            }
        )


async def handle_cursor_move(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
) -> None:
    """Handle cursor movement."""
    await connection_manager.update_cursor(project_id, context.user_id, data)

    await connection_manager.broadcast(
        project_id,
        {
            "type": "cursor_move",
            "user_id": str(context.user_id),
            "username": context.user.username,
            "cursor": data,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
        exclude_user_id=context.user_id,
    )


async def handle_lock_acquire(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
    sync_manager: CollaborationSyncManager,
) -> None:
    """Handle lock acquisition request."""
    resource_type_str = data.get("resource_type")
    resource_id = data.get("resource_id")

    if not resource_type_str or not resource_id:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Missing resource_type or resource_id",
            }
        )
        return

    try:
        resource_type = ResourceType(resource_type_str)
    except ValueError:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": f"Invalid resource_type: {resource_type_str}",
            }
        )
        return

    lock = await sync_manager.acquire_lock(resource_type, resource_id)

    if lock:
        await connection_manager.add_lock(project_id, context.user_id, resource_id)

        await context.websocket.send_json(
            {
                "type": "lock_acquired",
                "resource_type": resource_type.value,
                "resource_id": resource_id,
                "expires_at": lock.expires_at.isoformat() + "Z",
            }
        )

        await connection_manager.broadcast(
            project_id,
            {
                "type": "lock_acquired",
                "resource_type": resource_type.value,
                "resource_id": resource_id,
                "user_id": str(context.user_id),
                "username": context.user.username,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            exclude_user_id=context.user_id,
        )
    else:
        await context.websocket.send_json(
            {
                "type": "lock_denied",
                "resource_type": resource_type.value,
                "resource_id": resource_id,
                "message": "Resource is locked by another user",
            }
        )


async def handle_lock_release(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
    sync_manager: CollaborationSyncManager,
) -> None:
    """Handle lock release request."""
    resource_id = data.get("resource_id")

    if not resource_id:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Missing resource_id",
            }
        )
        return

    released = await sync_manager.release_lock(resource_id)

    if released:
        await connection_manager.remove_lock(project_id, context.user_id, resource_id)

        await context.websocket.send_json(
            {
                "type": "lock_released",
                "resource_id": resource_id,
            }
        )

        await connection_manager.broadcast(
            project_id,
            {
                "type": "lock_released",
                "resource_id": resource_id,
                "user_id": str(context.user_id),
                "username": context.user.username,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            exclude_user_id=context.user_id,
        )


async def handle_resource_update(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
    sync_manager: CollaborationSyncManager,
) -> None:
    """Handle resource update broadcast."""
    resource_type_str = data.get("resource_type")
    resource_id = data.get("resource_id")
    action = data.get("action", "modified")
    changes = data.get("changes")

    if not resource_type_str or not resource_id:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Missing resource_type or resource_id",
            }
        )
        return

    assert isinstance(resource_id, str)

    try:
        resource_type = ResourceType(resource_type_str)
        action_type = ActionType(action)
    except ValueError as e:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": f"Invalid type: {str(e)}",
            }
        )
        return

    # Log activity
    await sync_manager.log_activity(
        action_type,
        resource_type,
        resource_id,
        data.get("resource_name"),
        changes,
    )

    # Broadcast to others
    await connection_manager.broadcast(
        project_id,
        {
            "type": "resource_updated",
            "resource_type": resource_type.value,
            "resource_id": resource_id,
            "action": action,
            "changes": changes,
            "user_id": str(context.user_id),
            "username": context.user.username,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
        exclude_user_id=context.user_id,
    )


async def handle_comment_add(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
    sync_manager: CollaborationSyncManager,
) -> None:
    """Handle comment addition."""
    content = data.get("content")

    if not content:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Missing content",
            }
        )
        return

    comment = await sync_manager.add_comment(
        content=content,
        workflow_id=data.get("workflow_id"),
        action_id=data.get("action_id"),
        position=data.get("position"),
        mentions=data.get("mentions"),
    )

    # Broadcast comment to all
    await connection_manager.broadcast(
        project_id,
        {
            "type": "comment_added",
            "comment_id": str(comment.id),
            "workflow_id": comment.workflow_id,
            "action_id": comment.action_id,
            "author_id": str(context.user_id),
            "author_username": context.user.username,
            "author_avatar": context.user.avatar_url,
            "content": content,
            "position": comment.position,
            "mentions": comment.mentions,
            "created_at": comment.created_at.isoformat() + "Z",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    )

    # Send acknowledgment to sender
    await context.websocket.send_json(
        {
            "type": "comment_added_ack",
            "comment_id": str(comment.id),
        }
    )


async def handle_activity(
    context: WebSocketContext,
    project_id: str,
    data: dict[str, Any],
    sync_manager: CollaborationSyncManager,
) -> None:
    """Handle activity logging and broadcast."""
    action_type_str = data.get("action_type")
    resource_type_str = data.get("resource_type")
    resource_id = data.get("resource_id")

    if not all([action_type_str, resource_type_str, resource_id]):
        await context.websocket.send_json(
            {
                "type": "error",
                "message": "Missing required fields for activity",
            }
        )
        return

    assert isinstance(resource_id, str)
    assert isinstance(action_type_str, str)
    assert isinstance(resource_type_str, str)

    try:
        action_type = ActionType(action_type_str)
        resource_type = ResourceType(resource_type_str)
    except ValueError as e:
        await context.websocket.send_json(
            {
                "type": "error",
                "message": f"Invalid type: {str(e)}",
            }
        )
        return

    # Log activity
    await sync_manager.log_activity(
        action_type,
        resource_type,
        resource_id,
        data.get("resource_name"),
        data.get("changes"),
    )

    # Broadcast activity
    await connection_manager.broadcast(
        project_id,
        {
            "type": "activity",
            "action_type": action_type.value,
            "resource_type": resource_type.value,
            "resource_id": resource_id,
            "resource_name": data.get("resource_name"),
            "user_id": str(context.user_id),
            "username": context.user.username,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
        exclude_user_id=context.user_id,
    )
