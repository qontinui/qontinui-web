"""
Organizations API endpoints for team collaboration.

Provides endpoints for:
- Creating and managing organizations
- Managing team members
- Sending and accepting invitations
- Switching organization context
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.middleware.rate_limit import user_limiter
from app.models.user import User
from app.schemas.collaboration import (InvitationAccept, InvitationCreate,
                                       InvitationResponse, OrganizationCreate,
                                       OrganizationResponse,
                                       OrganizationStatistics,
                                       OrganizationSwitchResponse,
                                       OrganizationUpdate, TeamMemberCreate,
                                       TeamMemberResponse, TeamMemberUpdate)
from app.schemas.project import Project
from app.services.organization import (membership_service,
                                       organization_settings_service,
                                       statistics_service)
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


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
    db: AsyncSession = Depends(get_async_db),
    organization_in: OrganizationCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new organization."""
    return await organization_settings_service.create_organization(
        db=db,
        organization_in=organization_in,
        owner_id=current_user.id,
    )


@router.get("", response_model=list[OrganizationResponse])
async def list_user_organizations(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> Any:
    """List all organizations the user is a member of."""
    return await organization_settings_service.list_user_organizations(
        db=db,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )


@router.get("/{organization_id}", response_model=OrganizationResponse)
async def get_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get organization details."""
    return await organization_settings_service.get_organization(
        db=db,
        org_id=organization_id,
        user_id=current_user.id,
    )


@router.put("/{organization_id}", response_model=OrganizationResponse)
async def update_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    organization_update: OrganizationUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update organization (admin only)."""
    return await organization_settings_service.update_organization(
        db=db,
        org_id=organization_id,
        organization_update=organization_update,
        user_id=current_user.id,
    )


@router.delete("/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete organization (owner only)."""
    await organization_settings_service.delete_organization(
        db=db,
        org_id=organization_id,
        user_id=current_user.id,
    )


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
    return await membership_service.list_members(
        db=db,
        org_id=organization_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )


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
    return await membership_service.add_member(
        db=db,
        org_id=organization_id,
        member_in=member_in,
        current_user_id=current_user.id,
        request=request,
    )


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
    return await membership_service.update_member(
        db=db,
        org_id=organization_id,
        target_user_id=user_id,
        update_data=member_update,
        current_user_id=current_user.id,
        request=request,
    )


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
    await membership_service.remove_member(
        db=db,
        org_id=organization_id,
        target_user_id=user_id,
        current_user_id=current_user.id,
        request=request,
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
    """Create and send an organization invitation (admin only)."""
    return await membership_service.create_invitation(
        db=db,
        org_id=organization_id,
        invitation_in=invitation_in,
        current_user_id=current_user.id,
        current_user_username=current_user.username,
        current_user_email=current_user.email,
    )


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
    return await membership_service.list_invitations(
        db=db,
        org_id=organization_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )


@router.post("/invitations/accept", response_model=TeamMemberResponse)
async def accept_invitation(
    *,
    db: AsyncSession = Depends(get_async_db),
    invitation_accept: InvitationAccept,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Accept an organization invitation."""
    return await membership_service.accept_invitation(
        db=db,
        token=invitation_accept.token,
        user_id=current_user.id,
        user_email=current_user.email,
    )


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
    await membership_service.switch_organization(
        db=db,
        org_id=organization_id,
        user_id=current_user.id,
    )

    return OrganizationSwitchResponse(
        current_organization_id=organization_id,
        success=True,
        message="Switched to organization context",
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
    projects = await statistics_service.list_organization_projects(
        db=db,
        org_id=organization_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    return [Project.model_validate(project) for project in projects]


# ============================================================================
# Organization Statistics
# ============================================================================


@router.get("/{organization_id}/statistics", response_model=OrganizationStatistics)
async def get_organization_statistics(
    *,
    db: AsyncSession = Depends(get_async_db),
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get statistics for an organization.

    Returns member count, project count, active users today, and total workflows.
    User must be a member of the organization to view statistics.
    """
    return await statistics_service.get_organization_statistics(
        db=db,
        org_id=organization_id,
        user_id=current_user.id,
    )
