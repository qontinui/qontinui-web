"""
Repository for collaboration-related database operations.

Provides data access for:
- Project locks (pessimistic locking for concurrent editing)
- Activity logs (audit trail of user actions)
- Comments (project comments and discussions)
- Access control (project sharing and permissions)
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from app.models.organization import ProjectAccessControl
from app.models.user import User


class CollaborationRepository:
    """Repository for collaboration data access operations."""

    # ========================================================================
    # Lock Operations
    # ========================================================================

    async def get_lock(self, db: AsyncSession, lock_id: UUID) -> ProjectLock | None:
        """Get a lock by ID."""
        result = await db.execute(select(ProjectLock).filter(ProjectLock.id == lock_id))
        return result.scalar_one_or_none()

    async def get_lock_by_user(
        self, db: AsyncSession, lock_id: UUID, user_id: UUID
    ) -> ProjectLock | None:
        """Get a lock by ID and user ID."""
        result = await db.execute(
            select(ProjectLock).filter(
                and_(ProjectLock.id == lock_id, ProjectLock.user_id == user_id)
            )
        )
        return result.scalar_one_or_none()

    async def get_resource_lock(
        self,
        db: AsyncSession,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> ProjectLock | None:
        """Get current lock for a resource."""
        result = await db.execute(
            select(ProjectLock).filter(
                and_(
                    ProjectLock.project_id == project_id,
                    ProjectLock.resource_type == ResourceType(resource_type),
                    ProjectLock.resource_id == resource_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_resource_lock_for_update(
        self,
        db: AsyncSession,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> ProjectLock | None:
        """Get lock with SELECT FOR UPDATE (prevents race conditions)."""
        result = await db.execute(
            select(ProjectLock)
            .filter(
                and_(
                    ProjectLock.project_id == project_id,
                    ProjectLock.resource_type == ResourceType(resource_type),
                    ProjectLock.resource_id == resource_id,
                )
            )
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def get_project_locks(
        self,
        db: AsyncSession,
        project_id: UUID,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[ProjectLock]:
        """Get all locks for a project with optional filters."""
        query = (
            select(ProjectLock)
            .filter(ProjectLock.project_id == project_id)
            .options(joinedload(ProjectLock.user))
        )

        if resource_type:
            query = query.filter(
                ProjectLock.resource_type == ResourceType(resource_type)
            )

        if resource_id:
            query = query.filter(ProjectLock.resource_id == resource_id)

        result = await db.execute(query)
        return list(result.unique().scalars().all())

    async def get_expired_locks(self, db: AsyncSession) -> list[ProjectLock]:
        """Get all expired locks."""
        result = await db.execute(
            select(ProjectLock).filter(ProjectLock.expires_at < datetime.utcnow())
        )
        return list(result.scalars().all())

    async def create_lock(
        self,
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        resource_type: str,
        resource_id: str,
        expires_at: datetime,
        metadata: dict[str, Any] | None = None,
    ) -> ProjectLock:
        """Create a new lock."""
        lock = ProjectLock(
            project_id=project_id,
            user_id=user_id,
            resource_type=ResourceType(resource_type),
            resource_id=resource_id,
            expires_at=expires_at,
            metadata=metadata,
        )
        db.add(lock)
        await db.flush()
        await db.refresh(lock)
        return lock

    async def delete_lock(self, db: AsyncSession, lock: ProjectLock) -> None:
        """Delete a lock."""
        await db.delete(lock)
        await db.flush()

    # ========================================================================
    # Activity Log Operations
    # ========================================================================

    async def create_activity(
        self,
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        action_type: ActionType,
        resource_type: ResourceType,
        resource_id: str,
        resource_name: str | None = None,
        changes: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ActivityLog:
        """Create an activity log entry."""
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
        await db.flush()
        await db.refresh(activity)
        return activity

    async def get_project_activities(
        self,
        db: AsyncSession,
        project_id: UUID,
        action_type: str | None = None,
        resource_type: str | None = None,
        user_id: UUID | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[ActivityLog]:
        """Get activity logs for a project."""
        query = (
            select(ActivityLog)
            .filter(ActivityLog.project_id == project_id)
            .options(joinedload(ActivityLog.user))
        )

        if action_type:
            query = query.filter(ActivityLog.action_type == ActionType(action_type))

        if resource_type:
            query = query.filter(
                ActivityLog.resource_type == ResourceType(resource_type)
            )

        if user_id:
            query = query.filter(ActivityLog.user_id == user_id)

        result = await db.execute(
            query.offset(offset).limit(limit).order_by(ActivityLog.created_at.desc())
        )
        return list(result.unique().scalars().all())

    # ========================================================================
    # Comment Operations
    # ========================================================================

    async def get_comment(
        self, db: AsyncSession, comment_id: UUID
    ) -> ProjectComment | None:
        """Get a comment by ID."""
        result = await db.execute(
            select(ProjectComment).filter(ProjectComment.id == comment_id)
        )
        return result.scalar_one_or_none()

    async def get_comment_in_project(
        self, db: AsyncSession, comment_id: UUID, project_id: UUID
    ) -> ProjectComment | None:
        """Get a comment by ID within a specific project."""
        result = await db.execute(
            select(ProjectComment).filter(
                and_(
                    ProjectComment.id == comment_id,
                    ProjectComment.project_id == project_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_comment_with_author(
        self, db: AsyncSession, comment_id: UUID, project_id: UUID
    ) -> ProjectComment | None:
        """Get a comment with author loaded."""
        result = await db.execute(
            select(ProjectComment)
            .filter(
                and_(
                    ProjectComment.id == comment_id,
                    ProjectComment.project_id == project_id,
                )
            )
            .options(joinedload(ProjectComment.author))
        )
        return result.unique().scalar_one_or_none()

    async def get_project_comments(
        self,
        db: AsyncSession,
        project_id: UUID,
        workflow_id: str | None = None,
        action_id: str | None = None,
        parent_comment_id: UUID | None = None,
        resolved: bool | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> list[ProjectComment]:
        """Get comments for a project with filters."""
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
            # Default: only get top-level comments
            query = query.filter(ProjectComment.parent_comment_id.is_(None))

        if resolved is not None:
            query = query.filter(ProjectComment.resolved == resolved)

        result = await db.execute(
            query.offset(offset).limit(limit).order_by(ProjectComment.created_at.desc())
        )
        return list(result.unique().scalars().all())

    async def get_reply_count(self, db: AsyncSession, comment_id: UUID) -> int:
        """Get the number of replies to a comment."""
        result = await db.execute(
            select(func.count())
            .select_from(ProjectComment)
            .filter(ProjectComment.parent_comment_id == comment_id)
        )
        return result.scalar_one()

    async def create_comment(
        self,
        db: AsyncSession,
        project_id: UUID,
        author_id: UUID,
        content: str,
        workflow_id: str | None = None,
        action_id: str | None = None,
        position: dict[str, Any] | None = None,
        mentions: list[UUID] | None = None,
        parent_comment_id: UUID | None = None,
    ) -> ProjectComment:
        """Create a new comment."""
        comment = ProjectComment(
            project_id=project_id,
            workflow_id=workflow_id,
            action_id=action_id,
            author_id=author_id,
            content=content,
            position=position,
            mentions=mentions,
            parent_comment_id=parent_comment_id,
        )
        db.add(comment)
        await db.flush()
        await db.refresh(comment)
        return comment

    async def delete_comment(self, db: AsyncSession, comment: ProjectComment) -> None:
        """Delete a comment."""
        await db.delete(comment)
        await db.flush()

    # ========================================================================
    # Access Control Operations
    # ========================================================================

    async def get_access_control(
        self, db: AsyncSession, access_id: UUID
    ) -> ProjectAccessControl | None:
        """Get an access control entry by ID."""
        result = await db.execute(
            select(ProjectAccessControl).filter(ProjectAccessControl.id == access_id)
        )
        return result.scalar_one_or_none()

    async def get_access_control_in_project(
        self, db: AsyncSession, access_id: UUID, project_id: UUID
    ) -> ProjectAccessControl | None:
        """Get an access control entry within a specific project."""
        result = await db.execute(
            select(ProjectAccessControl).filter(
                and_(
                    ProjectAccessControl.id == access_id,
                    ProjectAccessControl.project_id == project_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_user_access(
        self, db: AsyncSession, project_id: UUID, user_id: UUID
    ) -> ProjectAccessControl | None:
        """Get access control for a user on a project."""
        result = await db.execute(
            select(ProjectAccessControl).filter(
                and_(
                    ProjectAccessControl.project_id == project_id,
                    ProjectAccessControl.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_organization_access(
        self, db: AsyncSession, project_id: UUID, organization_id: UUID
    ) -> ProjectAccessControl | None:
        """Get access control for an organization on a project."""
        result = await db.execute(
            select(ProjectAccessControl).filter(
                and_(
                    ProjectAccessControl.project_id == project_id,
                    ProjectAccessControl.organization_id == organization_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_project_collaborators(
        self,
        db: AsyncSession,
        project_id: UUID,
        offset: int = 0,
        limit: int = 100,
    ) -> list[ProjectAccessControl]:
        """Get all collaborators for a project."""
        result = await db.execute(
            select(ProjectAccessControl)
            .filter(ProjectAccessControl.project_id == project_id)
            .options(
                joinedload(ProjectAccessControl.user),
                joinedload(ProjectAccessControl.organization),
            )
            .offset(offset)
            .limit(limit)
            .order_by(ProjectAccessControl.created_at.desc())
        )
        return list(result.unique().scalars().all())

    async def create_access_control(
        self,
        db: AsyncSession,
        project_id: UUID,
        permission_level: str,
        created_by: UUID,
        user_id: UUID | None = None,
        organization_id: UUID | None = None,
        expires_at: datetime | None = None,
    ) -> ProjectAccessControl:
        """Create a new access control entry."""
        access = ProjectAccessControl(
            project_id=project_id,
            user_id=user_id,
            organization_id=organization_id,
            permission_level=permission_level,
            created_by=created_by,
            expires_at=expires_at,
        )
        db.add(access)
        await db.flush()
        await db.refresh(access)
        return access

    async def delete_access_control(
        self, db: AsyncSession, access: ProjectAccessControl
    ) -> None:
        """Delete an access control entry."""
        await db.delete(access)
        await db.flush()

    # ========================================================================
    # User Operations
    # ========================================================================

    async def get_user(self, db: AsyncSession, user_id: UUID) -> User | None:
        """Get a user by ID."""
        result = await db.execute(
            select(User).filter(User.id == user_id)  # type: ignore[arg-type]
        )
        return result.scalar_one_or_none()


# Global instance
collaboration_repository = CollaborationRepository()
