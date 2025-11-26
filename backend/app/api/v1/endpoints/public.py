from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db
from app.core.error_codes import ErrorCode
from app.middleware.error_handler import not_found_error
from app.models.project import Project as ProjectModel
from app.schemas.project import Project
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/projects", response_model=list[Project])
async def read_public_projects(
    db: AsyncSession = Depends(get_async_db),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Get all public projects without authentication.

    This endpoint allows anyone to browse public demo projects.
    """
    logger.info("get_public_projects_request", skip=skip, limit=limit)

    # Query for public projects
    stmt = (
        select(ProjectModel)
        .where(ProjectModel.is_public == True)
        .offset(skip)
        .limit(limit)
        .order_by(ProjectModel.updated_at.desc())
    )

    result = await db.execute(stmt)
    projects = result.scalars().all()

    logger.info("get_public_projects_response", project_count=len(projects))

    return [Project.model_validate(project) for project in projects]


@router.get("/projects/{project_id}", response_model=Project)
async def read_public_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Get a specific public project by ID without authentication.

    Returns 404 if project doesn't exist or is not public.
    """
    logger.info("get_public_project_request", project_id=project_id)

    # Query for specific public project
    stmt = select(ProjectModel).where(
        ProjectModel.id == project_id,
        ProjectModel.is_public == True,
    )

    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise not_found_error(
            "Public project not found",
            ErrorCode.PROJECT_NOT_FOUND,
        )

    logger.info(
        "get_public_project_response", project_id=project_id, project_name=project.name
    )

    return Project.model_validate(project)
