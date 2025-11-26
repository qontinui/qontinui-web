"""
Organizations API endpoints for team collaboration.

Provides endpoints for:
- Creating and managing organizations
- Managing team members
- Sending and accepting invitations
- Switching organization context
"""

import re
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.core.audit import audit_logger
from app.core.error_codes import ErrorCode
from app.middleware.error_handler import (
    conflict_error,
    forbidden_error,
    not_found_error,
    validation_error,
)
from app.middleware.rate_limit import user_limiter
from app.models.organization import (
    Organization,
    OrganizationInvitation,
    PermissionLevel,
    TeamMember,
    TeamRole,
)
from app.models.user import User
from app.schemas.collaboration import (
    InvitationAccept,
    InvitationCreate,
    InvitationResponse,
    OrganizationCreate,
    OrganizationResponse,
    OrganizationSwitchRequest,
    OrganizationSwitchResponse,
    OrganizationUpdate,
    TeamMemberCreate,
    TeamMemberResponse,
    TeamMemberUpdate,
)
from app.schemas.project import Project
from app.services.collaboration_service import collaboration_service
from app.services.permission_service import permission_service
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

logger = structlog.get_logger(__name__)

router = APIRouter()


def generate_slug(name: str) -> str:
    """Generate URL-friendly slug from organization name."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug)
    slug = slug.strip("-")
    return slug[:63]  # Max length


async def ensure_slug_unique(
    db: AsyncSession, slug: str, org_id: UUID | None = None
) -> str:
    """Ensure slug is unique by appending number if necessary."""
    base_slug = slug
    counter = 1

    while True:
        query = select(Organization).filter(Organization.slug == slug)
        if org_id:
            query = query.filter(Organization.id != org_id)

        result = await db.execute(query)
        if not result.scalar_one_or_none():
            return slug

        slug = f"{base_slug}-{counter}"
        counter += 1


def verify_organization_role(
    membership: TeamMember | None, required_role: str = "member"
) -> None:
    """
    Verify user has required role in organization.

    Args:
        membership: Team member object
        required_role: Required role (owner, admin, member)

    Raises:
        HTTPException if insufficient permissions
    """
    if not membership:
        raise forbidden_error(
            "You are not a member of this organization",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    role_hierarchy = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}
    user_level = role_hierarchy.get(membership.role, 0)
    required_level = role_hierarchy.get(required_role, 0)

    if user_level < required_level:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient permissions. Required role: {required_role}",
        )


# ============================================================================
# Organization Management
# ============================================================================


@router.post(
    "", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED
)
@user_limiter.limit("10 per minute")
async def create_organization(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    organization_in: OrganizationCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new organization."""
    logger.info(
        "create_organization_request",
        user_id=current_user.id,
        name=organization_in.name,
    )

    # Generate slug
    slug = organization_in.slug or generate_slug(organization_in.name)
    slug = await ensure_slug_unique(db, slug)

    # Create organization
    organization = Organization(
        name=organization_in.name,
        slug=slug,
        description=organization_in.description,
        owner_id=current_user.id,
    )

    db.add(organization)
    await db.flush()

    # Add owner as team member
    member = TeamMember(
        organization_id=organization.id,
        user_id=current_user.id,
        role=TeamRole.OWNER.value,
    )
    db.add(member)

    await db.commit()
    await db.refresh(organization)

    logger.info("organization_created", org_id=organization.id, slug=slug)

    # Add member count
    response = OrganizationResponse.model_validate(organization)
    response.member_count = 1

    return response


@router.get("", response_model=list[OrganizationResponse])
async def list_user_organizations(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List all organizations the user is a member of."""
    logger.info("list_organizations_request", user_id=current_user.id)

    # Get organizations where user is a member
    result = await db.execute(
        select(Organization)
        .join(TeamMember)
        .filter(TeamMember.user_id == current_user.id)
        .options(joinedload(Organization.members))
        .offset(skip)
        .limit(limit)
        .order_by(Organization.created_at.desc())
    )
    organizations = result.unique().scalars().all()

    # Get member counts
    responses = []
    for org in organizations:
        response = OrganizationResponse.model_validate(org)
        response.member_count = len(org.members)
        responses.append(response)

    logger.info("list_organizations_response", count=len(responses))
    return responses


@router.get("/{organization_id}", response_model=OrganizationResponse)
async def get_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get organization details."""
    # Get organization
    result = await db.execute(
        select(Organization)
        .filter(Organization.id == organization_id)
        .options(joinedload(Organization.members))
    )
    organization = result.unique().scalar_one_or_none()

    if not organization:
        raise not_found_error("Organization", "organization")

    # Check membership
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()
    verify_organization_role(membership, "member")

    response = OrganizationResponse.model_validate(organization)
    response.member_count = len(organization.members)

    return response


@router.put("/{organization_id}", response_model=OrganizationResponse)
async def update_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    organization_update: OrganizationUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update organization (admin only)."""
    # Get organization
    result = await db.execute(
        select(Organization).filter(Organization.id == organization_id)
    )
    organization = result.scalar_one_or_none()

    if not organization:
        raise not_found_error("Organization", "organization")

    # Check permissions
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()
    verify_organization_role(membership, "admin")

    # Update fields
    update_data = organization_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(organization, field, value)

    await db.commit()
    await db.refresh(organization)

    logger.info("organization_updated", org_id=organization_id)

    response = OrganizationResponse.model_validate(organization)
    return response


@router.delete("/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete organization (owner only)."""
    # Get organization
    result = await db.execute(
        select(Organization).filter(Organization.id == organization_id)
    )
    organization = result.scalar_one_or_none()

    if not organization:
        raise not_found_error("Organization", "organization")

    # Only owner can delete
    if organization.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the organization owner can delete it",
        )

    await db.delete(organization)
    await db.commit()

    logger.info("organization_deleted", org_id=organization_id)


