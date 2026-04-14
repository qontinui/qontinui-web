"""Skill CRUD API endpoints."""

from uuid import UUID

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.services.permissions.organization_access import check_organization_membership
from app.services.skill_service import (
    SkillCreate,
    SkillListResponse,
    SkillResponse,
    SkillService,
    SkillUpdate,
)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


def get_service() -> SkillService:
    return SkillService()


@router.post(
    "",
    response_model=SkillResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a skill",
)
async def create_skill(
    data: SkillCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillResponse:
    return await service.create_skill(db, data, current_user.id)


@router.get(
    "",
    response_model=SkillListResponse,
    summary="List skills",
)
async def list_skills(
    category: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillListResponse:
    return await service.list_skills(db, current_user.id, category, offset, limit)


@router.get(
    "/search",
    response_model=list[SkillResponse],
    summary="Search skills",
)
async def search_skills(
    q: str = Query(""),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> list[SkillResponse]:
    return await service.search_skills(db, q, current_user.id)


@router.get(
    "/marketplace",
    response_model=SkillListResponse,
    summary="Browse community skill marketplace",
)
async def list_marketplace_skills(
    category: str | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_async_db),
    service: SkillService = Depends(get_service),
) -> SkillListResponse:
    """Browse all shared and approved skills across organizations."""
    return await service.list_marketplace_skills(
        db, category=category, search=search, offset=offset, limit=limit
    )


@router.get(
    "/{skill_id}",
    response_model=SkillResponse,
    summary="Get a skill",
)
async def get_skill(
    skill_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillResponse:
    try:
        return await service.get_skill(db, skill_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill not found: {skill_id}",
        )


@router.put(
    "/{skill_id}",
    response_model=SkillResponse,
    summary="Update a skill",
)
async def update_skill(
    skill_id: UUID,
    data: SkillUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillResponse:
    try:
        return await service.update_skill(db, skill_id, data)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill not found: {skill_id}",
        )


@router.delete(
    "/{skill_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a skill",
)
async def delete_skill(
    skill_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> None:
    deleted = await service.delete_skill(db, skill_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill not found: {skill_id}",
        )


class ShareSkillRequest(BaseModel):
    is_shared: bool


class ApproveSkillRequest(BaseModel):
    status: str  # "approved" | "rejected" | "pending"


class ForkSkillRequest(BaseModel):
    new_name: str | None = None


@router.post(
    "/{skill_id}/share",
    response_model=SkillResponse,
    summary="Toggle skill sharing",
)
async def share_skill(
    skill_id: UUID,
    data: ShareSkillRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillResponse:
    try:
        return await service.share_skill(db, skill_id, current_user.id, data.is_shared)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill not found or not owned by user: {skill_id}",
        )


@router.post(
    "/{skill_id}/approve",
    response_model=SkillResponse,
    summary="Set approval status for a skill",
)
async def approve_skill(
    skill_id: UUID,
    data: ApproveSkillRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillResponse:
    """Set approval status for a skill. Requires admin or owner role in the org."""
    valid_statuses = {"approved", "rejected", "pending"}
    if data.status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(valid_statuses))}",
        )

    # Get the skill to find its organization
    try:
        skill = await service.get_skill(db, skill_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    # If the skill belongs to an organization, enforce role-based access
    if skill.organization_id:
        membership = await check_organization_membership(
            db,
            current_user.id,
            UUID(skill.organization_id),
            required_role="admin",
        )
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only organization admins and owners can approve skills",
            )
    else:
        # No org: only the skill creator can change approval status
        if str(current_user.id) != skill.created_by_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the skill owner can change approval status",
            )

    try:
        return await service.approve_skill(db, skill_id, data.status)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{skill_id}/fork",
    response_model=SkillResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Fork a skill",
)
async def fork_skill(
    skill_id: UUID,
    data: ForkSkillRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillResponse:
    """Fork a skill — create a personal copy."""
    try:
        return await service.fork_skill(db, skill_id, current_user.id, data.new_name)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{skill_id}/increment-usage",
    summary="Track skill usage",
)
async def increment_usage(
    skill_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> dict:
    """Track skill usage."""
    try:
        return await service.increment_usage(db, skill_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/org/{organization_id}",
    response_model=SkillListResponse,
    summary="List organization shared skills",
)
async def list_org_skills(
    organization_id: UUID,
    category: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: SkillService = Depends(get_service),
) -> SkillListResponse:
    return await service.list_org_skills(db, organization_id, category, offset, limit)
