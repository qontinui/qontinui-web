"""
Collaboration API endpoints for real-time project collaboration.

Provides endpoints for:
- Project sharing and access control
- Resource locking for concurrent editing
- Comments and discussions
- Activity feeds and tracking
"""

from typing import Any, cast
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.collaboration import ActionType, ResourceType
from app.models.project import Project
from app.models.user import User
from app.repositories.collaboration.access_repository import access_repository
from app.repositories.collaboration.lock_repository import lock_repository
from app.schemas.collaboration import (
    ActivityLogResponse,
    CollaboratorResponse,
    CommentCreate,
    CommentResolveRequest,
    CommentResponse,
    CommentUpdate,
    LockExtendRequest,
    LockRequest,
    LockResponse,
    ProjectShareRequest,
    ProjectShareUpdate,
)
from app.services.collaboration import (
    activity_service,
    comment_service,
    locking_service,
    sharing_service,
)
from app.services.notification_service import notification_service

logger = structlog.get_logger(__name__)

router = APIRouter()


async def get_project_or_404(db: AsyncSession, project_id: UUID) -> Project:
    """Get project or raise 404."""
    result = await db.execute(select(Project).filter(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project


async def verify_project_permission(
    db: AsyncSession, project_id: UUID, user: User, required_permission: str
) -> None:
    """Verify user has required project permission."""
    has_access = await sharing_service.check_user_has_access(
        db, user.id, project_id, required_permission
    )

    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient permissions. Required: {required_permission}",
        )


# ============================================================================
# Project Sharing
# ============================================================================


@router.post(
    "/{project_id}/share",
    response_model=CollaboratorResponse,
    status_code=status.HTTP_201_CREATED,
)
async def share_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    share_request: ProjectShareRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Share project with user or organization."""
    logger.info("share_project_request", project_id=project_id, user_id=current_user.id)

    # Verify project exists and user has admin permission
    project = await get_project_or_404(db, project_id)
    await verify_project_permission(db, project_id, current_user, "admin")

    # Validate: must specify either user_id or organization_id
    if not share_request.user_id and not share_request.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must specify either user_id or organization_id",
        )

    if share_request.user_id and share_request.organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot specify both user_id and organization_id",
        )

    # Share the project
    response = await sharing_service.share_project(
        db,
        project_id=project_id,
        created_by=current_user.id,
        permission_level=share_request.permission_level,
        user_id=share_request.user_id,
        organization_id=share_request.organization_id,
        expires_at=share_request.expires_at,
    )

    if not response:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Access already granted",
        )

    # Track activity
    target = (
        f"user:{share_request.user_id}"
        if share_request.user_id
        else f"org:{share_request.organization_id}"
    )
    await activity_service.track_activity(
        db,
        project_id,
        current_user.id,
        ActionType.SHARED.value,
        ResourceType.PROJECT.value,
        str(project_id),
        cast(str, project.name),
        metadata={"shared_with": target, "permission": share_request.permission_level},
    )

    # Send notifications if sharing with user
    if share_request.user_id:
        shared_user = await access_repository.get_user(db, share_request.user_id)
        if shared_user:
            await sharing_service.send_project_share_email(
                to_email=cast(str, shared_user.email),
                to_name=cast(str, shared_user.username),
                project_name=cast(str, project.name),
                shared_by_name=current_user.username,
                permission_level=share_request.permission_level,
            )
            try:
                await notification_service.send_share_notification(
                    db=db,
                    shared_with_user_id=share_request.user_id,
                    actor_id=current_user.id,
                    actor_username=current_user.username,
                    project_id=project_id,  # type: ignore[arg-type]
                    project_name=cast(str, project.name),
                    permission_level=share_request.permission_level,
                )
            except Exception as e:
                logger.error("share_notification_failed", error=str(e))

    logger.info("project_shared", project_id=project_id)
    return response


@router.get("/{project_id}/collaborators", response_model=list[CollaboratorResponse])
async def list_project_collaborators(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List project collaborators."""
    await get_project_or_404(db, project_id)
    await verify_project_permission(db, project_id, current_user, "view")

    return await sharing_service.get_project_collaborators(db, project_id, skip, limit)


@router.put(
    "/{project_id}/collaborators/{collaborator_id}", response_model=CollaboratorResponse
)
async def update_collaborator_permissions(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    collaborator_id: UUID,
    update: ProjectShareUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update collaborator permissions."""
    await verify_project_permission(db, project_id, current_user, "admin")

    response = await sharing_service.update_collaborator(
        db, collaborator_id, project_id, update.model_dump(exclude_unset=True)
    )

    if not response:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collaborator not found",
        )

    return response


@router.delete(
    "/{project_id}/collaborators/{collaborator_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_collaborator_access(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    collaborator_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Revoke collaborator access."""
    await verify_project_permission(db, project_id, current_user, "admin")

    success = await sharing_service.revoke_access(db, collaborator_id, project_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collaborator not found",
        )


# ============================================================================
# Resource Locking
# ============================================================================


@router.post(
    "/{project_id}/locks",
    response_model=LockResponse,
    status_code=status.HTTP_201_CREATED,
)
async def acquire_lock(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    lock_request: LockRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Acquire a lock on a project resource."""
    logger.info(
        "acquire_lock_request",
        project_id=project_id,
        user_id=current_user.id,
        resource_type=lock_request.resource_type,
        resource_id=lock_request.resource_id,
    )

    await verify_project_permission(db, project_id, current_user, "edit")

    lock_info = await locking_service.acquire_lock(
        db,
        current_user.id,
        project_id,
        lock_request.resource_type,
        lock_request.resource_id,
        lock_request.duration_minutes or 5,
        lock_request.metadata,
    )

    if not lock_info:
        existing_lock = await locking_service.get_resource_lock(
            db, project_id, lock_request.resource_type, lock_request.resource_id
        )

        if existing_lock:
            lock_holder = await access_repository.get_user(
                db,
                existing_lock.user_id,  # type: ignore
            )

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Resource is locked by another user",
                    "locked_by": lock_holder.username if lock_holder else "Unknown",
                    "expires_at": existing_lock.expires_at.isoformat(),
                },
            )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to acquire lock",
        )

    # Track activity
    await activity_service.track_activity(
        db,
        project_id,
        current_user.id,
        ActionType.LOCKED.value,
        lock_request.resource_type,
        lock_request.resource_id,
    )

    # Get the lock model for response
    lock = await locking_service.get_resource_lock(
        db, project_id, lock_request.resource_type, lock_request.resource_id
    )

    logger.info(
        "lock_acquired", lock_id=lock.id if lock else None, project_id=project_id
    )

    response = LockResponse.model_validate(lock)
    response.is_expired = lock.is_expired() if lock else False
    response.username = current_user.username
    response.email = current_user.email

    return response


@router.delete("/{project_id}/locks/{lock_id}", status_code=status.HTTP_204_NO_CONTENT)
async def release_lock(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    lock_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Release a lock."""
    logger.info(
        "release_lock_request",
        project_id=project_id,
        lock_id=lock_id,
        user_id=current_user.id,
    )

    success = await locking_service.release_lock(db, lock_id, current_user.id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lock not found or you don't have permission to release it",
        )

    logger.info("lock_released", lock_id=lock_id)


@router.post("/{project_id}/locks/{lock_id}/extend", response_model=LockResponse)
async def extend_lock(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    lock_id: UUID,
    extend_request: LockExtendRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Extend lock duration."""
    lock = await lock_repository.get_lock_by_user(db, lock_id, current_user.id)

    if not lock or lock.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lock not found or you don't have permission",
        )

    if lock.is_expired():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot extend expired lock. Please acquire a new lock.",
        )

    lock.extend_lock(extend_request.duration_minutes)
    await db.commit()
    await db.refresh(lock)

    logger.info(
        "lock_extended", lock_id=lock_id, duration=extend_request.duration_minutes
    )

    response = LockResponse.model_validate(lock)
    response.is_expired = lock.is_expired()
    response.username = current_user.username
    response.email = current_user.email

    return response


@router.get("/{project_id}/locks", response_model=list[LockResponse])
async def get_project_locks(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    resource_type: str | None = Query(None),
    resource_id: str | None = Query(None),
) -> Any:
    """Get all active locks for a project."""
    await verify_project_permission(db, project_id, current_user, "view")

    locks = await locking_service.get_project_locks(
        db, project_id, resource_type, resource_id
    )

    responses = []
    for lock in locks:
        response = LockResponse.model_validate(lock)
        response.is_expired = False
        if lock.user:
            response.username = cast(str, lock.user.username)
            response.email = cast(str, lock.user.email)
        responses.append(response)

    return responses


# ============================================================================
# Comments
# ============================================================================


@router.post(
    "/{project_id}/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    comment_in: CommentCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a comment on a project resource."""
    logger.info(
        "create_comment_request", project_id=project_id, user_id=current_user.id
    )

    await verify_project_permission(db, project_id, current_user, "comment")

    comment, response = await comment_service.create_comment(
        db, project_id, current_user.id, comment_in
    )

    # Add author info to response
    response.author_username = current_user.username
    response.author_email = current_user.email
    response.author_avatar_url = current_user.avatar_url

    # Track activity
    await activity_service.track_activity(
        db,
        project_id,
        current_user.id,
        ActionType.COMMENTED.value,
        ResourceType.PROJECT.value,
        str(project_id),
        metadata={"comment_id": str(comment.id)},
    )

    # Get project for notifications
    project = await get_project_or_404(db, project_id)

    # Send mention notifications
    if comment_in.mentions:
        for mentioned_user_id in comment_in.mentions:
            try:
                await notification_service.send_mention_notification(
                    db=db,
                    mentioned_user_id=mentioned_user_id,
                    actor_id=current_user.id,
                    actor_username=current_user.username,
                    project_id=project_id,  # type: ignore[arg-type]
                    project_name=cast(str, project.name),
                    comment_id=cast(UUID, comment.id),
                    comment_content=comment.content,
                )
            except Exception as e:
                logger.error("mention_notification_failed", error=str(e))

    # Send reply or comment notification
    if comment_in.parent_comment_id:
        parent_comment = await comment_service.get_parent_comment(
            db, comment_in.parent_comment_id
        )
        if parent_comment and parent_comment.author_id != current_user.id:
            try:
                await notification_service.send_reply_notification(
                    db=db,
                    notify_user_id=cast(UUID, parent_comment.author_id),
                    actor_id=current_user.id,
                    actor_username=current_user.username,
                    project_id=project_id,  # type: ignore[arg-type]
                    project_name=cast(str, project.name),
                    comment_id=cast(UUID, comment.id),
                    parent_comment_id=cast(UUID, parent_comment.id),
                    reply_content=comment.content,
                )
            except Exception as e:
                logger.error("reply_notification_failed", error=str(e))
    else:
        if project.owner_id != current_user.id:
            try:
                await notification_service.send_comment_notification(
                    db=db,
                    notify_user_id=cast(UUID, project.owner_id),
                    actor_id=current_user.id,
                    actor_username=current_user.username,
                    project_id=project_id,  # type: ignore[arg-type]
                    project_name=cast(str, project.name),
                    comment_id=cast(UUID, comment.id),
                    comment_content=comment.content,
                )
            except Exception as e:
                logger.error("comment_notification_failed", error=str(e))

    logger.info("comment_created", comment_id=comment.id, project_id=project_id)
    return response


@router.get("/{project_id}/comments", response_model=list[CommentResponse])
async def list_comments(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    workflow_id: str | None = Query(None),
    action_id: str | None = Query(None),
    parent_comment_id: UUID | None = Query(None),
    resolved: bool | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List comments for a project."""
    await verify_project_permission(db, project_id, current_user, "view")

    return await comment_service.get_project_comments(
        db,
        project_id,
        workflow_id=workflow_id,
        action_id=action_id,
        parent_comment_id=parent_comment_id,
        resolved=resolved,
        offset=skip,
        limit=limit,
    )


@router.put("/{project_id}/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    comment_id: UUID,
    comment_update: CommentUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a comment (author only)."""
    comment = await comment_service.get_comment(db, comment_id, project_id)

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    if comment.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own comments",
        )

    return await comment_service.update_comment(
        db,
        comment,
        comment_update,
        author_username=current_user.username,
        author_email=current_user.email,
        author_avatar_url=current_user.avatar_url,
    )


@router.delete(
    "/{project_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    comment_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete a comment (author or admin only)."""
    comment = await comment_service.get_comment(db, comment_id, project_id)

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    is_author = comment.author_id == current_user.id
    has_admin = await sharing_service.check_user_has_access(
        db, current_user.id, project_id, "admin"
    )

    if not is_author and not has_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own comments",
        )

    await comment_service.delete_comment(db, comment)


@router.post(
    "/{project_id}/comments/{comment_id}/resolve", response_model=CommentResponse
)
async def resolve_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    comment_id: UUID,
    resolve_request: CommentResolveRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Resolve or unresolve a comment."""
    await verify_project_permission(db, project_id, current_user, "edit")

    comment = await comment_service.get_comment_with_author(db, comment_id, project_id)

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    return await comment_service.resolve_comment(
        db, comment, resolve_request.resolved, current_user.id
    )


# ============================================================================
# Activity Feed
# ============================================================================


@router.get("/{project_id}/activity", response_model=list[ActivityLogResponse])
async def get_project_activity(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    action_type: str | None = Query(None),
    resource_type: str | None = Query(None),
    user_id: UUID | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> Any:
    """Get project activity feed."""
    await verify_project_permission(db, project_id, current_user, "view")

    return await activity_service.get_project_activities(
        db,
        project_id,
        action_type=action_type,
        resource_type=resource_type,
        user_id=user_id,
        offset=skip,
        limit=limit,
    )
