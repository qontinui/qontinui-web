from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.core.error_codes import ErrorCode
from app.middleware.error_handler import not_found_error
from app.models.build_record import BUILD_RECORD_SLUG_PATTERN, BuildRecordSnapshot
from app.models.project import Project as ProjectModel
from app.schemas.project import Project

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
        .where(ProjectModel.is_public.is_(True))
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
        ProjectModel.is_public.is_(True),
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


class PublicBuildRecord(BaseModel):
    """The latest frozen version of a published build record."""

    public_slug: str
    version: int
    published_at: datetime
    content_sha256: str
    document: dict[str, Any]


@router.get("/build-records/{slug}", response_model=PublicBuildRecord)
async def read_public_build_record(
    slug: Annotated[str, Path(pattern=BUILD_RECORD_SLUG_PATTERN)],
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    The latest published snapshot of a product's build record, without
    authentication.

    Serves ONLY rows frozen by ``POST /api/v1/build-records/{slug}/publish``,
    which refuses a product that is not opted in (``is_public``) and
    re-validates the D3 allowlist before storing. It never proxies to coord,
    so the authed export is never reachable from here. 404 when nothing has
    been published under ``slug``.

    ``content_sha256`` is the SHA-256 of ``document`` serialized with sorted
    keys and no insignificant whitespace, so a reader can verify it.
    """
    stmt = (
        select(BuildRecordSnapshot)
        .where(BuildRecordSnapshot.public_slug == slug)
        .order_by(BuildRecordSnapshot.version.desc())
        .limit(1)
    )
    snapshot = (await db.execute(stmt)).scalar_one_or_none()
    if snapshot is None:
        raise not_found_error(
            "Public build record not found",
            ErrorCode.RESOURCE_NOT_FOUND,
        )
    return PublicBuildRecord(
        public_slug=snapshot.public_slug,
        version=snapshot.version,
        published_at=snapshot.published_at,
        content_sha256=snapshot.content_sha256,
        document=snapshot.document,
    )
