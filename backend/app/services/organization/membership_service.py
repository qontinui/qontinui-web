"""
Membership service for handling team members and invitations.

Provides business logic for:
- Adding and removing team members
- Role management
- Invitation creation and acceptance
- Membership verification
"""

from typing import cast
from uuid import UUID

import structlog
from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit_logger
from app.core.error_codes import ErrorCode
from app.middleware.error_handler import forbidden_error
from app.models.organization import TeamMember, TeamRole
from app.repositories.organization import (
    invitation_repo,
    organization_repo,
    team_member_repo,
    user_repo,
)
from app.schemas.collaboration import (
    InvitationCreate,
    InvitationResponse,
    TeamMemberCreate,
    TeamMemberResponse,
    TeamMemberUpdate,
)
from app.services.collaboration_service import collaboration_service

logger = structlog.get_logger(__name__)

# Role hierarchy for permission checks
ROLE_HIERARCHY = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}


def verify_role_level(membership: TeamMember | None, required_role: str) -> None:
    """
    Verify user has required role in organization.

    Args:
        membership: Team member object
        required_role: Required role (owner, admin, member, viewer)

    Raises:
        HTTPException if insufficient permissions
    """
    if not membership:
        raise forbidden_error(
            "You are not a member of this organization",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    user_level = ROLE_HIERARCHY.get(str(membership.role), 0)
    required_level = ROLE_HIERARCHY.get(required_role, 0)

    if user_level < required_level:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient permissions. Required role: {required_role}",
        )


