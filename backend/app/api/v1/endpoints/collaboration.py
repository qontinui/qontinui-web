"""
Collaboration API endpoints for real-time project collaboration.

Provides endpoints for:
- Project sharing and access control
- Resource locking for concurrent editing
- Comments and discussions
- Activity feeds and tracking
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from app.models.organization import ProjectAccessControl
from app.models.project import Project
from app.models.user import User
from app.schemas.collaboration import (
    ActivityFilterParams,
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
from app.services.collaboration_service import collaboration_service
from app.utils.authorization import verify_project_access

logger = structlog.get_logger(__name__)

router = APIRouter()


async def get_project_or_404(db: AsyncSession, project_id: int) -> Project:
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
    db: AsyncSession, project_id: int, user: User, required_permission: str
) -> None:
    """Verify user has required project permission."""
    has_access = await collaboration_service.check_user_has_access(
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


@router.post("/{project_id}/share", response_model=CollaboratorResponse, status_code=status.HTTP_201_CREATED)
async def share_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
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

    # Check for existing access
    query = select(ProjectAccessControl).filter(
        ProjectAccessControl.project_id == project_id
    )

    if share_request.user_id:
        query = query.filter(ProjectAccessControl.user_id == share_request.user_id)
    else:
        query = query.filter(
            ProjectAccessControl.organization_id == share_request.organization_id
        )

    result = await db.execute(query)
    existing = result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Access already granted",
        )

    # Create access control entry
    access = ProjectAccessControl(
        project_id=project_id,
        user_id=share_request.user_id,
        organization_id=share_request.organization_id,
        permission_level=share_request.permission_level,
        created_by=current_user.id,
        expires_at=share_request.expires_at,
    )

    db.add(access)
    await db.commit()
    await db.refresh(access)

    # Track activity
    target = f"user:{share_request.user_id}" if share_request.user_id else f"org:{share_request.organization_id}"
    await collaboration_service.track_activity(
        db,
        project_id,
        current_user.id,
        ActionType.SHARED.value,
        ResourceType.PROJECT.value,
        str(project_id),
        project.name,
        metadata={"shared_with": target, "permission": share_request.permission_level},
    )

    # Send notification email if sharing with user
    if share_request.user_id:
        result = await db.execute(
            select(User).filter(User.id == share_request.user_id)
        )
        shared_user = result.scalar_one_or_none()
        if shared_user:
            await collaboration_service.send_project_share_email(
                to_email=shared_user.email,
                to_name=shared_user.username,
                project_name=project.name,
                shared_by_name=current_user.username,
                permission_level=share_request.permission_level,
            )

    logger.info("project_shared", project_id=project_id, access_id=access.id)

    # Build response
    response = CollaboratorResponse.model_validate(access)
    response.is_expired = access.is_expired

    return response


@router.get("/{project_id}/collaborators", response_model=list[CollaboratorResponse])
async def list_project_collaborators(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List project collaborators."""
    # Verify access
    project = await get_project_or_404(db, project_id)
    await verify_project_permission(db, project_id, current_user, "view")

    # Get all access entries with joined data
    result = await db.execute(
        select(ProjectAccessControl)
        .filter(ProjectAccessControl.project_id == project_id)
        .options(
            joinedload(ProjectAccessControl.user),
            joinedload(ProjectAccessControl.organization),
        )
        .offset(skip)
        .limit(limit)
        .order_by(ProjectAccessControl.created_at.desc())
    )
    accesses = result.unique().scalars().all()

    # Build responses
    responses = []
    for access in accesses:
        response = CollaboratorResponse.model_validate(access)
        response.is_expired = access.is_expired

        if access.user:
            response.username = access.user.username
            response.email = access.user.email
            response.full_name = access.user.full_name
            response.avatar_url = access.user.avatar_url
        elif access.organization:
            response.organization_name = access.organization.name

        responses.append(response)

    return responses


