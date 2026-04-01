"""
Organization access control functions.

Handles organization membership checks, personal organization
retrieval, and management role verification.
"""

from uuid import UUID

import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization, TeamMember, TeamRole
from app.services.permissions.helpers import check_role_level

logger = structlog.get_logger(__name__)


async def get_personal_organization(
    db: AsyncSession, user_id: UUID
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
        >>> org = await get_personal_organization(db, user_id)
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
        >>> membership = await check_organization_membership(
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

        has_access = check_role_level(current_role, required_role_enum)
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
        >>> can_manage = await can_user_manage_organization(
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

        has_access = check_role_level(current_role, required_role)

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
    db: AsyncSession, user_id: UUID, org_id: UUID
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
        >>> role = await get_user_organization_role(
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
