"""Repository for access control database operations.

Provides data access for project sharing, permissions, and collaborator management.
"""

from datetime import datetime
from uuid import UUID

from app.models.organization import ProjectAccessControl
from app.models.user import User
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload


class AccessRepository:
    """Repository for access control data access operations."""

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

    async def get_user(self, db: AsyncSession, user_id: UUID) -> User | None:
        """Get a user by ID."""
        result = await db.execute(
            select(User).filter(User.id == user_id)  # type: ignore[arg-type]
        )
        return result.scalar_one_or_none()


access_repository = AccessRepository()
