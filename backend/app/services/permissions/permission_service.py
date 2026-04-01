"""
Permission service facade.

Composes project and organization access functions into a single
service class that preserves the original PermissionService interface.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization, PermissionLevel, TeamMember, TeamRole
from app.models.project import Project
from app.services.permissions.helpers import (
    PERMISSION_HIERARCHY,
    ROLE_HIERARCHY,
    check_permission_level,
    check_role_level,
)
from app.services.permissions.organization_access import (
    can_user_manage_organization,
    check_organization_membership,
    get_personal_organization,
    get_user_organization_role,
)
from app.services.permissions.project_access import (
    can_user_access_project,
    get_user_accessible_projects,
    get_user_permission_level,
)


class PermissionService:
    """
    Service for managing and checking permissions across projects and organizations.

    This service provides centralized access control logic with support for:
    - Project ownership
    - Direct user access via ProjectAccessControl
    - Organization membership access
    - Permission level hierarchy
    - Expiration date handling
    """

    # Permission level hierarchy (lower value = less access)
    PERMISSION_HIERARCHY = PERMISSION_HIERARCHY

    # Team role hierarchy (for organization management)
    ROLE_HIERARCHY = ROLE_HIERARCHY

    # ========================================================================
    # Project Access Methods
    # ========================================================================

    async def can_user_access_project(
        self,
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID,
        required_level: PermissionLevel,
    ) -> bool:
        """Check if user has required access level to a project."""
        return await can_user_access_project(db, user_id, project_id, required_level)

    async def get_user_permission_level(
        self, db: AsyncSession, user_id: UUID, project_id: UUID
    ) -> PermissionLevel | None:
        """Get the highest permission level a user has for a project."""
        return await get_user_permission_level(db, user_id, project_id)

    async def get_user_accessible_projects(
        self, db: AsyncSession, user_id: UUID
    ) -> list[Project]:
        """Get all projects a user has access to."""
        return await get_user_accessible_projects(db, user_id)

    # ========================================================================
    # Organization Access Methods
    # ========================================================================

    async def get_personal_organization(
        self, db: AsyncSession, user_id: UUID
    ) -> Organization | None:
        """Get user's personal organization."""
        return await get_personal_organization(db, user_id)

    async def check_organization_membership(
        self,
        db: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        required_role: str = "member",
    ) -> TeamMember | None:
        """Check if user is a member of an organization with required role."""
        return await check_organization_membership(
            db, user_id, organization_id, required_role
        )

    async def can_user_manage_organization(
        self,
        db: AsyncSession,
        user_id: UUID,
        org_id: UUID,
        required_role: TeamRole,
    ) -> bool:
        """Check if user has required role to manage an organization."""
        return await can_user_manage_organization(db, user_id, org_id, required_role)

    async def get_user_organization_role(
        self, db: AsyncSession, user_id: UUID, org_id: UUID
    ) -> TeamRole | None:
        """Get the user's role in an organization."""
        return await get_user_organization_role(db, user_id, org_id)

    # ========================================================================
    # Helper Methods
    # ========================================================================

    def _check_permission_level(
        self, current: PermissionLevel, required: PermissionLevel
    ) -> bool:
        """Check if current permission level meets or exceeds required level."""
        return check_permission_level(current, required)

    def _check_role_level(self, current: TeamRole, required: TeamRole) -> bool:
        """Check if current role meets or exceeds required role."""
        return check_role_level(current, required)


# Global singleton instance
permission_service = PermissionService()
