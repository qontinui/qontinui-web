"""
CRUD operations for collaboration models.

Provides database operations for locks, comments, and activity logs.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession


# ProjectLock CRUD
async def get_active_locks(
    db: AsyncSession,
    project_id: UUID,
    resource_id: str | None = None,
) -> list[ProjectLock]:
    """
    Get all active (non-expired) locks for a project.

    Args:
        db: Database session
        project_id: ID of the project
        resource_id: Optional resource ID to filter by

    Returns:
        List of active ProjectLock objects
    """
    query = select(ProjectLock).where(
        and_(
            ProjectLock.project_id == project_id,
            ProjectLock.expires_at > datetime.now(UTC),
        )
    )

    if resource_id:
        query = query.where(ProjectLock.resource_id == resource_id)

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_user_locks(
    db: AsyncSession,
    user_id: UUID,
    project_id: int | None = None,
) -> list[ProjectLock]:
    """
    Get all locks for a specific user.

    Args:
        db: Database session
        user_id: ID of the user
        project_id: Optional project ID to filter by

    Returns:
        List of ProjectLock objects
    """
    query = select(ProjectLock).where(
        and_(
            ProjectLock.user_id == user_id,
            ProjectLock.expires_at > datetime.now(UTC),
        )
    )

    if project_id:
        query = query.where(ProjectLock.project_id == project_id)

    result = await db.execute(query)
    return list(result.scalars().all())


async def cleanup_expired_locks(db: AsyncSession) -> int:
    """
    Delete all expired locks.

    Args:
        db: Database session

    Returns:
        Number of locks deleted
    """
    result = await db.execute(
        delete(ProjectLock).where(ProjectLock.expires_at <= datetime.now(UTC))
    )
    await db.commit()
    return result.rowcount or 0  # type: ignore[attr-defined]


# ProjectComment CRUD
async def get_project_comments(
    db: AsyncSession,
    project_id: UUID,
    workflow_id: str | None = None,
    action_id: str | None = None,
    include_resolved: bool = False,
    skip: int = 0,
    limit: int = 100,
) -> list[ProjectComment]:
    """
    Get comments for a project.

    Args:
        db: Database session
        project_id: ID of the project
        workflow_id: Optional workflow ID to filter by
        action_id: Optional action ID to filter by
        include_resolved: Include resolved comments
        skip: Number of comments to skip
        limit: Maximum number of comments to return

    Returns:
        List of ProjectComment objects
    """
    query = select(ProjectComment).where(ProjectComment.project_id == project_id)

    if workflow_id:
        query = query.where(ProjectComment.workflow_id == workflow_id)

    if action_id:
        query = query.where(ProjectComment.action_id == action_id)

    if not include_resolved:
        query = query.where(ProjectComment.resolved == False)  # noqa: E712

    query = query.order_by(ProjectComment.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_comment(
    db: AsyncSession,
    comment_id: UUID,
) -> ProjectComment | None:
    """
    Get a specific comment by ID.

    Args:
        db: Database session
        comment_id: ID of the comment

    Returns:
        ProjectComment object or None
    """
    result = await db.execute(
        select(ProjectComment).where(ProjectComment.id == comment_id)
    )
    return result.scalar_one_or_none()


async def create_comment(
    db: AsyncSession,
    project_id: UUID,
    author_id: UUID,
    content: str,
    workflow_id: str | None = None,
    action_id: str | None = None,
    position: dict | None = None,
    mentions: list | None = None,
    parent_comment_id: UUID | None = None,
) -> ProjectComment:
    """
    Create a new comment.

    Args:
        db: Database session
        project_id: ID of the project
        author_id: ID of the comment author
        content: Comment content
        workflow_id: Optional workflow ID
        action_id: Optional action ID
        position: Optional position data
        mentions: Optional list of mentioned user IDs
        parent_comment_id: Optional parent comment ID for threading

    Returns:
        Created ProjectComment object
    """
    comment = ProjectComment(
        project_id=project_id,
        author_id=author_id,
        content=content,
        workflow_id=workflow_id,
        action_id=action_id,
        position=position,
        mentions=mentions,
        parent_comment_id=parent_comment_id,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


async def update_comment(
    db: AsyncSession,
    comment: ProjectComment,
    content: str | None = None,
    resolved: bool | None = None,
    resolved_by: UUID | None = None,
) -> ProjectComment:
    """
    Update a comment.

    Args:
        db: Database session
        comment: Comment to update
        content: New content
        resolved: Resolved status
        resolved_by: ID of user resolving the comment

    Returns:
        Updated ProjectComment object
    """
    if content is not None:
        comment.content = content

    if resolved is not None:
        if resolved:
            if resolved_by is None:
                raise ValueError(
                    "resolved_by must be provided when resolving a comment"
                )
            comment.resolve(resolved_by)
        else:
            comment.unresolve()

    comment.updated_at = datetime.now(UTC)
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


async def delete_comment(
    db: AsyncSession,
    comment_id: UUID,
) -> bool:
    """
    Delete a comment.

    Args:
        db: Database session
        comment_id: ID of the comment

    Returns:
        True if comment was deleted
    """
    result = await db.execute(
        delete(ProjectComment).where(ProjectComment.id == comment_id)
    )
    await db.commit()
    return (result.rowcount or 0) > 0  # type: ignore[attr-defined]


async def get_comment_count(
    db: AsyncSession,
    project_id: UUID,
    workflow_id: str | None = None,
    include_resolved: bool = False,
) -> int:
    """
    Get count of comments for a project or workflow.

    Args:
        db: Database session
        project_id: ID of the project
        workflow_id: Optional workflow ID to filter by
        include_resolved: Include resolved comments

    Returns:
        Count of comments
    """
    query = select(func.count(ProjectComment.id)).where(
        ProjectComment.project_id == project_id
    )

    if workflow_id:
        query = query.where(ProjectComment.workflow_id == workflow_id)

    if not include_resolved:
        query = query.where(ProjectComment.resolved == False)  # noqa: E712

    result = await db.execute(query)
    return result.scalar() or 0


# ActivityLog CRUD
async def get_project_activities(
    db: AsyncSession,
    project_id: UUID,
    action_type: ActionType | None = None,
    resource_type: ResourceType | None = None,
    resource_id: str | None = None,
    user_id: UUID | None = None,
    since: datetime | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[ActivityLog]:
    """
    Get activity logs for a project.

    Args:
        db: Database session
        project_id: ID of the project
        action_type: Optional action type to filter by
        resource_type: Optional resource type to filter by
        resource_id: Optional resource ID to filter by
        user_id: Optional user ID to filter by
        since: Optional datetime to get activities after
        skip: Number of activities to skip
        limit: Maximum number of activities to return

    Returns:
        List of ActivityLog objects
    """
    query = select(ActivityLog).where(ActivityLog.project_id == project_id)

    if action_type:
        query = query.where(ActivityLog.action_type == action_type)

    if resource_type:
        query = query.where(ActivityLog.resource_type == resource_type)

    if resource_id:
        query = query.where(ActivityLog.resource_id == resource_id)

    if user_id:
        query = query.where(ActivityLog.user_id == user_id)

    if since:
        query = query.where(ActivityLog.created_at >= since)

    query = query.order_by(ActivityLog.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


async def create_activity(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    action_type: ActionType,
    resource_type: ResourceType,
    resource_id: str,
    resource_name: str | None = None,
    changes: dict | None = None,
    metadata: dict | None = None,
) -> ActivityLog:
    """
    Create a new activity log entry.

    Args:
        db: Database session
        project_id: ID of the project
        user_id: ID of the user
        action_type: Type of action
        resource_type: Type of resource
        resource_id: ID of the resource
        resource_name: Name of the resource
        changes: Changes made
        metadata: Additional metadata

    Returns:
        Created ActivityLog object
    """
    activity = ActivityLog.create_activity(
        project_id=project_id,
        user_id=user_id,
        action_type=action_type,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_name=resource_name,
        changes=changes,
        activity_metadata=metadata,
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


async def get_recent_activity_count(
    db: AsyncSession,
    project_id: UUID,
    minutes: int = 60,
) -> int:
    """
    Get count of activities in the last N minutes.

    Args:
        db: Database session
        project_id: ID of the project
        minutes: Number of minutes to look back

    Returns:
        Count of recent activities
    """
    since = datetime.now(UTC) - timedelta(minutes=minutes)
    result = await db.execute(
        select(func.count(ActivityLog.id)).where(
            and_(
                ActivityLog.project_id == project_id,
                ActivityLog.created_at >= since,
            )
        )
    )
    return result.scalar() or 0


async def cleanup_old_activities(
    db: AsyncSession,
    days: int = 90,
) -> int:
    """
    Delete activity logs older than N days.

    Args:
        db: Database session
        days: Number of days to keep

    Returns:
        Number of activities deleted
    """
    from datetime import timedelta

    cutoff_date = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(
        delete(ActivityLog).where(ActivityLog.created_at < cutoff_date)
    )
    await db.commit()
    return result.rowcount or 0  # type: ignore[attr-defined]
