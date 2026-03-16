"""
Repository for organization, team member, and invitation database operations.

Provides async CRUD operations for organization-related models.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.organization import (
    Organization,
    OrganizationInvitation,
    TeamMember,
    TeamRole,
)
from app.models.project import Project
from app.models.user import User


class OrganizationRepository:
    """Repository for Organization CRUD operations."""

    async def get_by_id(
        self, db: AsyncSession, org_id: UUID, with_members: bool = False
    ) -> Organization | None:
        """Get organization by ID."""
        query = select(Organization).filter(Organization.id == org_id)
        if with_members:
            query = query.options(joinedload(Organization.members))
        result = await db.execute(query)
        return result.unique().scalar_one_or_none()

    async def get_by_slug(self, db: AsyncSession, slug: str) -> Organization | None:
        """Get organization by slug."""
        result = await db.execute(
            select(Organization).filter(Organization.slug == slug)
        )
        return result.scalar_one_or_none()

    async def slug_exists(
        self, db: AsyncSession, slug: str, exclude_id: UUID | None = None
    ) -> bool:
        """Check if slug already exists."""
        query = select(Organization).filter(Organization.slug == slug)
        if exclude_id:
            query = query.filter(Organization.id != exclude_id)
        result = await db.execute(query)
        return result.scalar_one_or_none() is not None

    async def list_by_user(
        self,
        db: AsyncSession,
        user_id: UUID,
        offset: int = 0,
        limit: int = 100,
    ) -> list[Organization]:
        """List organizations where user is a member."""
        result = await db.execute(
            select(Organization)
            .join(TeamMember)
            .filter(TeamMember.user_id == user_id)
            .options(joinedload(Organization.members))
            .offset(offset)
            .limit(limit)
            .order_by(Organization.created_at.desc())
        )
        return list(result.unique().scalars().all())

    async def create(
        self,
        db: AsyncSession,
        name: str,
        slug: str,
        owner_id: UUID,
        description: str | None = None,
    ) -> Organization:
        """Create a new organization with owner as first member."""
        organization = Organization(
            name=name,
            slug=slug,
            description=description,
            owner_id=owner_id,
        )
        db.add(organization)
        await db.flush()

        # Add owner as team member
        member = TeamMember(
            organization_id=organization.id,
            user_id=owner_id,
            role=TeamRole.OWNER.value,
        )
        db.add(member)
        await db.commit()
        await db.refresh(organization)

        return organization

    async def update(
        self,
        db: AsyncSession,
        organization: Organization,
        update_data: dict,
    ) -> Organization:
        """Update organization fields."""
        for field, value in update_data.items():
            setattr(organization, field, value)
        await db.commit()
        await db.refresh(organization)
        return organization

    async def delete(self, db: AsyncSession, organization: Organization) -> None:
        """Delete organization."""
        await db.delete(organization)
        await db.commit()


class TeamMemberRepository:
    """Repository for TeamMember CRUD operations."""

    async def get_membership(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
    ) -> TeamMember | None:
        """Get user's membership in organization."""
        result = await db.execute(
            select(TeamMember).filter(
                and_(
                    TeamMember.organization_id == org_id,
                    TeamMember.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_by_organization(
        self,
        db: AsyncSession,
        org_id: UUID,
        offset: int = 0,
        limit: int = 100,
    ) -> list[TeamMember]:
        """List all members of an organization with user data."""
        result = await db.execute(
            select(TeamMember)
            .filter(TeamMember.organization_id == org_id)
            .options(joinedload(TeamMember.user))
            .offset(offset)
            .limit(limit)
            .order_by(TeamMember.joined_at.desc())
        )
        return list(result.unique().scalars().all())

    async def count_members(self, db: AsyncSession, org_id: UUID) -> int:
        """Count members in an organization."""
        result = await db.execute(
            select(func.count(TeamMember.id)).filter(
                TeamMember.organization_id == org_id
            )
        )
        return result.scalar() or 0

    async def count_active_today(self, db: AsyncSession, org_id: UUID) -> int:
        """Count members active in the last 24 hours."""
        yesterday = datetime.now(UTC) - timedelta(hours=24)
        result = await db.execute(
            select(func.count(TeamMember.id)).filter(
                and_(
                    TeamMember.organization_id == org_id,
                    TeamMember.last_active_at >= yesterday,
                )
            )
        )
        return result.scalar() or 0

    async def add_member(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
        role: str,
        invited_by: UUID | None = None,
    ) -> TeamMember:
        """Add a new member to organization."""
        member = TeamMember(
            organization_id=org_id,
            user_id=user_id,
            role=role,
            invited_by=invited_by,
        )
        db.add(member)
        await db.commit()
        await db.refresh(member)
        return member

    async def update_member(
        self,
        db: AsyncSession,
        member: TeamMember,
        update_data: dict,
    ) -> TeamMember:
        """Update member fields."""
        for field, value in update_data.items():
            setattr(member, field, value)
        await db.commit()
        await db.refresh(member)
        return member

    async def remove_member(self, db: AsyncSession, member: TeamMember) -> None:
        """Remove member from organization."""
        await db.delete(member)
        await db.commit()


class InvitationRepository:
    """Repository for OrganizationInvitation CRUD operations."""

    async def get_by_token(
        self, db: AsyncSession, token: str
    ) -> OrganizationInvitation | None:
        """Get invitation by token."""
        result = await db.execute(
            select(OrganizationInvitation).filter(OrganizationInvitation.token == token)
        )
        return result.scalar_one_or_none()

    async def get_pending_by_email(
        self,
        db: AsyncSession,
        org_id: UUID,
        email: str,
    ) -> OrganizationInvitation | None:
        """Get pending invitation for email in organization."""
        result = await db.execute(
            select(OrganizationInvitation).filter(
                and_(
                    OrganizationInvitation.organization_id == org_id,
                    OrganizationInvitation.email == email,
                    OrganizationInvitation.accepted_at.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_by_organization(
        self,
        db: AsyncSession,
        org_id: UUID,
        offset: int = 0,
        limit: int = 100,
    ) -> list[OrganizationInvitation]:
        """List invitations for an organization."""
        result = await db.execute(
            select(OrganizationInvitation)
            .filter(OrganizationInvitation.organization_id == org_id)
            .options(joinedload(OrganizationInvitation.inviter))
            .offset(offset)
            .limit(limit)
            .order_by(OrganizationInvitation.created_at.desc())
        )
        return list(result.unique().scalars().all())

    async def create(
        self,
        db: AsyncSession,
        org_id: UUID,
        email: str,
        role: str,
        invited_by: UUID,
    ) -> OrganizationInvitation:
        """Create a new invitation."""
        invitation = OrganizationInvitation(
            organization_id=org_id,
            email=email,
            role=role,
            invited_by=invited_by,
            token=OrganizationInvitation.generate_token(),
            expires_at=OrganizationInvitation.default_expiry(),
        )
        db.add(invitation)
        await db.commit()
        await db.refresh(invitation)
        return invitation

    async def mark_accepted(
        self, db: AsyncSession, invitation: OrganizationInvitation
    ) -> None:
        """Mark invitation as accepted."""
        invitation.accepted_at = datetime.now(UTC)  # type: ignore[assignment]
        await db.commit()


class ProjectStatisticsRepository:
    """Repository for project-related statistics."""

    async def count_by_organization(self, db: AsyncSession, org_id: UUID) -> int:
        """Count projects in an organization."""
        result = await db.execute(
            select(func.count(Project.id)).filter(Project.organization_id == org_id)
        )
        return result.scalar() or 0


class UserRepository:
    """Repository for user lookup operations."""

    async def get_by_email(self, db: AsyncSession, email: str) -> User | None:
        """Get user by email."""
        result = await db.execute(select(User).where(User.email == email))  # type: ignore[arg-type]
        return result.scalar_one_or_none()


# Singleton instances
organization_repo = OrganizationRepository()
team_member_repo = TeamMemberRepository()
invitation_repo = InvitationRepository()
project_stats_repo = ProjectStatisticsRepository()
user_repo = UserRepository()