@router.put("/{project_id}/collaborators/{collaborator_id}", response_model=CollaboratorResponse)
async def update_collaborator_permissions(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    collaborator_id: UUID,
    update: ProjectShareUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update collaborator permissions."""
    # Verify admin access
    await verify_project_permission(db, project_id, current_user, "admin")

    # Get access entry
    result = await db.execute(
        select(ProjectAccessControl).filter(
            and_(
                ProjectAccessControl.id == collaborator_id,
                ProjectAccessControl.project_id == project_id,
            )
        )
    )
    access = result.scalar_one_or_none()

    if not access:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collaborator not found",
        )

    # Update fields
    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(access, field, value)

    await db.commit()
    await db.refresh(access)

    logger.info("collaborator_updated", project_id=project_id, collaborator_id=collaborator_id)

    response = CollaboratorResponse.model_validate(access)
    response.is_expired = access.is_expired

    return response


@router.delete("/{project_id}/collaborators/{collaborator_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_collaborator_access(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    collaborator_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Revoke collaborator access."""
    # Verify admin access
    await verify_project_permission(db, project_id, current_user, "admin")

    # Get access entry
    result = await db.execute(
        select(ProjectAccessControl).filter(
            and_(
                ProjectAccessControl.id == collaborator_id,
                ProjectAccessControl.project_id == project_id,
            )
        )
    )
    access = result.scalar_one_or_none()

    if not access:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collaborator not found",
        )

    await db.delete(access)
    await db.commit()

    logger.info("collaborator_access_revoked", project_id=project_id, collaborator_id=collaborator_id)


# ============================================================================
# Resource Locking
# ============================================================================


@router.post("/{project_id}/locks", response_model=LockResponse, status_code=status.HTTP_201_CREATED)
async def acquire_lock(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
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

    # Verify edit access
    await verify_project_permission(db, project_id, current_user, "edit")

    # Attempt to acquire lock
    lock = await collaboration_service.acquire_project_lock(
        db,
        current_user.id,
        project_id,
        lock_request.resource_type,
        lock_request.resource_id,
        lock_request.duration_minutes or 5,
        lock_request.metadata,
    )

    if not lock:
        # Get current lock holder info
        existing_lock = await collaboration_service.get_resource_lock(
            db, project_id, lock_request.resource_type, lock_request.resource_id
        )

        if existing_lock:
            result = await db.execute(
                select(User).filter(User.id == existing_lock.user_id)
            )
            lock_holder = result.scalar_one_or_none()

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Resource is locked by another user",
                    "locked_by": lock_holder.username if lock_holder else "Unknown",
                    "expires_at": existing_lock.expires_at.isoformat(),
                },
            )

    logger.info("lock_acquired", lock_id=lock.id, project_id=project_id)

    # Build response with user data
    response = LockResponse.model_validate(lock)
    response.is_expired = lock.is_expired()
    response.username = current_user.username
    response.email = current_user.email

    return response


@router.delete("/{project_id}/locks/{lock_id}", status_code=status.HTTP_204_NO_CONTENT)
async def release_lock(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    lock_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Release a lock."""
    logger.info("release_lock_request", project_id=project_id, lock_id=lock_id, user_id=current_user.id)

    success = await collaboration_service.release_project_lock(db, lock_id, current_user.id)

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
    project_id: int,
    lock_id: UUID,
    extend_request: LockExtendRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Extend lock duration."""
    # Get lock
    result = await db.execute(
        select(ProjectLock).filter(
            and_(
                ProjectLock.id == lock_id,
                ProjectLock.project_id == project_id,
                ProjectLock.user_id == current_user.id,
            )
        )
    )
    lock = result.scalar_one_or_none()

    if not lock:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lock not found or you don't have permission",
        )

    # Extend lock
    lock.extend_lock(extend_request.duration_minutes)
    await db.commit()
    await db.refresh(lock)

    logger.info("lock_extended", lock_id=lock_id, duration=extend_request.duration_minutes)

    response = LockResponse.model_validate(lock)
    response.is_expired = lock.is_expired()
    response.username = current_user.username
    response.email = current_user.email

    return response


