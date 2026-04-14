"""
Project access control functions.

Handles checking user access to projects, determining permission levels,
and retrieving accessible projects.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.organization import PermissionLevel, ProjectAccessControl, TeamMember
from app.models.project import Project
from app.services.permissions.helpers import check_permission_level

logger = structlog.get_logger(__name__)


async def can_user_access_project(
    db: AsyncSession,
    user_id: UUID,
    project_id: UUID,
    required_level: PermissionLevel,
) -> bool:
    """
    Check if user has required access level to a project.

    This method checks access in the following order:
    0. Superuser status (grants admin access to all projects)
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
        >>> await can_user_access_project(
        ...     db, user_id, project_id, PermissionLevel.EDIT
        ... )
        True
    """
    try:
        # Check if user is a superuser - they have access to all projects
        from app.crud.user import get_user

        user = await get_user(db, user_id=user_id)
        if user and user.is_superuser:
            return True

        # Get the user's actual permission level
        user_level = await get_user_permission_level(db, user_id, project_id)

        if user_level is None:
            logger.info(
                "access_denied_no_permission",
                user_id=user_id,
                project_id=project_id,
                required_level=required_level.value,
            )
            return False

        # Check if user's level meets the requirement
        has_access = check_permission_level(user_level, required_level)

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
    db: AsyncSession, user_id: UUID, project_id: UUID
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
        >>> level = await get_user_permission_level(
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
                    TeamMember.organization_id == ProjectAccessControl.organization_id,
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
        current_time = datetime.now(UTC)

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
            if highest_level is None or check_permission_level(level, highest_level):
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
    db: AsyncSession, user_id: UUID
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
        >>> projects = await get_user_accessible_projects(
        ...     db, user_id
        ... )
        >>> for project in projects:
        ...     print(f"User can access: {project.name}")
    """
    try:
        current_time = datetime.now(UTC)

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
