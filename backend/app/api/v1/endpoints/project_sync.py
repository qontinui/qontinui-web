"""
WebSocket endpoint for project sync events.

Provides real-time sync coordination between frontend clients and backend operations.
Broadcasts lock acquisition/release events and version updates.
"""

from datetime import datetime, timedelta
from typing import cast
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_async_db,
    get_current_active_user_async,
    get_current_user_from_ws,
)
from app.crud.project import get_project
from app.models.organization import PermissionLevel
from app.models.sync_lock import SyncLock
from app.models.user import User
from app.schemas.sync_lock import (
    ActiveLockInfo,
    SyncLockReleaseRequest,
    SyncLockRequest,
    SyncLockResponse,
)
from app.services.permission_service import permission_service
from app.services.sync_broadcast import sync_broadcast

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.websocket("/ws/projects/{project_id}/sync")
async def websocket_sync_endpoint(
    websocket: WebSocket,
    project_id: str,
    token: str | None = None,
):
    """
    WebSocket endpoint for project sync events.

    Clients connect to receive real-time notifications about:
    - Lock acquisition (another client started a backend operation)
    - Lock release (backend operation completed, reload needed)
    - Version updates (project was saved by another client)

    Connection URL:
        ws://localhost:8000/api/v1/ws/projects/{project_id}/sync?token=<token>

    Events sent to clients:
        - LOCK_ACQUIRED: Backend operation started, pause local saves
        - LOCK_RELEASED: Backend operation completed, reload to get new state
        - VERSION_UPDATED: Project version changed, may need to reload
    """
    await websocket.accept()

    logger.info(
        "ws_sync_connection_attempt",
        project_id=project_id,
        client_ip=websocket.client.host if websocket.client else "unknown",
    )

    user = None
    db = None

    try:
        # Authenticate user
        auth_token: str | None = token
        if not auth_token:
            auth_token = websocket.cookies.get("access_token")

        if not auth_token:
            await websocket.send_json(
                {
                    "type": "ERROR",
                    "message": "Authentication required",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error("ws_sync_auth_failed", project_id=project_id, error=str(e))
            await websocket.send_json(
                {
                    "type": "ERROR",
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
            await websocket.send_json(
                {
                    "type": "ERROR",
                    "message": "Database connection failed",
                }
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        # Validate project ID
        try:
            project_uuid = UUID(project_id)
        except ValueError:
            await websocket.send_json(
                {
                    "type": "ERROR",
                    "message": "Invalid project ID format",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Check project access
        project = await get_project(db, project_uuid)
        if not project:
            await websocket.send_json(
                {
                    "type": "ERROR",
                    "message": "Project not found",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        has_access = await permission_service.can_user_access_project(
            db, user.id, project_uuid, PermissionLevel.VIEW
        )
        if not has_access:
            await websocket.send_json(
                {
                    "type": "ERROR",
                    "message": "Access denied",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        logger.info(
            "ws_sync_connected",
            user_id=str(user.id),
            project_id=project_id,
        )

        # Register connection
        await sync_broadcast.connect(project_id, websocket)

        # Send initial connection acknowledgment with current version
        await websocket.send_json(
            {
                "type": "CONNECTED",
                "projectId": project_id,
                "version": project.version,
                "timestamp": utc_now().isoformat() + "Z",
            }
        )

        # Check for active locks
        lock_query = select(SyncLock).where(
            SyncLock.project_id == project_uuid,
            SyncLock.released_at.is_(None),
            SyncLock.expires_at > datetime.utcnow(),
        )
        lock_result = await db.execute(lock_query)
        active_lock = lock_result.scalar_one_or_none()

        if active_lock:
            await websocket.send_json(
                {
                    "type": "LOCK_ACQUIRED",
                    "lockId": str(active_lock.id),
                    "operation": active_lock.operation,
                    "userId": str(active_lock.user_id),
                }
            )

        # Keep connection alive
        while True:
            try:
                data = await websocket.receive_json()
                message_type = data.get("type")

                if message_type == "PONG":
                    # Heartbeat response, ignore
                    pass
                else:
                    logger.debug(
                        "ws_sync_message_received",
                        project_id=project_id,
                        message_type=message_type,
                    )

            except WebSocketDisconnect:
                logger.info(
                    "ws_sync_disconnected",
                    project_id=project_id,
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "ws_sync_error",
                    project_id=project_id,
                    error=str(e),
                )
                break

    except Exception as e:
        logger.error(
            "ws_sync_fatal_error",
            project_id=project_id,
            error=str(e),
        )

    finally:
        # Cleanup
        await sync_broadcast.disconnect(project_id, websocket)
        if db:
            try:
                await db.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.post(
    "/projects/{project_id}/sync-lock",
    response_model=SyncLockResponse,
    status_code=status.HTTP_201_CREATED,
)
async def acquire_sync_lock(
    project_id: UUID,
    lock_request: SyncLockRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Acquire a sync lock for a backend operation.

    This should be called before any backend operation that modifies
    project data (e.g., import states). All connected clients will
    be notified to pause their local saves.

    The lock automatically expires after TTL seconds if not explicitly released.
    """
    # Check project exists and user has access
    project = await get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    # Check for existing active lock
    existing_lock_query = select(SyncLock).where(
        SyncLock.project_id == project_id,
        SyncLock.released_at.is_(None),
        SyncLock.expires_at > datetime.utcnow(),
    )
    existing_result = await db.execute(existing_lock_query)
    existing_lock = existing_result.scalar_one_or_none()

    if existing_lock:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Project is already locked",
                "lock_id": str(existing_lock.id),
                "operation": existing_lock.operation,
                "user_id": str(existing_lock.user_id),
                "expires_at": existing_lock.expires_at.isoformat(),
            },
        )

    # Create new lock
    now = datetime.utcnow()
    lock = SyncLock(
        project_id=project_id,
        user_id=current_user.id,
        operation=lock_request.operation,
        acquired_at=now,
        expires_at=now + timedelta(seconds=lock_request.ttl_seconds),
    )
    db.add(lock)
    await db.commit()
    await db.refresh(lock)

    logger.info(
        "sync_lock_acquired",
        project_id=str(project_id),
        lock_id=str(lock.id),
        operation=lock_request.operation,
        user_id=str(current_user.id),
        ttl_seconds=lock_request.ttl_seconds,
    )

    # Broadcast to connected clients
    await sync_broadcast.broadcast_lock_acquired(
        project_id=project_id,
        lock_id=str(lock.id),
        operation=lock_request.operation,
        user_id=str(current_user.id),
    )

    return SyncLockResponse(
        lock_id=str(lock.id),
        operation=cast(str, lock.operation),
        user_id=str(lock.user_id),
        project_id=str(lock.project_id),
        acquired_at=cast(datetime, lock.acquired_at),
        expires_at=cast(datetime, lock.expires_at),
        new_version=None,
    )


@router.post(
    "/projects/{project_id}/sync-lock/{lock_id}/release",
    response_model=SyncLockResponse,
)
async def release_sync_lock(
    project_id: UUID,
    lock_id: UUID,
    release_request: SyncLockReleaseRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Release a sync lock after operation completes.

    All connected clients will be notified that the lock is released
    and should reload to get the new project state.
    """
    # Get the lock
    lock_query = select(SyncLock).where(SyncLock.id == lock_id)
    lock_result = await db.execute(lock_query)
    lock = lock_result.scalar_one_or_none()

    if not lock:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lock not found",
        )

    if lock.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lock does not belong to this project",
        )

    # Only the lock owner or a superuser can release
    if lock.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the lock owner can release the lock",
        )

    # Mark lock as released
    lock.released_at = datetime.utcnow()  # type: ignore[assignment]
    if not release_request.success:
        lock.error_message = release_request.error_message  # type: ignore[assignment]

    await db.commit()
    await db.refresh(lock)

    # Get current project version
    project = await get_project(db, project_id)
    new_version: int = cast(int, project.version) if project else 0

    logger.info(
        "sync_lock_released",
        project_id=str(project_id),
        lock_id=str(lock_id),
        user_id=str(current_user.id),
        success=release_request.success,
        new_version=new_version,
    )

    # Broadcast to connected clients
    await sync_broadcast.broadcast_lock_released(
        project_id=project_id,
        lock_id=str(lock_id),
        new_version=new_version,
    )

    return SyncLockResponse(
        lock_id=str(lock.id),
        operation=cast(str, lock.operation),
        user_id=str(lock.user_id),
        project_id=str(lock.project_id),
        acquired_at=cast(datetime, lock.acquired_at),
        expires_at=cast(datetime, lock.expires_at),
        new_version=new_version,
    )


@router.get(
    "/projects/{project_id}/sync-lock",
    response_model=ActiveLockInfo | None,
)
async def get_active_lock(
    project_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """Get the active sync lock for a project, if any."""
    # Check project access
    project = await get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    # Get active lock
    lock_query = select(SyncLock).where(
        SyncLock.project_id == project_id,
        SyncLock.released_at.is_(None),
        SyncLock.expires_at > datetime.utcnow(),
    )
    lock_result = await db.execute(lock_query)
    lock = lock_result.scalar_one_or_none()

    if not lock:
        return None

    # Get user email for display
    from app.crud.user import get_user

    lock_user = await get_user(db, cast(UUID, lock.user_id))

    return ActiveLockInfo(
        lock_id=str(lock.id),
        operation=cast(str, lock.operation),
        user_id=str(lock.user_id),
        user_email=lock_user.email if lock_user else None,
        acquired_at=cast(datetime, lock.acquired_at),
        expires_at=cast(datetime, lock.expires_at),
    )
