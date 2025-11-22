"""
WebSocket endpoints for real-time collaboration.

Provides real-time presence, cursor tracking, resource locking,
and activity broadcasting for collaborative project editing.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_user_from_ws
from app.crud.project import get_project
from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from app.models.user import User
from app.services.websocket_manager import connection_manager
from app.utils.authorization import verify_project_access
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ValidationError
from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()
logger = structlog.get_logger(__name__)


# WebSocket message schemas
class WSMessage(BaseModel):
    """Base WebSocket message."""

    type: str
    data: dict = {}


class PresenceUpdateMessage(BaseModel):
    """Presence update message."""

    type: str = "presence_update"
    action: str  # joined, left, active
    user_id: str
    username: str
    cursor_position: Optional[dict] = None


class CursorMoveMessage(BaseModel):
    """Cursor movement message."""

    type: str = "cursor_move"
    x: float
    y: float
    workflow_id: Optional[str] = None


class LockMessage(BaseModel):
    """Resource lock message."""

    type: str  # lock_acquired, lock_released
    resource_type: str
    resource_id: str
    user_id: str
    username: str


class ResourceUpdateMessage(BaseModel):
    """Resource update message."""

    type: str = "resource_updated"
    resource_type: str
    resource_id: str
    action: str  # created, modified, deleted
    changes: Optional[dict] = None


class CommentMessage(BaseModel):
    """Comment added message."""

    type: str = "comment_added"
    comment_id: str
    workflow_id: Optional[str] = None
    action_id: Optional[str] = None
    author_id: str
    author_username: str
    content: str
    position: Optional[dict] = None


class ActivityMessage(BaseModel):
    """Activity message."""

    type: str = "activity"
    action_type: str
    resource_type: str
    resource_id: str
    user_id: str
    username: str
    timestamp: str


async def verify_project_access_ws(
    db: AsyncSession,
    project_id: str,
    user: User,
    websocket: WebSocket,
) -> bool:
    """
    Verify user has access to project for WebSocket connection.

    Args:
        db: Database session
        project_id: ID of the project
        user: User attempting to connect
        websocket: WebSocket connection

    Returns:
        True if access granted

    Closes WebSocket and raises exception if access denied.
    """
    # Get project
    project = await get_project(db, project_id=project_id)
    if not project:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Project not found"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Verify access
    try:
        verify_project_access(project, user, "collaborate")
    except HTTPException:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Access denied",
        )
        raise

    return True


async def acquire_resource_lock(
    db: AsyncSession,
    project_id: str,
    user_id: UUID,
    resource_type: ResourceType,
    resource_id: str,
    duration_minutes: int = 5,
) -> Optional[ProjectLock]:
    """
    Acquire a lock on a resource.

    Uses SELECT FOR UPDATE to prevent race conditions when multiple users
    attempt to acquire the same lock simultaneously.

    Args:
        db: Database session
        project_id: ID of the project
        user_id: ID of the user
        resource_type: Type of resource
        resource_id: ID of the resource
        duration_minutes: Lock duration in minutes

    Returns:
        ProjectLock if acquired, None if resource already locked
    """
    try:
        # Check for existing locks on this resource with row-level lock
        # SELECT FOR UPDATE prevents race conditions by locking the row
        result = await db.execute(
            select(ProjectLock)
            .where(
                and_(
                    ProjectLock.project_id == int(project_id),
                    ProjectLock.resource_type == resource_type,
                    ProjectLock.resource_id == resource_id,
                )
            )
            .with_for_update()
        )
        existing_lock = result.scalar_one_or_none()

        if existing_lock:
            # If lock expired, delete it atomically within transaction
            if existing_lock.is_expired():
                await db.delete(existing_lock)
                await db.flush()  # Flush to ensure deletion is visible in this transaction
                logger.info(
                    "expired_lock_released_ws",
                    project_id=project_id,
                    lock_id=existing_lock.id,
                )
                # Continue to create new lock below
                existing_lock = None
            elif existing_lock.user_id == user_id:
                # Extend existing lock for this user
                existing_lock.extend_lock(minutes=duration_minutes)
                await db.commit()
                await db.refresh(existing_lock)
                logger.info(
                    "lock_extended_ws",
                    project_id=project_id,
                    user_id=str(user_id),
                    resource_id=resource_id,
                )
                return existing_lock
            else:
                # Lock held by another user and not expired
                logger.warning(
                    "lock_acquisition_failed_ws",
                    project_id=project_id,
                    resource_id=resource_id,
                    holder=str(existing_lock.user_id),
                    requester=str(user_id),
                )
                await db.rollback()
                return None

        # Create new lock (either no lock existed or expired lock was deleted)
        if existing_lock is None:
            lock = ProjectLock(
                project_id=int(project_id),
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                acquired_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + timedelta(minutes=duration_minutes),
                auto_release=True,
            )
            db.add(lock)
            await db.commit()
            await db.refresh(lock)

            logger.info(
                "lock_acquired",
                project_id=project_id,
                user_id=str(user_id),
                resource_type=resource_type.value,
                resource_id=resource_id,
            )

            return lock

    except Exception as e:
        logger.error("lock_acquisition_error_ws", error=str(e))
        await db.rollback()
        raise


async def release_resource_lock(
    db: AsyncSession,
    project_id: str,
    user_id: UUID,
    resource_id: str,
) -> bool:
    """
    Release a lock on a resource.

    Args:
        db: Database session
        project_id: ID of the project
        user_id: ID of the user
        resource_id: ID of the resource

    Returns:
        True if lock was released
    """
    result = await db.execute(
        delete(ProjectLock).where(
            and_(
                ProjectLock.project_id == int(project_id),
                ProjectLock.user_id == user_id,
                ProjectLock.resource_id == resource_id,
            )
        )
    )
    await db.commit()

    released = result.rowcount > 0

    if released:
        logger.info(
            "lock_released",
            project_id=project_id,
            user_id=str(user_id),
            resource_id=resource_id,
        )

    return released


async def release_user_locks(
    db: AsyncSession,
    project_id: str,
    user_id: UUID,
) -> int:
    """
    Release all locks for a user in a project.

    Args:
        db: Database session
        project_id: ID of the project
        user_id: ID of the user

    Returns:
        Number of locks released
    """
    result = await db.execute(
        delete(ProjectLock).where(
            and_(
                ProjectLock.project_id == int(project_id),
                ProjectLock.user_id == user_id,
                ProjectLock.auto_release == True,  # noqa: E712
            )
        )
    )
    await db.commit()

    count = result.rowcount

    if count > 0:
        logger.info(
            "user_locks_released",
            project_id=project_id,
            user_id=str(user_id),
            count=count,
        )

    return count


async def log_activity(
    db: AsyncSession,
    project_id: str,
    user_id: UUID,
    action_type: ActionType,
    resource_type: ResourceType,
    resource_id: str,
    resource_name: str = None,
    changes: dict = None,
) -> ActivityLog:
    """
    Log an activity to the database.

    Args:
        db: Database session
        project_id: ID of the project
        user_id: ID of the user
        action_type: Type of action
        resource_type: Type of resource
        resource_id: ID of the resource
        resource_name: Name of the resource
        changes: Changes made

    Returns:
        ActivityLog entry
    """
    activity = ActivityLog.create_activity(
        project_id=int(project_id),
        user_id=user_id,
        action_type=action_type,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_name=resource_name,
        changes=changes,
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    return activity


@router.websocket("/ws/projects/{project_id}/collaboration")
async def collaboration_websocket(
    websocket: WebSocket,
    project_id: str,
    token: str,
):
    """
    WebSocket endpoint for real-time collaboration.

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
    await websocket.accept()

    logger.info(
        "collaboration_ws_connection_attempt",
        project_id=project_id,
    )

    connection = None
    db = None

    try:
        # Authenticate user
        try:
            user = await get_current_user_from_ws(token)
        except Exception as e:
            logger.error("collaboration_ws_auth_failed", error=str(e))
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication failed",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Get database session
        async for db_session in get_async_db():
            db = db_session
            break

        if not db:
            logger.error("collaboration_ws_db_failed")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Database connection failed",
                }
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        # Verify project access
        try:
            await verify_project_access_ws(db, project_id, user, websocket)
        except Exception:
            return  # Connection already closed

        # Add connection to manager
        connection = await connection_manager.connect(project_id, websocket, user)

        # Send current active users list
        active_users = connection_manager.get_active_users(project_id)
        await websocket.send_json(
            {
                "type": "active_users",
                "users": active_users,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

        # Send initial connection state (for sequence tracking)
        connection_state = await connection_manager.get_connection_state(
            project_id, user.id
        )
        if connection_state:
            await websocket.send_json(
                {
                    "type": "connection_state",
                    "state": connection_state,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )

        logger.info(
            "collaboration_ws_connected",
            project_id=project_id,
            user_id=str(user.id),
            username=user.username,
        )

        # Main message loop
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)

                # Check rate limit
                allowed, remaining = connection_manager.check_rate_limit(
                    user.id, max_messages=60, window_seconds=60
                )

                if not allowed:
                    await websocket.send_json(
                        {
                            "type": "rate_limit_exceeded",
                            "message": "Too many messages. Please slow down.",
                        }
                    )
                    logger.warning(
                        "collaboration_ws_rate_limit",
                        project_id=project_id,
                        user_id=str(user.id),
                    )
                    continue

                # Validate message
                try:
                    message = WSMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Invalid message format: {str(e)}",
                        }
                    )
                    continue

                # Handle message types
                message_type = message.type

                if message_type == "heartbeat":
                    # Update heartbeat timestamp
                    await connection_manager.update_heartbeat(project_id, user.id)
                    await websocket.send_json(
                        {
                            "type": "heartbeat_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "ack":
                    # Acknowledge message receipt
                    sequence = message.data.get("sequence")

                    if not sequence or not isinstance(sequence, int):
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Missing or invalid sequence number",
                            }
                        )
                        continue

                    acknowledged = await connection_manager.acknowledge_message(
                        project_id, user.id, sequence
                    )

                    if acknowledged:
                        logger.debug(
                            "collaboration_ws_ack_received",
                            project_id=project_id,
                            user_id=str(user.id),
                            sequence=sequence,
                        )

                elif message_type == "resend":
                    # Request message resend
                    from_sequence = message.data.get("from_sequence")

                    if not from_sequence or not isinstance(from_sequence, int):
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Missing or invalid from_sequence",
                            }
                        )
                        continue

                    resent_count = await connection_manager.resend_messages(
                        project_id, user.id, from_sequence
                    )

                    logger.info(
                        "collaboration_ws_resend_requested",
                        project_id=project_id,
                        user_id=str(user.id),
                        from_sequence=from_sequence,
                        resent_count=resent_count,
                    )

                    # Send resend completion notification
                    await websocket.send_json(
                        {
                            "type": "resend_complete",
                            "from_sequence": from_sequence,
                            "count": resent_count,
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "sync_state":
                    # Get current connection state
                    state = await connection_manager.get_connection_state(
                        project_id, user.id
                    )

                    if state:
                        await websocket.send_json(
                            {
                                "type": "sync_state_response",
                                "state": state,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            }
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Connection state not found",
                            }
                        )

                elif message_type == "cursor_move":
                    # Update cursor position
                    cursor_data = message.data
                    await connection_manager.update_cursor(
                        project_id, user.id, cursor_data
                    )

                    # Broadcast cursor movement
                    await connection_manager.broadcast(
                        project_id,
                        {
                            "type": "cursor_move",
                            "user_id": str(user.id),
                            "username": user.username,
                            "cursor": cursor_data,
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        },
                        exclude_user_id=user.id,
                    )

                elif message_type == "lock_acquire":
                    # Acquire resource lock
                    resource_type_str = message.data.get("resource_type")
                    resource_id = message.data.get("resource_id")

                    if not resource_type_str or not resource_id:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Missing resource_type or resource_id",
                            }
                        )
                        continue

                    try:
                        resource_type = ResourceType(resource_type_str)
                    except ValueError:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"Invalid resource_type: {resource_type_str}",
                            }
                        )
                        continue

                    lock = await acquire_resource_lock(
                        db, project_id, user.id, resource_type, resource_id
                    )

                    if lock:
                        # Lock acquired
                        await connection_manager.add_lock(
                            project_id, user.id, resource_id
                        )

                        # Notify user
                        await websocket.send_json(
                            {
                                "type": "lock_acquired",
                                "resource_type": resource_type.value,
                                "resource_id": resource_id,
                                "expires_at": lock.expires_at.isoformat() + "Z",
                            }
                        )

                        # Broadcast to others
                        await connection_manager.broadcast(
                            project_id,
                            {
                                "type": "lock_acquired",
                                "resource_type": resource_type.value,
                                "resource_id": resource_id,
                                "user_id": str(user.id),
                                "username": user.username,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                            exclude_user_id=user.id,
                        )
                    else:
                        # Lock denied (already locked)
                        await websocket.send_json(
                            {
                                "type": "lock_denied",
                                "resource_type": resource_type.value,
                                "resource_id": resource_id,
                                "message": "Resource is locked by another user",
                            }
                        )

                elif message_type == "lock_release":
                    # Release resource lock
                    resource_id = message.data.get("resource_id")

                    if not resource_id:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Missing resource_id",
                            }
                        )
                        continue

                    released = await release_resource_lock(
                        db, project_id, user.id, resource_id
                    )

                    if released:
                        await connection_manager.remove_lock(
                            project_id, user.id, resource_id
                        )

                        # Notify user
                        await websocket.send_json(
                            {
                                "type": "lock_released",
                                "resource_id": resource_id,
                            }
                        )

                        # Broadcast to others
                        await connection_manager.broadcast(
                            project_id,
                            {
                                "type": "lock_released",
                                "resource_id": resource_id,
                                "user_id": str(user.id),
                                "username": user.username,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                            exclude_user_id=user.id,
                        )

                elif message_type == "resource_update":
                    # Broadcast resource update
                    resource_type_str = message.data.get("resource_type")
                    resource_id = message.data.get("resource_id")
                    action = message.data.get("action", "modified")
                    changes = message.data.get("changes")

                    if not resource_type_str or not resource_id:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Missing resource_type or resource_id",
                            }
                        )
                        continue

                    try:
                        resource_type = ResourceType(resource_type_str)
                        action_type = ActionType(action)
                    except ValueError as e:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"Invalid type: {str(e)}",
                            }
                        )
                        continue

                    # Log activity
                    await log_activity(
                        db,
                        project_id,
                        user.id,
                        action_type,
                        resource_type,
                        resource_id,
                        message.data.get("resource_name"),
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
                            "user_id": str(user.id),
                            "username": user.username,
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        },
                        exclude_user_id=user.id,
                    )

                elif message_type == "comment_add":
                    # Add comment
                    content = message.data.get("content")

                    if not content:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Missing content",
                            }
                        )
                        continue

                    comment = ProjectComment(
                        project_id=int(project_id),
                        workflow_id=message.data.get("workflow_id"),
                        action_id=message.data.get("action_id"),
                        author_id=user.id,
                        content=content,
                        position=message.data.get("position"),
                        mentions=message.data.get("mentions"),
                    )
                    db.add(comment)
                    await db.commit()
                    await db.refresh(comment)

                    # Broadcast comment to all
                    await connection_manager.broadcast(
                        project_id,
                        {
                            "type": "comment_added",
                            "comment_id": str(comment.id),
                            "workflow_id": comment.workflow_id,
                            "action_id": comment.action_id,
                            "author_id": str(user.id),
                            "author_username": user.username,
                            "author_avatar": user.avatar_url,
                            "content": content,
                            "position": comment.position,
                            "mentions": comment.mentions,
                            "created_at": comment.created_at.isoformat() + "Z",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        },
                    )

                    # Send acknowledgment to sender
                    await websocket.send_json(
                        {
                            "type": "comment_added_ack",
                            "comment_id": str(comment.id),
                        }
                    )

                elif message_type == "activity":
                    # Log and broadcast activity
                    action_type_str = message.data.get("action_type")
                    resource_type_str = message.data.get("resource_type")
                    resource_id = message.data.get("resource_id")

                    if not all([action_type_str, resource_type_str, resource_id]):
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Missing required fields for activity",
                            }
                        )
                        continue

                    try:
                        action_type = ActionType(action_type_str)
                        resource_type = ResourceType(resource_type_str)
                    except ValueError as e:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"Invalid type: {str(e)}",
                            }
                        )
                        continue

                    # Log activity
                    await log_activity(
                        db,
                        project_id,
                        user.id,
                        action_type,
                        resource_type,
                        resource_id,
                        message.data.get("resource_name"),
                        message.data.get("changes"),
                    )

                    # Broadcast activity
                    await connection_manager.broadcast(
                        project_id,
                        {
                            "type": "activity",
                            "action_type": action_type.value,
                            "resource_type": resource_type.value,
                            "resource_id": resource_id,
                            "resource_name": message.data.get("resource_name"),
                            "user_id": str(user.id),
                            "username": user.username,
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        },
                        exclude_user_id=user.id,
                    )

                else:
                    # Unknown message type
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown message type: {message_type}",
                        }
                    )

            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                try:
                    await websocket.send_json(
                        {
                            "type": "ping",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                except Exception:
                    break

            except WebSocketDisconnect:
                logger.info(
                    "collaboration_ws_client_disconnected",
                    project_id=project_id,
                    user_id=str(user.id),
                )
                break

            except Exception as e:
                logger.error(
                    "collaboration_ws_message_error",
                    project_id=project_id,
                    user_id=str(user.id),
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Message processing error: {str(e)}",
                        }
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "collaboration_ws_fatal_error",
            project_id=project_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Cleanup on disconnect
        if connection:
            # Release all locks
            if db:
                try:
                    await release_user_locks(db, project_id, user.id)
                except Exception as e:
                    logger.error(
                        "collaboration_ws_lock_cleanup_error",
                        project_id=project_id,
                        user_id=str(user.id),
                        error=str(e),
                    )

            # Remove connection from manager
            await connection_manager.disconnect(project_id, websocket)

        # Close database session
        if db:
            try:
                await db.close()
            except Exception:
                pass

        # Close websocket
        try:
            await websocket.close()
        except Exception:
            pass

        logger.info(
            "collaboration_ws_cleanup_complete",
            project_id=project_id,
        )
