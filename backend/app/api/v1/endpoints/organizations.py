"""
Organizations API — full CRUD for organizations, members, invitations, and statistics.

Uses the existing repository + permission layers directly (no cloud-control dependency).
"""

from typing import Any, cast
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.middleware.error_handler import forbidden_error, not_found_error
from app.models.organization import TeamRole
from app.models.user import User
from app.repositories.organization import (
    invitation_repo,
    organization_repo,
    project_stats_repo,
    team_member_repo,
)
from app.schemas.collaboration import (
    InvitationAccept,
    InvitationCreate,
    InvitationResponse,
    OrganizationCreate,
    OrganizationResponse,
    OrganizationStatistics,
    OrganizationUpdate,
    TeamMemberCreate,
    TeamMemberResponse,
    TeamMemberUpdate,
)
from app.services.coord_helper_provisioning import provision_coord_helper_role
from app.services.organization_service import organization_service
from app.services.permissions.organization_access import (
    can_user_manage_organization,
    check_organization_membership,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


# ============================================================================
# Organization Management
# ============================================================================


@router.post(
    "", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED
)
async def create_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_in: OrganizationCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new organization."""
    slug = organization_in.slug
    if not slug:
        slug = await organization_service._generate_unique_slug(
            db, organization_in.name.lower().replace(" ", "-")
        )
    elif await organization_repo.slug_exists(db, slug):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "SLUG_EXISTS", "message": f"Slug '{slug}' already taken"},
        )

    org = await organization_repo.create(
        db=db,
        name=organization_in.name,
        slug=slug,
        owner_id=current_user.id,
        description=organization_in.description,
    )
    org_id = cast(UUID, org.id)
    member_count = await team_member_repo.count_members(db, org_id)
    logger.info(
        "organization_created", org_id=org_id, slug=slug, user_id=current_user.id
    )
    return _org_response(org, member_count)


@router.get("", response_model=list[OrganizationResponse])
async def list_user_organizations(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List all organizations the current user belongs to."""
    orgs = await organization_repo.list_by_user(
        db, current_user.id, offset=skip, limit=limit
    )
    result = []
    for org in orgs:
        count = await team_member_repo.count_members(db, cast(UUID, org.id))
        result.append(_org_response(org, count))
    return result


@router.get("/{organization_id}", response_model=OrganizationResponse)
async def get_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get organization details. User must be a member."""
    org = await organization_repo.get_by_id(db, organization_id)
    if not org:
        raise not_found_error("Organization", "organization")
    membership = await check_organization_membership(
        db, current_user.id, organization_id
    )
    if not membership:
        raise forbidden_error("You are not a member of this organization")
    count = await team_member_repo.count_members(db, organization_id)
    return _org_response(org, count)


@router.put("/{organization_id}", response_model=OrganizationResponse)
async def update_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    organization_update: OrganizationUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update organization settings. Requires admin role."""
    org = await organization_repo.get_by_id(db, organization_id)
    if not org:
        raise not_found_error("Organization", "organization")
    if not await can_user_manage_organization(
        db, current_user.id, organization_id, TeamRole.ADMIN
    ):
        raise forbidden_error("Admin role required to update organization")

    update_data = organization_update.model_dump(exclude_unset=True)
    org = await organization_repo.update(db, org, update_data)
    count = await team_member_repo.count_members(db, organization_id)
    logger.info("organization_updated", org_id=organization_id, user_id=current_user.id)
    return _org_response(org, count)


@router.delete("/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete organization. Owner only. Cannot delete personal organizations."""
    org = await organization_repo.get_by_id(db, organization_id)
    if not org:
        raise not_found_error("Organization", "organization")
    if org.owner_id != current_user.id:
        raise forbidden_error("Only the organization owner can delete it")
    if org.settings and org.settings.get("is_personal"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "CANNOT_DELETE_PERSONAL",
                "message": "Personal organizations cannot be deleted",
            },
        )
    await organization_repo.delete(db, org)
    logger.info("organization_deleted", org_id=organization_id, user_id=current_user.id)


# ============================================================================
# Team Members
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
    """List organization members. User must be a member."""
    if not await check_organization_membership(db, current_user.id, organization_id):
        raise forbidden_error("You are not a member of this organization")
    members = await team_member_repo.list_by_organization(
        db, organization_id, offset=skip, limit=limit
    )
    return [_member_response(m) for m in members]


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
) -> Any:
    """Add a team member. Requires admin role."""
    if not await can_user_manage_organization(
        db, current_user.id, organization_id, TeamRole.ADMIN
    ):
        raise forbidden_error("Admin role required to add members")
    existing = await team_member_repo.get_membership(
        db, organization_id, member_in.user_id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "ALREADY_MEMBER", "message": "User is already a member"},
        )
    member = await team_member_repo.add_member(
        db,
        organization_id,
        member_in.user_id,
        member_in.role,
        invited_by=current_user.id,
    )
    logger.info(
        "member_added",
        org_id=organization_id,
        user_id=member_in.user_id,
        role=member_in.role,
    )
    return _member_response(member)