@router.get("/{project_id}/locks", response_model=list[LockResponse])
async def get_project_locks(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
    resource_type: str | None = Query(None),
    resource_id: str | None = Query(None),
) -> Any:
    """Get all active locks for a project."""
    # Verify access
    await verify_project_permission(db, project_id, current_user, "view")

    # Build query
    query = select(ProjectLock).filter(ProjectLock.project_id == project_id).options(
        joinedload(ProjectLock.user)
    )

    if resource_type:
        query = query.filter(ProjectLock.resource_type == ResourceType(resource_type))

    if resource_id:
        query = query.filter(ProjectLock.resource_id == resource_id)

    result = await db.execute(query)
    locks = result.unique().scalars().all()

    # Filter out expired and build responses
    responses = []
    for lock in locks:
        if not lock.is_expired():
            response = LockResponse.model_validate(lock)
            response.is_expired = False
            if lock.user:
                response.username = lock.user.username
                response.email = lock.user.email
            responses.append(response)

    return responses


# ============================================================================
# Comments
# ============================================================================


@router.post("/{project_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    comment_in: CommentCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a comment on a project resource."""
    logger.info("create_comment_request", project_id=project_id, user_id=current_user.id)

    # Verify comment permission (or view, depending on requirements)
    await verify_project_permission(db, project_id, current_user, "comment")

    # Create comment
    comment = ProjectComment(
        project_id=project_id,
        workflow_id=comment_in.workflow_id,
        action_id=comment_in.action_id,
        author_id=current_user.id,
        content=comment_in.content,
        position=comment_in.position.model_dump() if comment_in.position else None,
        mentions=comment_in.mentions,
        parent_comment_id=comment_in.parent_comment_id,
    )

    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    # Track activity
    await collaboration_service.track_activity(
        db,
        project_id,
        current_user.id,
        ActionType.COMMENTED.value,
        ResourceType.PROJECT.value,
        str(project_id),
        metadata={"comment_id": str(comment.id)},
    )

    logger.info("comment_created", comment_id=comment.id, project_id=project_id)

    # Build response
    response = CommentResponse.model_validate(comment)
    response.author_username = current_user.username
    response.author_email = current_user.email
    response.author_avatar_url = current_user.avatar_url
    response.reply_count = 0

    return response


@router.get("/{project_id}/comments", response_model=list[CommentResponse])
async def list_comments(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
    workflow_id: str | None = Query(None),
    action_id: str | None = Query(None),
    parent_comment_id: UUID | None = Query(None),
    resolved: bool | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List comments for a project."""
    # Verify access
    await verify_project_permission(db, project_id, current_user, "view")

    # Build query
    query = (
        select(ProjectComment)
        .filter(ProjectComment.project_id == project_id)
        .options(joinedload(ProjectComment.author))
    )

    if workflow_id:
        query = query.filter(ProjectComment.workflow_id == workflow_id)

    if action_id:
        query = query.filter(ProjectComment.action_id == action_id)

    if parent_comment_id:
        query = query.filter(ProjectComment.parent_comment_id == parent_comment_id)
    else:
        # By default, only get top-level comments
        query = query.filter(ProjectComment.parent_comment_id.is_(None))

    if resolved is not None:
        query = query.filter(ProjectComment.resolved == resolved)

    result = await db.execute(
        query.offset(skip).limit(limit).order_by(ProjectComment.created_at.desc())
    )
    comments = result.unique().scalars().all()

    # Build responses with reply counts
    responses = []
    for comment in comments:
        response = CommentResponse.model_validate(comment)

        if comment.author:
            response.author_username = comment.author.username
            response.author_email = comment.author.email
            response.author_avatar_url = comment.author.avatar_url

        # Get reply count
        count_result = await db.execute(
            select(ProjectComment).filter(ProjectComment.parent_comment_id == comment.id)
        )
        response.reply_count = len(count_result.scalars().all())

        responses.append(response)

    return responses


@router.put("/{project_id}/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    comment_id: UUID,
    comment_update: CommentUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a comment (author only)."""
    # Get comment
    result = await db.execute(
        select(ProjectComment).filter(
            and_(
                ProjectComment.id == comment_id,
                ProjectComment.project_id == project_id,
            )
        )
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    # Verify author
    if comment.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own comments",
        )

    # Update fields
    update_data = comment_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "position" and value:
            setattr(comment, field, value.model_dump() if hasattr(value, 'model_dump') else value)
        else:
            setattr(comment, field, value)

    await db.commit()
    await db.refresh(comment)

    logger.info("comment_updated", comment_id=comment_id)

    response = CommentResponse.model_validate(comment)
    response.author_username = current_user.username
    response.author_email = current_user.email
    response.author_avatar_url = current_user.avatar_url

    return response


@router.delete("/{project_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    comment_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete a comment (author or admin only)."""
    # Get comment
    result = await db.execute(
        select(ProjectComment).filter(
            and_(
                ProjectComment.id == comment_id,
                ProjectComment.project_id == project_id,
            )
        )
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    # Verify author or admin
    is_author = comment.author_id == current_user.id
    has_admin = await collaboration_service.check_user_has_access(
        db, current_user.id, project_id, "admin"
    )

    if not is_author and not has_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own comments",
        )

    await db.delete(comment)
    await db.commit()

    logger.info("comment_deleted", comment_id=comment_id)


@router.post("/{project_id}/comments/{comment_id}/resolve", response_model=CommentResponse)
async def resolve_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    comment_id: UUID,
    resolve_request: CommentResolveRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Resolve or unresolve a comment."""
    # Verify edit access
    await verify_project_permission(db, project_id, current_user, "edit")

    # Get comment
    result = await db.execute(
        select(ProjectComment).filter(
            and_(
                ProjectComment.id == comment_id,
                ProjectComment.project_id == project_id,
            )
        ).options(joinedload(ProjectComment.author))
    )
    comment = result.unique().scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    # Update resolved status
    if resolve_request.resolved:
        comment.resolve(current_user.id)
    else:
        comment.unresolve()

    await db.commit()
    await db.refresh(comment)

    logger.info(
        "comment_resolved" if resolve_request.resolved else "comment_unresolved",
        comment_id=comment_id,
    )

    response = CommentResponse.model_validate(comment)
    if comment.author:
        response.author_username = comment.author.username
        response.author_email = comment.author.email
        response.author_avatar_url = comment.author.avatar_url

    return response


# ============================================================================
# Activity Feed
# ============================================================================


@router.get("/{project_id}/activity", response_model=list[ActivityLogResponse])
async def get_project_activity(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
    action_type: str | None = Query(None),
    resource_type: str | None = Query(None),
    user_id: UUID | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> Any:
    """Get project activity feed."""
    # Verify access
    await verify_project_permission(db, project_id, current_user, "view")

    # Build query
    query = (
        select(ActivityLog)
        .filter(ActivityLog.project_id == project_id)
        .options(joinedload(ActivityLog.user))
    )

    if action_type:
        query = query.filter(ActivityLog.action_type == ActionType(action_type))

    if resource_type:
        query = query.filter(ActivityLog.resource_type == ResourceType(resource_type))

    if user_id:
        query = query.filter(ActivityLog.user_id == user_id)

    result = await db.execute(
        query.offset(skip).limit(limit).order_by(ActivityLog.created_at.desc())
    )
    activities = result.unique().scalars().all()

    # Build responses
    responses = []
    for activity in activities:
        response = ActivityLogResponse.model_validate(activity)

        if activity.user:
            response.username = activity.user.username
            response.email = activity.user.email
            response.avatar_url = activity.user.avatar_url

        responses.append(response)

    return responses