class MembershipService:
    """Service for team membership operations."""

    async def verify_membership(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
        required_role: str = "member",
    ) -> TeamMember:
        """
        Verify user membership and role level.

        Returns:
            TeamMember if verified

        Raises:
            HTTPException if not a member or insufficient role
        """
        membership = await team_member_repo.get_membership(db, org_id, user_id)
        verify_role_level(membership, required_role)
        return membership  # type: ignore[return-value]

    async def list_members(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[TeamMemberResponse]:
        """List organization members with user details."""
        # Verify caller is a member
        await self.verify_membership(db, org_id, user_id, "member")

        members = await team_member_repo.list_by_organization(db, org_id, skip, limit)

        responses = []
        for member in members:
            response = TeamMemberResponse.model_validate(member)
            if member.user:
                response.email = member.user.email
                response.username = member.user.username
                response.full_name = member.user.full_name
                response.avatar_url = member.user.avatar_url
            responses.append(response)

        return responses

    async def add_member(
        self,
        db: AsyncSession,
        org_id: UUID,
        member_in: TeamMemberCreate,
        current_user_id: UUID,
        request: Request,
    ) -> TeamMemberResponse:
        """Add a new team member (admin only)."""
        # Verify caller is admin
        await self.verify_membership(db, org_id, current_user_id, "admin")

        # Check if user is already a member
        existing = await team_member_repo.get_membership(db, org_id, member_in.user_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is already a member of this organization",
            )

        # Add member
        member = await team_member_repo.add_member(
            db=db,
            org_id=org_id,
            user_id=member_in.user_id,
            role=member_in.role,
            invited_by=current_user_id,
        )

        # Audit log
        await audit_logger.log_team_membership_change(
            db=db,
            user_id=current_user_id,
            action="add_member",
            organization_id=org_id,
            target_user_id=member_in.user_id,
            role=member_in.role,
            request=request,
        )
        await db.commit()

        logger.info(
            "team_member_added",
            org_id=org_id,
            user_id=member_in.user_id,
            role=member_in.role,
        )

        return TeamMemberResponse.model_validate(member)

    async def update_member(
        self,
        db: AsyncSession,
        org_id: UUID,
        target_user_id: UUID,
        update_data: TeamMemberUpdate,
        current_user_id: UUID,
        request: Request,
    ) -> TeamMemberResponse:
        """Update team member role (admin only)."""
        # Verify caller is admin
        await self.verify_membership(db, org_id, current_user_id, "admin")

        # Get member to update
        member = await team_member_repo.get_membership(db, org_id, target_user_id)
        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Team member not found",
            )

        # Cannot change owner role
        if member.role == TeamRole.OWNER.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot modify organization owner",
            )

        old_role = member.role

        # Update member
        update_dict = update_data.model_dump(exclude_unset=True)
        member = await team_member_repo.update_member(db, member, update_dict)

        # Audit log
        await audit_logger.log_team_membership_change(
            db=db,
            user_id=current_user_id,
            action="change_role",
            organization_id=org_id,
            target_user_id=target_user_id,
            role=str(member.role),
            old_role=str(old_role),
            request=request,
        )
        await db.commit()

        logger.info("team_member_updated", org_id=org_id, user_id=target_user_id)

        return TeamMemberResponse.model_validate(member)

    async def remove_member(
        self,
        db: AsyncSession,
        org_id: UUID,
        target_user_id: UUID,
        current_user_id: UUID,
        request: Request,
    ) -> None:
        """Remove team member (admin only, or self)."""
        # Get member to remove
        member = await team_member_repo.get_membership(db, org_id, target_user_id)
        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Team member not found",
            )

        # Cannot remove owner
        if member.role == TeamRole.OWNER.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove organization owner",
            )

        # Check permissions (admin or self)
        if target_user_id != current_user_id:
            await self.verify_membership(db, org_id, current_user_id, "admin")

        removed_role = member.role
        await team_member_repo.remove_member(db, member)

        # Audit log
        await audit_logger.log_team_membership_change(
            db=db,
            user_id=current_user_id,
            action="remove_member",
            organization_id=org_id,
            target_user_id=target_user_id,
            role=str(removed_role),
            request=request,
        )
        await db.commit()

        logger.info("team_member_removed", org_id=org_id, user_id=target_user_id)

    async def create_invitation(
        self,
        db: AsyncSession,
        org_id: UUID,
        invitation_in: InvitationCreate,
        current_user_id: UUID,
        current_user_username: str,
        current_user_email: str,
    ) -> InvitationResponse:
        """Create and send an organization invitation (admin only)."""
        # Verify caller is admin
        await self.verify_membership(db, org_id, current_user_id, "admin")

        # Get organization
        organization = await organization_repo.get_by_id(db, org_id)
        if not organization:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found",
            )

        # Check if user already a member
        existing_user = await user_repo.get_by_email(db, invitation_in.email)
        if existing_user:
            existing_member = await team_member_repo.get_membership(
                db, org_id, existing_user.id
            )
            if existing_member:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="User is already a member",
                )

        # Check for existing pending invitation
        existing_invite = await invitation_repo.get_pending_by_email(
            db, org_id, invitation_in.email
        )
        if existing_invite:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invitation already sent to this email",
            )

        # Create invitation
        invitation = await invitation_repo.create(
            db=db,
            org_id=org_id,
            email=invitation_in.email,
            role=invitation_in.role,
            invited_by=current_user_id,
        )

        # Send email
        await collaboration_service.send_invitation_email(invitation, organization)

        logger.info(
            "invitation_created",
            org_id=org_id,
            email=invitation_in.email,
            invited_by=current_user_id,
        )

        response = InvitationResponse.model_validate(invitation)
        response.is_expired = invitation.is_expired
        response.is_accepted = invitation.is_accepted
        response.organization_name = cast(str, organization.name)
        response.inviter_username = current_user_username
        response.inviter_email = current_user_email

        return response

    async def list_invitations(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[InvitationResponse]:
        """List organization invitations (admin only)."""
        # Verify caller is admin
        await self.verify_membership(db, org_id, user_id, "admin")

        invitations = await invitation_repo.list_by_organization(
            db, org_id, skip, limit
        )

        responses = []
        for invitation in invitations:
            response = InvitationResponse.model_validate(invitation)
            response.is_expired = invitation.is_expired
            response.is_accepted = invitation.is_accepted
            if invitation.inviter:
                response.inviter_username = invitation.inviter.username
                response.inviter_email = invitation.inviter.email
            responses.append(response)

        return responses

    async def accept_invitation(
        self,
        db: AsyncSession,
        token: str,
        user_id: UUID,
        user_email: str,
    ) -> TeamMemberResponse:
        """Accept an organization invitation."""
        invitation = await invitation_repo.get_by_token(db, token)
        if not invitation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invitation not found",
            )

        # Validate invitation
        if invitation.is_accepted:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invitation already accepted",
            )

        if invitation.is_expired:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invitation has expired",
            )

        # Verify email matches
        if invitation.email != user_email:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This invitation was sent to a different email address",
            )

        # Check if already a member
        org_id = cast(UUID, invitation.organization_id)
        existing_member = await team_member_repo.get_membership(db, org_id, user_id)
        if existing_member:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You are already a member of this organization",
            )

        # Create team member
        member = await team_member_repo.add_member(
            db=db,
            org_id=org_id,
            user_id=user_id,
            role=cast(str, invitation.role),
            invited_by=cast(UUID | None, invitation.invited_by),
        )

        # Mark invitation as accepted
        await invitation_repo.mark_accepted(db, invitation)

        logger.info(
            "invitation_accepted",
            org_id=invitation.organization_id,
            user_id=user_id,
        )

        return TeamMemberResponse.model_validate(member)

    async def switch_organization(
        self,
        db: AsyncSession,
        org_id: UUID,
        user_id: UUID,
    ) -> None:
        """
        Switch current organization context.

        Verifies user is a member of the organization.
        In production, this would update session/JWT claims.
        """
        membership = await team_member_repo.get_membership(db, org_id, user_id)
        if not membership:
            raise forbidden_error(
                "You are not a member of this organization",
                ErrorCode.INSUFFICIENT_PERMISSIONS,
            )

        logger.info("organization_switched", user_id=user_id, org_id=org_id)


# Singleton instance
membership_service = MembershipService()