@router.put("/{organization_id}/members/{user_id}", response_model=TeamMemberResponse)
async def update_team_member(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    user_id: UUID,
    member_update: TeamMemberUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update team member role. Requires admin role."""
    if not await can_user_manage_organization(
        db, current_user.id, organization_id, TeamRole.ADMIN
    ):
        raise forbidden_error("Admin role required to update members")
    member = await team_member_repo.get_membership(db, organization_id, user_id)
    if not member:
        raise not_found_error("Team member", "user")
    if member.role == TeamRole.OWNER.value and current_user.id != user_id:
        raise forbidden_error("Cannot change the owner's role")
    update_data = member_update.model_dump(exclude_unset=True)
    member = await team_member_repo.update_member(db, member, update_data)
    logger.info("member_updated", org_id=organization_id, user_id=user_id)
    return _member_response(member)


@router.delete(
    "/{organization_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_team_member(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Remove team member. Admin can remove others; any member can remove themselves."""
    is_self = current_user.id == user_id
    if not is_self and not await can_user_manage_organization(
        db, current_user.id, organization_id, TeamRole.ADMIN
    ):
        raise forbidden_error("Admin role required to remove other members")
    member = await team_member_repo.get_membership(db, organization_id, user_id)
    if not member:
        raise not_found_error("Team member", "user")
    if member.role == TeamRole.OWNER.value:
        raise forbidden_error("Cannot remove the organization owner")
    await team_member_repo.remove_member(db, member)
    logger.info(
        "member_removed", org_id=organization_id, user_id=user_id, by=current_user.id
    )


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
    """Create an invitation. Requires admin role."""
    if not await can_user_manage_organization(
        db, current_user.id, organization_id, TeamRole.ADMIN
    ):
        raise forbidden_error("Admin role required to send invitations")
    pending = await invitation_repo.get_pending_by_email(
        db, organization_id, invitation_in.email
    )
    if pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "INVITATION_PENDING",
                "message": "An invitation is already pending for this email",
            },
        )
    org = await organization_repo.get_by_id(db, organization_id)
    invitation = await invitation_repo.create(
        db, organization_id, invitation_in.email, invitation_in.role, current_user.id
    )
    logger.info("invitation_created", org_id=organization_id, email=invitation_in.email)
    return _invitation_response(invitation, org, current_user)


