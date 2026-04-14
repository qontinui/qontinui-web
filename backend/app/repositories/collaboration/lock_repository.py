"""Repository for project lock database operations.

Provides data access for pessimistic locking of project resources
during concurrent editing.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.models.collaboration import ProjectLock, ResourceType
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload


class LockRepository:
    """Repository for project lock data access operations."""

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
            select(ProjectLock).filter(ProjectLock.expires_at < datetime.now(UTC))
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


lock_repository = LockRepository()
