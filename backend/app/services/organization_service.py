"""
Organization service for managing organizations and team memberships.

Provides functionality for:
- Creating personal organizations for new users
- Managing organization lifecycle
- Team member operations
"""

import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization, TeamMember, TeamRole
from app.models.user import User

logger = structlog.get_logger(__name__)


class OrganizationService:
    """Service for organization management operations."""

    async def create_personal_organization(
        self, db: AsyncSession, user: User
    ) -> Organization | None:
        """
        Create a personal organization for a user.

        This function is idempotent - it will not create duplicate personal organizations.
        If the user already has a personal organization, it returns the existing one.

        Args:
            db: Database session
            user: User to create personal organization for

        Returns:
            Organization object (newly created or existing), or None if creation failed
        """
        try:
            # Check if user already has a personal organization
            result = await db.execute(
                select(Organization)
                .join(TeamMember)
                .filter(TeamMember.user_id == user.id)
            )
            user_orgs = result.scalars().all()

            # Filter for personal organizations in Python (more compatible)
            existing_org = None
            for org in user_orgs:
                if org.settings and org.settings.get("is_personal") is True:
                    existing_org = org
                    break

            if existing_org:
                logger.info(
                    "personal_org_already_exists",
                    user_id=str(user.id),
                    org_id=str(existing_org.id),
                )
                return existing_org

            # Generate organization name and slug
            org_name = self._generate_personal_org_name(user)
            slug = await self._generate_unique_slug(db, f"user-{user.id}")

            # Create organization
            organization = Organization(
                name=org_name,
                slug=slug,
                description=f"Personal workspace for {user.username or user.email}",
                owner_id=user.id,
                settings={
                    "is_personal": True,
                    "default_org": True,
                },
            )

            db.add(organization)
            await db.flush()

            # Add user as owner team member
            member = TeamMember(
                organization_id=organization.id,
                user_id=user.id,
                role=TeamRole.OWNER.value,
            )
            db.add(member)

            await db.commit()
            await db.refresh(organization)

            logger.info(
                "personal_org_created",
                user_id=str(user.id),
                org_id=str(organization.id),
                org_name=org_name,
                slug=slug,
            )

            return organization

        except Exception as e:
            logger.error(
                "personal_org_creation_failed",
                user_id=str(user.id),
                error=str(e),
                error_type=type(e).__name__,
            )
            await db.rollback()
            return None

    def _generate_personal_org_name(self, user: User) -> str:
        """
        Generate a name for the personal organization.

        Args:
            user: User object

        Returns:
            Organization name
        """
        # Use full name if available, otherwise username, otherwise email prefix
        if user.full_name:
            return f"{user.full_name}'s Projects"
        elif user.username:
            return f"{user.username}'s Projects"
        else:
            email_prefix = user.email.split("@")[0]
            return f"{email_prefix}'s Projects"

    async def _generate_unique_slug(
        self, db: AsyncSession, base_slug: str
    ) -> str:
        """
        Generate a unique slug by appending numbers if necessary.

        Args:
            db: Database session
            base_slug: Base slug to start with

        Returns:
            Unique slug
        """
        slug = base_slug
        counter = 1

        while True:
            result = await db.execute(
                select(Organization).filter(Organization.slug == slug)
            )
            if not result.scalar_one_or_none():
                return slug

            slug = f"{base_slug}-{counter}"
            counter += 1


# Singleton instance
organization_service = OrganizationService()
