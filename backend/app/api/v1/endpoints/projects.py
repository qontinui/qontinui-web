from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import (
    create_project,
    delete_project,
    get_project,
    get_projects_by_owner,
    update_project,
)
from app.models.user import User
from app.schemas.project import Project, ProjectCreate, ProjectUpdate
from app.services.limit_checker import LimitChecker
from app.utils.authorization import verify_project_access

router = APIRouter()


@router.get("/", response_model=list[Project])
async def read_projects(
    db: AsyncSession = Depends(get_async_db),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    import structlog

    logger = structlog.get_logger(__name__)
    logger.info("get_projects_request", user_id=current_user.id, skip=skip, limit=limit)

    projects = await get_projects_by_owner(
        db, owner_id=current_user.id, skip=skip, limit=limit
    )

    logger.info(
        "get_projects_response", user_id=current_user.id, project_count=len(projects)
    )
    return projects


@router.post("/", response_model=Project)
async def create_new_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_in: ProjectCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    project = await create_project(
        db,
        project_in,
        owner_id=current_user.id,
        subscription_tier=current_user.subscription_tier,
    )
    return project


@router.get("/{project_id}", response_model=Project)
async def read_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    verify_project_access(project, current_user, "read")
    return project


@router.put("/{project_id}", response_model=Project)
async def update_existing_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    project_update: ProjectUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    # Check if user is in read-only mode
    is_read_only, reason = await LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is in read-only mode. {reason}. Upgrade your plan to continue editing.",
        )

    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    verify_project_access(project, current_user, "update")
    project = await update_project(db, project, project_update)
    return project


@router.delete("/{project_id}")
async def delete_existing_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    # Check if user is in read-only mode
    is_read_only, reason = await LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        # Allow deletion even in read-only mode (helps users get back under limits)
        pass

    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    verify_project_access(project, current_user, "delete")
    success = await delete_project(db, project_id=project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete project",
        )
    return {"message": "Project deleted successfully"}