@router.get("/{organization_id}/invitations", response_model=list[InvitationResponse])
async def list_invitations(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List invitations. Requires admin role."""
    if not await can_user_manage_organization(
        db, current_user.id, organization_id, TeamRole.ADMIN
    ):
        raise forbidden_error("Admin role required to view invitations")
    invitations = await invitation_repo.list_by_organization(
        db, organization_id, offset=skip, limit=limit
    )
    org = await organization_repo.get_by_id(db, organization_id)
    return [_invitation_response(inv, org) for inv in invitations]


@router.post("/invitations/accept", response_model=TeamMemberResponse)
async def accept_invitation(
    *,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    invitation_accept: InvitationAccept,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Accept an invitation by token.

    Accepting a HELPER invite additionally attempts a best-effort coord
    ``helper`` operator-role provisioning (helper-task-queue plan §9.4) —
    see ``app.services.coord_helper_provisioning`` for what can and cannot
    succeed today. Provisioning never blocks acceptance.
    """
    invitation = await invitation_repo.get_by_token(db, invitation_accept.token)
    if not invitation:
        raise not_found_error("Invitation")
    if invitation.is_expired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={
                "error": "INVITATION_EXPIRED",
                "message": "This invitation has expired",
            },
        )
    if invitation.is_accepted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "INVITATION_USED",
                "message": "This invitation has already been accepted",
            },
        )
    if invitation.email != current_user.email:
        raise forbidden_error("This invitation was sent to a different email address")
    inv_org_id = cast(UUID, invitation.organization_id)
    existing = await team_member_repo.get_membership(db, inv_org_id, current_user.id)
    if existing:
        await invitation_repo.mark_accepted(db, invitation)
        return _member_response(existing)
    member = await team_member_repo.add_member(
        db,
        inv_org_id,
        current_user.id,
        cast(str, invitation.role),
        invited_by=cast(UUID | None, invitation.invited_by),
    )
    await invitation_repo.mark_accepted(db, invitation)
    logger.info(
        "invitation_accepted",
        org_id=invitation.organization_id,
        user_id=current_user.id,
    )
    if invitation.role == TeamRole.HELPER.value:
        # Best-effort coord `helper` operator-role provisioning — never
        # blocks acceptance; outcome is logged for the operator.
        outcome = await provision_coord_helper_role(request)
        logger.info(
            "helper_invite_coord_provisioning",
            org_id=invitation.organization_id,
            user_id=current_user.id,
            outcome=outcome,
        )
    return _member_response(member)


# ============================================================================
# Statistics
# ============================================================================


@router.get("/{organization_id}/statistics", response_model=OrganizationStatistics)
async def get_organization_statistics(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get organization statistics. User must be a member."""
    if not await check_organization_membership(db, current_user.id, organization_id):
        raise forbidden_error("You are not a member of this organization")
    member_count = await team_member_repo.count_members(db, organization_id)
    project_count = await project_stats_repo.count_by_organization(db, organization_id)
    active_today = await team_member_repo.count_active_today(db, organization_id)
    return OrganizationStatistics(
        member_count=member_count,
        project_count=project_count,
        active_users_today=active_today,
        total_workflows=0,
    )


# ============================================================================
# Helpers
# ============================================================================


def _org_response(org: Any, member_count: int) -> dict:
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "owner_id": org.owner_id,
        "avatar_url": org.avatar_url,
        "settings": org.settings or {},
        "is_active": org.is_active,
        "created_at": org.created_at,
        "updated_at": org.updated_at,
        "member_count": member_count,
    }


def _member_response(member: Any) -> dict:
    user = getattr(member, "user", None)
    return {
        "id": member.id,
        "organization_id": member.organization_id,
        "user_id": member.user_id,
        "role": member.role,
        "permissions": member.permissions or {},
        "invited_by": member.invited_by,
        "joined_at": member.joined_at,
        "last_active_at": member.last_active_at,
        "email": getattr(user, "email", None) if user else None,
        "username": getattr(user, "username", None) if user else None,
        "full_name": getattr(user, "full_name", None) if user else None,
        "avatar_url": getattr(user, "avatar_url", None) if user else None,
    }


def _invitation_response(inv: Any, org: Any = None, inviter: Any = None) -> dict:
    inv_user = inviter or getattr(inv, "inviter", None)
    return {
        "id": inv.id,
        "organization_id": inv.organization_id,
        "email": inv.email,
        "role": inv.role,
        "invited_by": inv.invited_by,
        "token": inv.token,
        "expires_at": inv.expires_at,
        "accepted_at": inv.accepted_at,
        "created_at": inv.created_at,
        "is_expired": inv.is_expired,
        "is_accepted": inv.is_accepted,
        "inviter_username": getattr(inv_user, "username", None) if inv_user else None,
        "inviter_email": getattr(inv_user, "email", None) if inv_user else None,
        "organization_name": getattr(org, "name", None) if org else None,
    }
