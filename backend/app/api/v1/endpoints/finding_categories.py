"""
API endpoints for finding category configurations.

Manages per-user finding categories (built-in + custom).
Categories auto-seed with 13 defaults on first access.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.crud import finding_category_config as crud
from app.models.user import User
from app.schemas.finding_category_config import (
    FindingCategoryConfigCreate,
    FindingCategoryConfigListResponse,
    FindingCategoryConfigResponse,
    FindingCategoryConfigUpdate,
)

router = APIRouter()


@router.get(
    "/",
    response_model=FindingCategoryConfigListResponse,
    summary="List finding categories",
)
async def list_categories(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FindingCategoryConfigListResponse:
    categories = await crud.get_user_categories(db, current_user.id)
    return FindingCategoryConfigListResponse(
        items=[FindingCategoryConfigResponse.model_validate(c) for c in categories],
        count=len(categories),
    )


@router.post(
    "/",
    response_model=FindingCategoryConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom finding category",
)
async def create_category(
    data: FindingCategoryConfigCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FindingCategoryConfigResponse:
    category = await crud.create_category(db, current_user.id, data)
    return FindingCategoryConfigResponse.model_validate(category)


@router.put(
    "/{category_id}",
    response_model=FindingCategoryConfigResponse,
    summary="Update a finding category",
)
async def update_category(
    category_id: UUID,
    data: FindingCategoryConfigUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FindingCategoryConfigResponse:
    category = await crud.update_category(db, current_user.id, category_id, data)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
    return FindingCategoryConfigResponse.model_validate(category)


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a custom finding category",
)
async def delete_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    result = await crud.delete_category(db, current_user.id, category_id)
    if result is True:
        return
    if result == "Category not found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
    if result == "Cannot delete built-in category":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete built-in category",
        )


@router.post(
    "/reset",
    response_model=FindingCategoryConfigListResponse,
    summary="Reset categories to defaults",
)
async def reset_categories(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FindingCategoryConfigListResponse:
    categories = await crud.reset_to_defaults(db, current_user.id)
    return FindingCategoryConfigListResponse(
        items=[FindingCategoryConfigResponse.model_validate(c) for c in categories],
        count=len(categories),
    )
