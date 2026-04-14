"""Collaboration sync manager for real-time synchronization.

Handles the business logic for real-time collaboration including:
- Resource locking (acquire/release)
- Activity logging
- Comment management
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

import structlog
from app.models.collaboration import (ActionType, ActivityLog, ProjectComment,
                                      ProjectLock, ResourceType)
from app.models.user import User
from sqlalchemy import and_, delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class CollaborationSyncManager:
    """Manages real-time collaboration synchronization.

    Handles resource locking, activity logging, and other
    collaboration features for a project.
    """

    def __init__(
        self,
        db: AsyncSession,
        project_id: str,
        user: User,
    ) -> None:
        """Initialize the sync manager.

        Args:
            db: Database session.
            project_id: Project ID.
            user: Authenticated user.
        """
        self.db = db
        self.project_id = project_id
        self.user = user
        self.logger = structlog.get_logger(__name__)

    @property
    def user_id(self) -> UUID:
        """Get the user ID."""
        return UUID(str(self.user.id))

    async def acquire_lock(
        self,
        resource_type: ResourceType,
        resource_id: str,
        duration_minutes: int = 5,
    ) -> ProjectLock | None:
        """Acquire a lock on a resource.

        Uses SELECT FOR UPDATE to prevent race conditions when multiple users
        attempt to acquire the same lock simultaneously.

        Args:
            resource_type: Type of resource.
            resource_id: ID of the resource.
            duration_minutes: Lock duration in minutes.

        Returns:
            ProjectLock if acquired, None if resource already locked.
        """
        try:
            # Check for existing locks with row-level lock
            result = await self.db.execute(
                select(ProjectLock)
                .where(
                    and_(
                        ProjectLock.project_id == UUID(self.project_id),
                        ProjectLock.resource_type == resource_type,
                        ProjectLock.resource_id == resource_id,
                    )
                )
                .with_for_update()
            )
            existing_lock = result.scalar_one_or_none()

            if existing_lock:
                # If lock expired, delete it atomically
                if existing_lock.is_expired():
                    await self.db.delete(existing_lock)
                    await self.db.flush()
                    self.logger.info(
                        "expired_lock_released_ws",
                        project_id=self.project_id,
                        lock_id=existing_lock.id,
                    )
                    existing_lock = None
                elif existing_lock.user_id == self.user_id:
                    # Extend existing lock for this user
                    existing_lock.extend_lock(minutes=duration_minutes)
                    await self.db.commit()
                    await self.db.refresh(existing_lock)
                    self.logger.info(
                        "lock_extended_ws",
                        project_id=self.project_id,
                        user_id=str(self.user_id),
                        resource_id=resource_id,
                    )
                    return existing_lock
                else:
                    # Lock held by another user
                    self.logger.warning(
                        "lock_acquisition_failed_ws",
                        project_id=self.project_id,
                        resource_id=resource_id,
                        holder=str(existing_lock.user_id),
                        requester=str(self.user_id),
                    )
                    await self.db.rollback()
                    return None

            # Create new lock
            if existing_lock is None:
                lock = ProjectLock(
                    project_id=UUID(self.project_id),
                    user_id=self.user_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    acquired_at=datetime.now(UTC),
                    expires_at=datetime.now(UTC) + timedelta(minutes=duration_minutes),
                    auto_release=True,
                )
                self.db.add(lock)
                await self.db.commit()
                await self.db.refresh(lock)

                self.logger.info(
                    "lock_acquired",
                    project_id=self.project_id,
                    user_id=str(self.user_id),
                    resource_type=resource_type.value,
                    resource_id=resource_id,
                )

                return lock

            return None

        except Exception as e:
            self.logger.error("lock_acquisition_error_ws", error=str(e))
            await self.db.rollback()
            raise

    async def release_lock(self, resource_id: str) -> bool:
        """Release a lock on a resource.

        Args:
            resource_id: ID of the resource.

        Returns:
            True if lock was released.
        """
        result = cast(
            CursorResult[Any],
            await self.db.execute(
                delete(ProjectLock).where(
                    and_(
                        ProjectLock.project_id == UUID(self.project_id),
                        ProjectLock.user_id == self.user_id,
                        ProjectLock.resource_id == resource_id,
                    )
                )
            ),
        )
        await self.db.commit()

        released = result.rowcount > 0

        if released:
            self.logger.info(
                "lock_released",
                project_id=self.project_id,
                user_id=str(self.user_id),
                resource_id=resource_id,
            )

        return released

    async def release_all_user_locks(self) -> int:
        """Release all locks for the user in this project.

        Returns:
            Number of locks released.
        """
        result = cast(
            CursorResult[Any],
            await self.db.execute(
                delete(ProjectLock).where(
                    and_(
                        ProjectLock.project_id == UUID(self.project_id),
                        ProjectLock.user_id == self.user_id,
                        ProjectLock.auto_release == True,  # noqa: E712
                    )
                )
            ),
        )
        await self.db.commit()

        count = result.rowcount

        if count > 0:
            self.logger.info(
                "user_locks_released",
                project_id=self.project_id,
                user_id=str(self.user_id),
                count=count,
            )

        return count

    async def log_activity(
        self,
        action_type: ActionType,
        resource_type: ResourceType,
        resource_id: str,
        resource_name: str | None = None,
        changes: dict[str, Any] | None = None,
    ) -> ActivityLog:
        """Log an activity to the database.

        Args:
            action_type: Type of action.
            resource_type: Type of resource.
            resource_id: ID of the resource.
            resource_name: Name of the resource.
            changes: Changes made.

        Returns:
            ActivityLog entry.
        """
        activity = ActivityLog.create_activity(
            project_id=UUID(self.project_id),
            user_id=self.user_id,
            action_type=action_type,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_name=cast(str, resource_name),
            changes=cast(dict, changes),
        )
        self.db.add(activity)
        await self.db.commit()
        await self.db.refresh(activity)

        return activity

    async def add_comment(
        self,
        content: str,
        workflow_id: str | None = None,
        action_id: str | None = None,
        position: dict[str, Any] | None = None,
        mentions: list[str] | None = None,
    ) -> ProjectComment:
        """Add a comment to the project.

        Args:
            content: Comment content.
            workflow_id: Optional workflow ID.
            action_id: Optional action ID.
            position: Optional position metadata.
            mentions: Optional list of mentioned user IDs.

        Returns:
            Created ProjectComment.
        """
        comment = ProjectComment(
            project_id=UUID(self.project_id),
            workflow_id=workflow_id,
            action_id=action_id,
            author_id=self.user_id,
            content=content,
            position=position,
            mentions=mentions,
        )
        self.db.add(comment)
        await self.db.commit()
        await self.db.refresh(comment)

        return comment
