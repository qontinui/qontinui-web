from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.core.error_codes import ErrorCode
from app.crud.project import (
    VersionConflictError,
    create_project,
    delete_project,
    get_project,
    update_project,
)
from app.middleware.error_handler import forbidden_error, not_found_error
from app.models.organization import PermissionLevel
from app.models.user import User
from app.schemas.project import Project, ProjectCreate, ProjectUpdate
from app.services.limit_checker import LimitChecker
from app.services.object_storage import object_storage
from app.services.permission_service import permission_service
from app.services.storage_service import StorageService
from app.utils.lock_utils import check_resource_lock, get_lock_info

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("", response_model=list[Project])
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
            raise forbidden_error(
                "You are not a member of this organization",
                ErrorCode.INSUFFICIENT_PERMISSIONS,
            )

    # Get all accessible projects using permission service
    projects = await permission_service.get_user_accessible_projects(
        db, current_user.id
    )

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


@router.post(
    "",
    response_model=Project,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {
            "description": "Project created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "id": "123e4567-e89b-12d3-a456-426614174000",
                        "name": "My Test Project",
                        "description": "Project for testing automation",
                        "owner_id": "123e4567-e89b-12d3-a456-426614174000",
                        "organization_id": "789e4567-e89b-12d3-a456-426614174000",
                        "created_at": "2024-01-15T10:30:00Z",
                        "updated_at": "2024-01-15T10:30:00Z",
                        "configuration": {},
                    }
                }
            },
        },
        400: {
            "description": "Invalid request data",
            "content": {
                "application/json": {"example": {"detail": "Project name is required"}}
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        403: {
            "description": "Insufficient permissions",
            "content": {
                "application/json": {
                    "example": {
                        "detail": "You do not have permission to create projects in this organization"
                    }
                }
            },
        },
        429: {
            "description": "Rate limit exceeded",
            "content": {
                "application/json": {
                    "example": {"detail": "Too many requests. Please try again later."}
                }
            },
        },
    },
)
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
            raise forbidden_error(
                "You do not have permission to create projects in this organization",
                ErrorCode.INSUFFICIENT_PERMISSIONS,
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
        organization_id = personal_org.id  # type: ignore[assignment]

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

    # Send admin notification for new project creation
    from app.services.admin_notification_service import admin_notification_service

    try:
        await admin_notification_service.notify_project_created(
            db=db,
            project_name=str(project.name),
            project_id=project.id,  # type: ignore[arg-type]
            owner_email=current_user.email,
            owner_username=current_user.username,
            owner_id=current_user.id,  # type: ignore[arg-type]
        )
    except Exception as e:
        # Don't fail project creation if admin notification fails
        logger.error(
            "admin_notification_project_created_failed",
            error=str(e),
            project_id=str(project.id),
        )

    return project


@router.get(
    "/{project_id}",
    response_model=Project,
    responses={
        200: {
            "description": "Project retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "id": "123e4567-e89b-12d3-a456-426614174000",
                        "name": "My Test Project",
                        "description": "Project for testing automation",
                        "owner_id": "123e4567-e89b-12d3-a456-426614174000",
                        "organization_id": "789e4567-e89b-12d3-a456-426614174000",
                        "created_at": "2024-01-15T10:30:00Z",
                        "updated_at": "2024-01-15T10:30:00Z",
                        "configuration": {
                            "images": [],
                            "settings": {},
                        },
                    }
                }
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        403: {
            "description": "Insufficient permissions",
            "content": {
                "application/json": {
                    "example": {"detail": "Not enough permissions to view this project"}
                }
            },
        },
        404: {
            "description": "Project not found",
            "content": {
                "application/json": {"example": {"detail": "Project not found"}}
            },
        },
    },
)
async def read_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a single project by ID.

    Checks user has view permission before returning the project.
    """
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check if user has view access to this project
    # Return 404 instead of 403 to prevent timing attacks that reveal project existence
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise not_found_error("Project", "project")

    return project


@router.put(
    "/{project_id}",
    response_model=Project,
    responses={
        409: {
            "description": "Version conflict - project was modified since last load",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "message": "Version conflict: project was modified",
                            "expected_version": 5,
                            "current_version": 6,
                        }
                    }
                }
            },
        },
    },
)
async def update_existing_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    project_update: ProjectUpdate,
    expected_version: int | None = Query(
        None,
        description="Expected version for conditional update. If provided, update fails with 409 if version mismatch.",
    ),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Update a project.

    Requires edit permission on the project.
    Checks if project is locked by another user before allowing updates.

    If expected_version is provided, performs a conditional update:
    - Update succeeds only if current version matches expected_version
    - Returns 409 Conflict with current version if mismatch
    - This enables optimistic concurrency control
    """
    logger.info(
        "update_project_request",
        project_id=str(project_id),
        user_id=str(current_user.id),
        update_fields=project_update.model_dump(exclude_unset=True),
    )

    try:
        # Check if user is in read-only mode
        logger.debug("update_project_checking_read_only")
        is_read_only, reason = await LimitChecker.is_read_only(
            db, current_user.id, current_user.subscription_tier
        )
        if is_read_only:
            raise forbidden_error(
                f"Account is in read-only mode. {reason}. Upgrade your plan to continue editing.",
                ErrorCode.ACCOUNT_READ_ONLY,
            )

        logger.debug("update_project_getting_project")
        project = await get_project(db, project_id=project_id)
        if not project:
            raise not_found_error("Project", "project")

        # Check if user has edit access to this project
        # Return 404 instead of 403 to prevent timing attacks that reveal project existence
        logger.debug("update_project_checking_access")
        has_access = await permission_service.can_user_access_project(
            db, current_user.id, project_id, PermissionLevel.EDIT
        )
        if not has_access:
            raise not_found_error("Project", "project")

        # Check if project is locked by another user
        logger.debug("update_project_checking_lock")
        can_modify, lock = await check_resource_lock(
            db=db,
            user_id=current_user.id,
            project_id=project_id,
            resource_type="project",
            resource_id=str(project_id),
        )

        if not can_modify and lock:
            # Project is locked by another user
            lock_info = await get_lock_info(lock, db)
            logger.warning(
                "project_update_blocked_by_lock",
                project_id=project_id,
                user_id=current_user.id,
                lock_holder=lock_info.get("locked_by_id"),
            )
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail={
                    "message": "Project is currently locked by another user",
                    "lock_info": lock_info,
                },
            )

        logger.debug("update_project_calling_update")
        try:
            updated_project = await update_project(
                db, project, project_update, expected_version=expected_version
            )
        except VersionConflictError as e:
            logger.warning(
                "update_project_version_conflict",
                project_id=str(project_id),
                expected_version=e.expected,
                current_version=e.current,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Version conflict: project was modified",
                    "expected_version": e.expected,
                    "current_version": e.current,
                },
            )
        logger.info("update_project_success", project_id=str(project_id))

        # Explicitly convert to Pydantic model for serialization
        logger.debug("update_project_serializing")
        result = Project.model_validate(updated_project)
        logger.debug("update_project_serialization_complete")
        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        error_traceback = traceback.format_exc()
        logger.error(
            "update_project_error",
            project_id=str(project_id),
            error=str(e),
            error_type=type(e).__name__,
            traceback=error_traceback,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update project: {str(e)}",
        )


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_200_OK,
    responses={
        200: {
            "description": "Project deleted successfully",
            "content": {
                "application/json": {
                    "example": {"message": "Project deleted successfully"}
                }
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        403: {
            "description": "Insufficient permissions",
            "content": {
                "application/json": {
                    "example": {
                        "detail": "Not enough permissions to delete this project"
                    }
                }
            },
        },
        404: {
            "description": "Project not found",
            "content": {
                "application/json": {"example": {"detail": "Project not found"}}
            },
        },
    },
)
async def delete_existing_project(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
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
        raise not_found_error("Project", "project")

    # Check if user has admin access to this project
    # Return 404 instead of 403 to prevent timing attacks that reveal project existence
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.ADMIN
    )
    if not has_access:
        raise not_found_error("Project", "project")

    # Get all image s3_keys from configuration
    config: dict[str, Any] = (
        dict(project.configuration) if project.configuration else {}
    )
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

    logger.info(
        "project_images_deleted", project_id=project_id, deleted_count=deleted_count
    )

    success = await delete_project(db, project_id=project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete project",
        )
    return {"message": "Project deleted successfully"}