# ============================================================================
# Team Members Management
# ============================================================================


@router.get("/{organization_id}/members", response_model=list[TeamMemberResponse])
async def list_organization_members(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List organization members."""
    # Check membership
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()
    verify_organization_role(membership, "member")

    # Get all members with user data
    result = await db.execute(
        select(TeamMember)
        .filter(TeamMember.organization_id == organization_id)
        .options(joinedload(TeamMember.user))
        .offset(skip)
        .limit(limit)
        .order_by(TeamMember.joined_at.desc())
    )
    members = result.unique().scalars().all()

    # Build responses with user data
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


@router.post(
    "/{organization_id}/members",
    response_model=TeamMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_team_member(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    member_in: TeamMemberCreate,
    current_user: User = Depends(get_current_active_user_async),
    request: Request,
) -> Any:
    """Add a team member (admin only)."""
    # Check permissions
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()
    verify_organization_role(membership, "admin")

    # Check if user already a member
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == member_in.user_id,
            )
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of this organization",
        )

    # Add member
    member = TeamMember(
        organization_id=organization_id,
        user_id=member_in.user_id,
        role=member_in.role,
        invited_by=current_user.id,
    )

    db.add(member)
    await db.commit()
    await db.refresh(member)

    # Audit log: team member added
    await audit_logger.log_team_membership_change(
        db=db,
        user_id=current_user.id,
        action="add_member",
        organization_id=organization_id,
        target_user_id=member_in.user_id,
        role=member_in.role,
        request=request,
    )
    await db.commit()

    logger.info(
        "team_member_added",
        org_id=organization_id,
        user_id=member_in.user_id,
        role=member_in.role,
    )

    return TeamMemberResponse.model_validate(member)


@router.put("/{organization_id}/members/{user_id}", response_model=TeamMemberResponse)
async def update_team_member(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    user_id: UUID,
    member_update: TeamMemberUpdate,
    current_user: User = Depends(get_current_active_user_async),
    request: Request,
) -> Any:
    """Update team member role (admin only)."""
    # Check permissions
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()
    verify_organization_role(membership, "admin")

    # Get member to update
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == user_id,
            )
        )
    )
    member = result.scalar_one_or_none()

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

    # Store old role for audit log
    old_role = member.role

    # Update fields
    update_data = member_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(member, field, value)

    await db.commit()
    await db.refresh(member)

    # Audit log: team member role changed
    await audit_logger.log_team_membership_change(
        db=db,
        user_id=current_user.id,
        action="change_role",
        organization_id=organization_id,
        target_user_id=user_id,
        role=member.role,
        old_role=old_role,
        request=request,
    )
    await db.commit()

    logger.info("team_member_updated", org_id=organization_id, user_id=user_id)

    return TeamMemberResponse.model_validate(member)


@router.delete(
    "/{organization_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_team_member(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    request: Request,
) -> None:
    """Remove team member (admin only, or self)."""
    # Get member to remove
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == user_id,
            )
        )
    )
    member = result.scalar_one_or_none()

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
    if user_id != current_user.id:
        result = await db.execute(
            select(TeamMember).filter(
                and_(
                    TeamMember.organization_id == organization_id,
                    TeamMember.user_id == current_user.id,
                )
            )
        )
        membership = result.scalar_one_or_none()
        verify_organization_role(membership, "admin")

    # Store role for audit log
    removed_role = member.role

    await db.delete(member)
    await db.commit()

    # Audit log: team member removed
    await audit_logger.log_team_membership_change(
        db=db,
        user_id=current_user.id,
        action="remove_member",
        organization_id=organization_id,
        target_user_id=user_id,
        role=removed_role,
        request=request,
    )
    await db.commit()

    logger.info("team_member_removed", org_id=organization_id, user_id=user_id)


# ============================================================================
# Invitations
# ============================================================================


@router.post(
    "/{organization_id}/invitations",
    response_model=InvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    invitation_in: InvitationCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create and send an organization invitation (admin only)."""
    # Check permissions
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()
    verify_organization_role(membership, "admin")

    # Get organization
    result = await db.execute(
        select(Organization).filter(Organization.id == organization_id)
    )
    organization = result.scalar_one_or_none()

    if not organization:
        raise not_found_error("Organization", "organization")

    # Check if user already a member
    result = await db.execute(select(User).filter(User.email == invitation_in.email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        result = await db.execute(
            select(TeamMember).filter(
                and_(
                    TeamMember.organization_id == organization_id,
                    TeamMember.user_id == existing_user.id,
                )
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is already a member",
            )

    # Check for existing pending invitation
    result = await db.execute(
        select(OrganizationInvitation).filter(
            and_(
                OrganizationInvitation.organization_id == organization_id,
                OrganizationInvitation.email == invitation_in.email,
                OrganizationInvitation.accepted_at.is_(None),
            )
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invitation already sent to this email",
        )

    # Create invitation
    invitation = OrganizationInvitation(
        organization_id=organization_id,
        email=invitation_in.email,
        role=invitation_in.role,
        invited_by=current_user.id,
        token=OrganizationInvitation.generate_token(),
        expires_at=OrganizationInvitation.default_expiry(),
    )

    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    # Send invitation email
    await collaboration_service.send_invitation_email(invitation, organization)

    logger.info(
        "invitation_created",
        org_id=organization_id,
        email=invitation_in.email,
        invited_by=current_user.id,
    )

    response = InvitationResponse.model_validate(invitation)
    response.is_expired = invitation.is_expired
    response.is_accepted = invitation.is_accepted
    response.organization_name = organization.name
    response.inviter_username = current_user.username
    response.inviter_email = current_user.email

    return response


@router.get("/{organization_id}/invitations", response_model=list[InvitationResponse])
async def list_invitations(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List organization invitations (admin only)."""
    # Check permissions
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()
    verify_organization_role(membership, "admin")

    # Get invitations
    result = await db.execute(
        select(OrganizationInvitation)
        .filter(OrganizationInvitation.organization_id == organization_id)
        .options(joinedload(OrganizationInvitation.inviter))
        .offset(skip)
        .limit(limit)
        .order_by(OrganizationInvitation.created_at.desc())
    )
    invitations = result.unique().scalars().all()

    # Build responses
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


@router.post("/invitations/accept", response_model=TeamMemberResponse)
async def accept_invitation(
    *,
    db: AsyncSession = Depends(get_async_db),
    invitation_accept: InvitationAccept,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Accept an organization invitation."""
    # Get invitation
    result = await db.execute(
        select(OrganizationInvitation).filter(
            OrganizationInvitation.token == invitation_accept.token
        )
    )
    invitation = result.scalar_one_or_none()

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
    if invitation.email != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This invitation was sent to a different email address",
        )

    # Check if already a member
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == invitation.organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already a member of this organization",
        )

    # Create team member
    member = TeamMember(
        organization_id=invitation.organization_id,
        user_id=current_user.id,
        role=invitation.role,
        invited_by=invitation.invited_by,
    )
    db.add(member)

    # Mark invitation as accepted
    invitation.accepted_at = invitation.created_at.__class__.utcnow()

    await db.commit()
    await db.refresh(member)

    logger.info(
        "invitation_accepted",
        org_id=invitation.organization_id,
        user_id=current_user.id,
    )

    return TeamMemberResponse.model_validate(member)


# ============================================================================
# Organization Switching
# ============================================================================


@router.post("/{organization_id}/switch", response_model=OrganizationSwitchResponse)
async def switch_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Switch current organization context."""
    # Verify membership
    result = await db.execute(
        select(TeamMember).filter(
            and_(
                TeamMember.organization_id == organization_id,
                TeamMember.user_id == current_user.id,
            )
        )
    )
    membership = result.scalar_one_or_none()

    if not membership:
        raise forbidden_error(
            "You are not a member of this organization",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # In a real implementation, this would update a session or JWT claim
    # For now, we just return success
    logger.info(
        "organization_switched", user_id=current_user.id, org_id=organization_id
    )

    return OrganizationSwitchResponse(
        current_organization_id=organization_id,
        success=True,
        message=f"Switched to organization context",
    )


# ============================================================================
# Organization Projects
# ============================================================================


@router.get("/{organization_id}/projects", response_model=list[Project])
async def list_organization_projects(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """
    List all projects in an organization.

    User must be a member of the organization to view its projects.
    Returns all projects where organization_id matches, regardless of
    individual project access permissions.
    """
    logger.info(
        "list_org_projects_request",
        user_id=current_user.id,
        organization_id=organization_id,
    )

    # Verify user is a member of the organization
    membership = await permission_service.check_organization_membership(
        db, current_user.id, organization_id, "member"
    )
    if not membership:
        raise forbidden_error(
            "You are not a member of this organization",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get all accessible projects for this user
    all_projects = await permission_service.get_user_accessible_projects(
        db, current_user.id
    )

    # Filter to only projects in this organization
    org_projects = [p for p in all_projects if p.organization_id == organization_id]

    # Apply pagination
    paginated_projects = org_projects[skip : skip + limit]

    logger.info(
        "list_org_projects_response",
        organization_id=organization_id,
        project_count=len(paginated_projects),
        total_org_projects=len(org_projects),
    )

    # Convert ORM objects to Pydantic models
    return [Project.model_validate(project) for project in paginated_projects]
