"""
Permission service for centralized access control.

Provides a comprehensive permission checking system for projects and organizations.
This service consolidates all permission logic in a single location to ensure
consistent access control across the application.

Key features:
- Project-level permission checking with hierarchy support
- Organization membership validation
- Efficient database queries with joins
- Expiration date handling
- Permission level hierarchy (view < comment < edit < admin)
"""

from datetime import datetime
from uuid import UUID

import structlog
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.organization import (
    Organization,
    PermissionLevel,
    ProjectAccessControl,
    TeamMember,
    TeamRole,
)
from app.models.project import Project

logger = structlog.get_logger(__name__)


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
    PERMISSION_HIERARCHY = {
        PermissionLevel.VIEW: 0,
        PermissionLevel.COMMENT: 1,
        PermissionLevel.EDIT: 2,
        PermissionLevel.ADMIN: 3,
    }

    # Team role hierarchy (for organization management)
    ROLE_HIERARCHY = {
        TeamRole.VIEWER: 0,
        TeamRole.MEMBER: 1,
        TeamRole.ADMIN: 2,
        TeamRole.OWNER: 3,
    }

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
        """
        Check if user has required access level to a project.

        This method checks access in the following order:
        1. Project ownership (grants admin access)
        2. Direct user access via ProjectAccessControl
        3. Organization membership access via ProjectAccessControl

        Args:
            db: Database session
            user_id: User ID to check
            project_id: Project ID to check access for
            required_level: Required permission level

        Returns:
            True if user has required access, False otherwise

        Example:
            >>> await permission_service.can_user_access_project(
            ...     db, user_id, project_id, PermissionLevel.EDIT
            ... )
            True
        """
        try:
            # Get the user's actual permission level
            user_level = await self.get_user_permission_level(db, user_id, project_id)

            if user_level is None:
                logger.info(
                    "access_denied_no_permission",
                    user_id=user_id,
                    project_id=project_id,
                    required_level=required_level.value,
                )
                return False

            # Check if user's level meets the requirement
            has_access = self._check_permission_level(user_level, required_level)

            if has_access:
                logger.info(
                    "access_granted",
                    user_id=user_id,
                    project_id=project_id,
                    user_level=user_level.value,
                    required_level=required_level.value,
                )
            else:
                logger.warning(
                    "access_denied_insufficient_permission",
                    user_id=user_id,
                    project_id=project_id,
                    user_level=user_level.value,
                    required_level=required_level.value,
                )

            return has_access

        except Exception as e:
            logger.error(
                "access_check_failed",
                error=str(e),
                user_id=user_id,
                project_id=project_id,
                required_level=required_level.value,
            )
            return False

    async def get_user_permission_level(
        self, db: AsyncSession, user_id: UUID, project_id: UUID
    ) -> PermissionLevel | None:
        """
        Get the highest permission level a user has for a project.

        This method consolidates all permission sources and returns the highest
        permission level the user has from any source (ownership, direct access,
        or organization membership).

        Args:
            db: Database session
            user_id: User ID
            project_id: Project ID

        Returns:
            PermissionLevel if user has access, None otherwise

        Example:
            >>> level = await permission_service.get_user_permission_level(
            ...     db, user_id, project_id
            ... )
            >>> if level == PermissionLevel.ADMIN:
            ...     print("User has admin access")
        """
        try:
            # Check if user is project owner (grants admin access)
            result = await db.execute(
                select(Project).where(
                    and_(Project.id == project_id, Project.owner_id == user_id)
                )
            )
            if result.scalar_one_or_none():
                logger.debug(
                    "permission_from_ownership",
                    user_id=user_id,
                    project_id=project_id,
                    level="admin",
                )
                return PermissionLevel.ADMIN

            # Check direct user access and organization access in a single query
            # This uses a LEFT JOIN to get both direct and org-based access
            result = await db.execute(
                select(ProjectAccessControl)
                .outerjoin(
                    TeamMember,
                    and_(
                        TeamMember.organization_id
                        == ProjectAccessControl.organization_id,
                        TeamMember.user_id == user_id,
                    ),
                )
                .where(
                    and_(
                        ProjectAccessControl.project_id == project_id,
                        or_(
                            # Direct user access
                            ProjectAccessControl.user_id == user_id,
                            # Organization access (user is member)
                            TeamMember.user_id == user_id,
                        ),
                    )
                )
            )
            access_controls = result.scalars().all()

            # Find the highest permission level from all valid access controls
            highest_level = None
            current_time = datetime.utcnow()

            for access in access_controls:
                # Skip expired access
                if access.expires_at and access.expires_at < current_time:
                    logger.debug(
                        "skipping_expired_access",
                        access_id=access.id,
                        expires_at=access.expires_at,
                    )
                    continue

                # Get permission level
                try:
                    level = PermissionLevel(access.permission_level)
                except ValueError:
                    logger.warning(
                        "invalid_permission_level",
                        access_id=access.id,
                        level=access.permission_level,
                    )
                    continue

                # Update highest level if this one is higher
                if highest_level is None or self._check_permission_level(
                    level, highest_level
                ):
                    highest_level = level

            if highest_level:
                logger.debug(
                    "permission_determined",
                    user_id=user_id,
                    project_id=project_id,
                    level=highest_level.value,
                )

            return highest_level

        except Exception as e:
            logger.error(
                "get_permission_level_failed",
                error=str(e),
                user_id=user_id,
                project_id=project_id,
            )
            return None

    async def get_user_accessible_projects(
        self, db: AsyncSession, user_id: UUID
    ) -> list[Project]:
        """
        Get all projects a user has access to.

        Returns projects where the user is:
        1. The owner
        2. Has direct access via ProjectAccessControl
        3. Has access via organization membership

        Only returns projects with non-expired access.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            List of Project objects the user can access

        Example:
            >>> projects = await permission_service.get_user_accessible_projects(
            ...     db, user_id
            ... )
            >>> for project in projects:
            ...     print(f"User can access: {project.name}")
        """
        try:
            current_time = datetime.utcnow()

            # Get owned projects
            # Use selectinload to avoid N+1 queries when accessing project.owner
            owned_result = await db.execute(
                select(Project)
                .where(Project.owner_id == user_id)
                .options(selectinload(Project.owner))
            )
            owned_projects = list(owned_result.scalars().all())
            logger.info(
                "get_owned_projects",
                user_id=user_id,
                owned_count=len(owned_projects),
                project_ids=[str(p.id) for p in owned_projects],
            )

            # Get projects with direct access or organization access
            # Use a single query with joins for efficiency
            # Wrap in try-except to ensure owned projects are returned even if this fails
            shared_projects = []
            try:
                # Use selectinload to avoid N+1 queries when accessing project.owner
                shared_result = await db.execute(
                    select(Project)
                    .join(
                        ProjectAccessControl,
                        ProjectAccessControl.project_id == Project.id,
                    )
                    .outerjoin(
                        TeamMember,
                        and_(
                            TeamMember.organization_id
                            == ProjectAccessControl.organization_id,
                            TeamMember.user_id == user_id,
                        ),
                    )
                    .where(
                        and_(
                            # Not owned by user (already got those)
                            Project.owner_id != user_id,
                            # Has direct access OR organization access
                            or_(
                                ProjectAccessControl.user_id == user_id,
                                TeamMember.user_id == user_id,
                            ),
                            # Not expired
                            or_(
                                ProjectAccessControl.expires_at.is_(None),
                                ProjectAccessControl.expires_at > current_time,
                            ),
                        )
                    )
                    # Use distinct on id only - full distinct fails because
                    # json columns don't have equality operators in PostgreSQL
                    .distinct(Project.id)
                    .order_by(Project.id)  # Required for DISTINCT ON in PostgreSQL
                    .options(selectinload(Project.owner))
                )
                shared_projects = list(shared_result.scalars().all())
            except Exception as shared_error:
                logger.warning(
                    "get_shared_projects_failed",
                    error=str(shared_error),
                    user_id=user_id,
                    message="Returning only owned projects",
                )

            # Combine and deduplicate
            all_projects = owned_projects + shared_projects
            project_map = {p.id: p for p in all_projects}
            unique_projects = list(project_map.values())

            logger.info(
                "accessible_projects_retrieved",
                user_id=user_id,
                owned_count=len(owned_projects),
                shared_count=len(shared_projects),
                total_count=len(unique_projects),
            )

            return unique_projects

        except Exception as e:
            logger.error(
                "get_accessible_projects_failed",
                error=str(e),
                user_id=user_id,
            )
            return []

    # ========================================================================
    # Organization Access Methods
    # ========================================================================

    async def get_personal_organization(
        self, db: AsyncSession, user_id: UUID
    ) -> Organization | None:
        """
        Get user's personal organization.

        Every user has a personal organization created during user registration.
        The personal organization has 'is_personal': true in its settings.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            User's personal organization or None if not found

        Example:
            >>> org = await permission_service.get_personal_organization(db, user_id)
            >>> if org:
            ...     print(f"Personal org: {org.name}")
        """
        try:
            # Query for all organizations owned by user
            result = await db.execute(
                select(Organization).where(Organization.owner_id == user_id)
            )
            user_orgs = result.scalars().all()

            # Filter for personal organization in Python
            personal_org = None
            for org in user_orgs:
                if org.settings and org.settings.get("is_personal") is True:
                    personal_org = org
                    break

            if personal_org:
                logger.debug(
                    "personal_org_found",
                    user_id=user_id,
                    org_id=personal_org.id,
                    org_name=personal_org.name,
                )
            else:
                logger.warning(
                    "personal_org_not_found",
                    user_id=user_id,
                )

            return personal_org

        except Exception as e:
            logger.error(
                "get_personal_org_failed",
                error=str(e),
                user_id=user_id,
            )
            return None

    async def check_organization_membership(
        self,
        db: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        required_role: str = "member",
    ) -> TeamMember | None:
        """
        Check if user is a member of an organization with required role.

        Args:
            db: Database session
            user_id: User ID
            organization_id: Organization ID
            required_role: Required role as string (viewer, member, admin, owner)

        Returns:
            TeamMember if user has required role, None otherwise

        Example:
            >>> membership = await permission_service.check_organization_membership(
            ...     db, user_id, org_id, "admin"
            ... )
            >>> if membership:
            ...     print(f"User has {membership.role} access")
        """
        try:
            # Map string to TeamRole enum
            role_map = {
                "viewer": TeamRole.VIEWER,
                "member": TeamRole.MEMBER,
                "admin": TeamRole.ADMIN,
                "owner": TeamRole.OWNER,
            }
            required_role_enum = role_map.get(required_role.lower())
            if not required_role_enum:
                logger.warning(
                    "invalid_role_string",
                    required_role=required_role,
                )
                return None

            # Check if user is organization owner
            result = await db.execute(
                select(Organization).where(
                    and_(
                        Organization.id == organization_id,
                        Organization.owner_id == user_id,
                    )
                )
            )
            if result.scalar_one_or_none():
                # Owner always has access - get their membership
                result = await db.execute(
                    select(TeamMember).where(
                        and_(
                            TeamMember.organization_id == organization_id,
                            TeamMember.user_id == user_id,
                        )
                    )
                )
                return result.scalar_one_or_none()

            # Check team member role
            result = await db.execute(
                select(TeamMember).where(
                    and_(
                        TeamMember.organization_id == organization_id,
                        TeamMember.user_id == user_id,
                    )
                )
            )
            member = result.scalar_one_or_none()

            if not member:
                return None

            # Check role hierarchy
            try:
                current_role = TeamRole(member.role)
            except ValueError:
                logger.warning(
                    "invalid_team_role",
                    user_id=user_id,
                    org_id=organization_id,
                    role=member.role,
                )
                return None

            has_access = self._check_role_level(current_role, required_role_enum)
            return member if has_access else None

        except Exception as e:
            logger.error(
                "check_membership_failed",
                error=str(e),
                user_id=user_id,
                organization_id=organization_id,
                required_role=required_role,
            )
            return None

    async def can_user_manage_organization(
        self,
        db: AsyncSession,
        user_id: UUID,
        org_id: UUID,
        required_role: TeamRole,
    ) -> bool:
        """
        Check if user has required role to manage an organization.

        This method checks if the user has the required role level to perform
        management actions on an organization.

        Role hierarchy: viewer < member < admin < owner

        Args:
            db: Database session
            user_id: User ID to check
            org_id: Organization ID
            required_role: Required role level

        Returns:
            True if user has required role, False otherwise

        Example:
            >>> # Check if user can manage members (requires admin role)
            >>> can_manage = await permission_service.can_user_manage_organization(
            ...     db, user_id, org_id, TeamRole.ADMIN
            ... )
            >>> if can_manage:
            ...     # Allow user to add/remove members
        """
        try:
            # Check if user is organization owner
            result = await db.execute(
                select(Organization).where(
                    and_(Organization.id == org_id, Organization.owner_id == user_id)
                )
            )
            if result.scalar_one_or_none():
                logger.info(
                    "org_access_granted_owner",
                    user_id=user_id,
                    org_id=org_id,
                    required_role=required_role.value,
                )
                return True

            # Check team member role
            result = await db.execute(
                select(TeamMember).where(
                    and_(
                        TeamMember.organization_id == org_id,
                        TeamMember.user_id == user_id,
                    )
                )
            )
            member = result.scalar_one_or_none()

            if not member:
                logger.info(
                    "org_access_denied_not_member",
                    user_id=user_id,
                    org_id=org_id,
                    required_role=required_role.value,
                )
                return False

            # Check role hierarchy
            try:
                current_role = TeamRole(member.role)
            except ValueError:
                logger.warning(
                    "invalid_team_role",
                    user_id=user_id,
                    org_id=org_id,
                    role=member.role,
                )
                return False

            has_access = self._check_role_level(current_role, required_role)

            if has_access:
                logger.info(
                    "org_access_granted",
                    user_id=user_id,
                    org_id=org_id,
                    current_role=current_role.value,
                    required_role=required_role.value,
                )
            else:
                logger.warning(
                    "org_access_denied_insufficient_role",
                    user_id=user_id,
                    org_id=org_id,
                    current_role=current_role.value,
                    required_role=required_role.value,
                )

            return has_access

        except Exception as e:
            logger.error(
                "org_access_check_failed",
                error=str(e),
                user_id=user_id,
                org_id=org_id,
                required_role=required_role.value,
            )
            return False

    async def get_user_organization_role(
        self, db: AsyncSession, user_id: UUID, org_id: UUID
    ) -> TeamRole | None:
        """
        Get the user's role in an organization.

        Args:
            db: Database session
            user_id: User ID
            org_id: Organization ID

        Returns:
            TeamRole if user is a member/owner, None otherwise

        Example:
            >>> role = await permission_service.get_user_organization_role(
            ...     db, user_id, org_id
            ... )
            >>> if role == TeamRole.OWNER:
            ...     print("User owns this organization")
        """
        try:
            # Check if user is organization owner
            result = await db.execute(
                select(Organization).where(
                    and_(Organization.id == org_id, Organization.owner_id == user_id)
                )
            )
            if result.scalar_one_or_none():
                return TeamRole.OWNER

            # Check team member role
            result = await db.execute(
                select(TeamMember).where(
                    and_(
                        TeamMember.organization_id == org_id,
                        TeamMember.user_id == user_id,
                    )
                )
            )
            member = result.scalar_one_or_none()

            if member:
                try:
                    return TeamRole(member.role)
                except ValueError:
                    logger.warning(
                        "invalid_team_role",
                        user_id=user_id,
                        org_id=org_id,
                        role=member.role,
                    )

            return None

        except Exception as e:
            logger.error(
                "get_org_role_failed",
                error=str(e),
                user_id=user_id,
                org_id=org_id,
            )
            return None

    # ========================================================================
    # Helper Methods
    # ========================================================================

    def _check_permission_level(
        self, current: PermissionLevel, required: PermissionLevel
    ) -> bool:
        """
        Check if current permission level meets or exceeds required level.

        Permission hierarchy: VIEW < COMMENT < EDIT < ADMIN

        Args:
            current: Current permission level
            required: Required permission level

        Returns:
            True if current >= required in the hierarchy
        """
        current_value = self.PERMISSION_HIERARCHY.get(current, -1)
        required_value = self.PERMISSION_HIERARCHY.get(required, 999)
        return current_value >= required_value

    def _check_role_level(self, current: TeamRole, required: TeamRole) -> bool:
        """
        Check if current role meets or exceeds required role.

        Role hierarchy: VIEWER < MEMBER < ADMIN < OWNER

        Args:
            current: Current role
            required: Required role

        Returns:
            True if current >= required in the hierarchy
        """
        current_value = self.ROLE_HIERARCHY.get(current, -1)
        required_value = self.ROLE_HIERARCHY.get(required, 999)
        return current_value >= required_value


# Global singleton instance
permission_service = PermissionService()
