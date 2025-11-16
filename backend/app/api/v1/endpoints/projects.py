from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import (
    create_project,
    delete_project,
    get_project,
    get_projects_by_owner,
    update_project,
)
from app.models.organization import PermissionLevel, TeamRole
from app.models.user import User
from app.schemas.project import Project, ProjectCreate, ProjectUpdate
from app.services.limit_checker import LimitChecker
from app.services.object_storage import object_storage
from app.services.permission_service import permission_service
from app.services.storage_service import StorageService

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/", response_model=list[Project])
async def read_projects(
    db: AsyncSession = Depends(get_async_db),
    skip: int = 0,
    limit: int = 100,
    organization_id: UUID | None = Query(None, description="Filter by organization ID"),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get all projects accessible to the current user.

    Returns projects where user has access via:
    - Direct ownership
    - Direct user access
    - Organization membership

    Optionally filter by organization_id to only return projects in that organization.
    """
    logger.info(
        "get_projects_request",
        user_id=current_user.id,
        skip=skip,
        limit=limit,
        organization_id=organization_id,
    )

    # If organization_id is specified, verify user is a member
    if organization_id:
        membership = await permission_service.check_organization_membership(
            db, current_user.id, organization_id, "member"
        )
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this organization",
            )

    # Get all accessible projects using permission service
    projects = await permission_service.get_user_accessible_projects(db, current_user.id)

    # Filter by organization if specified
    if organization_id:
        projects = [p for p in projects if p.organization_id == organization_id]

    # Apply pagination
    paginated_projects = projects[skip : skip + limit]

    logger.info(
        "get_projects_response",
        user_id=current_user.id,
        project_count=len(paginated_projects),
        total_accessible=len(projects),
    )
    # Convert ORM objects to Pydantic models so field_serializer can run
    return [Project.model_validate(project) for project in paginated_projects]


@router.post("/", response_model=Project)
async def create_new_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_in: ProjectCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Create a new project.

    If organization_id is provided:
    - Validates user is a member of that organization
    - Creates project in that organization

    If organization_id is not provided:
    - Uses user's personal organization
    """
    logger.info(
        "create_project_request",
        user_id=current_user.id,
        organization_id=project_in.organization_id,
        project_name=project_in.name,
    )

    # Determine which organization to use
    organization_id = project_in.organization_id
    if organization_id:
        # Validate user has permission to create projects in this org
        membership = await permission_service.check_organization_membership(
            db, current_user.id, organization_id, "member"
        )
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to create projects in this organization",
            )
    else:
        # Use user's personal organization
        personal_org = await permission_service.get_personal_organization(
            db, current_user.id
        )
        if not personal_org:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Personal organization not found. Please contact support.",
            )
        organization_id = personal_org.id

    # Create the project
    project = await create_project(
        db,
        project_in,
        owner_id=current_user.id,
        subscription_tier=current_user.subscription_tier,
        organization_id=organization_id,
    )

    logger.info(
        "create_project_success",
        user_id=current_user.id,
        project_id=project.id,
        organization_id=organization_id,
    )

    return project


@router.get("/{project_id}", response_model=Project)
async def read_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a single project by ID.

    Checks user has view permission before returning the project.
    """
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    # Check if user has view access to this project
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to view this project",
        )

    return project


@router.put("/{project_id}", response_model=Project)
async def update_existing_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    project_update: ProjectUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Update a project.

    Requires edit permission on the project.
    """
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

    # Check if user has edit access to this project
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to edit this project",
        )

    project = await update_project(db, project, project_update)
    return project


@router.delete("/{project_id}")
async def delete_existing_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Delete a project.

    Requires admin permission on the project (typically only owner has this).
    """
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

    # Check if user has admin access to this project
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.ADMIN
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to delete this project",
        )

    # Get all image s3_keys from configuration
    config = project.configuration or {}
    images = config.get("images", [])

    # Delete all images from S3
    deleted_count = 0
    for image in images:
        s3_key = image.get("s3_key")
        if s3_key:
            try:
                # Delete from S3
                object_storage.delete_file(s3_key)
                # Update storage tracking
                await StorageService.delete_file_record(db, s3_key, current_user.id)
                deleted_count += 1
            except Exception as e:
                logger.error("image_deletion_failed", s3_key=s3_key, error=str(e))
                # Continue with other deletions

    logger.info("project_images_deleted", project_id=project_id, deleted_count=deleted_count)

    success = await delete_project(db, project_id=project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete project",
        )
    return {"message": "Project deleted successfully"}
