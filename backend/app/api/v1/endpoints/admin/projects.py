"""Admin project management endpoints."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.v1.endpoints.admin.dependencies import require_admin
from app.models.user import User
from app.repositories.admin_project import admin_project_repository
from app.schemas.admin import AdminProjectData

router = APIRouter()


@router.get("/projects", response_model=list[AdminProjectData])
async def get_all_projects(
    skip: int = 0,
    limit: int = 1000,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> list[AdminProjectData]:
    """Get all projects across all users."""
    projects_data = await admin_project_repository.list_all_projects(
        db, skip=skip, limit=limit
    )

    return [
        AdminProjectData(
            id=project["id"],
            name=project["name"],
            description=project["description"],
            owner_id=project["owner_id"],
            owner_username=project["owner_username"],
            owner_email=project["owner_email"],
            created_at=project["created_at"],
            updated_at=project["updated_at"],
            state_count=project["state_count"],
            transition_count=project["transition_count"],
        )
        for project in projects_data
    ]


@router.get("/projects/{project_id}")
async def get_project_details(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get detailed information about a specific project including full configuration."""
    project_data = await admin_project_repository.get_project_with_details(
        db, project_id
    )

    if not project_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project_data
