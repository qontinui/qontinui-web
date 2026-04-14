"""
Version History API Endpoints

Provides REST API for:
- Listing version history
- Getting specific versions
- Restoring previous versions
- Comparing versions
- Viewing command history
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project
from app.models.organization import PermissionLevel
from app.models.user import User
from app.schemas.version import (EditCommandHistoryResponse,
                                 ProjectVersionListItem,
                                 ProjectVersionResponse,
                                 VersionComparisonResponse,
                                 VersionRestoreRequest, VersionRestoreResponse)
from app.services.event_sourcing_service import EventSourcingService
from app.services.permission_service import permission_service
from app.services.version_history_service import VersionHistoryService
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/{project_id}/versions", response_model=list[ProjectVersionListItem])
async def list_project_versions(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get version history for a project.

    Returns a list of all versions (without full snapshots for efficiency).
    Requires VIEW permission on the project.
    """
    logger.info(
        "list_project_versions_request",
        project_id=project_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Check if project exists
    project = await get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check if user has view access
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to view this project",
        )

    # Get version history
    versions = await VersionHistoryService.get_version_history(
        db, project_id, skip, limit
    )

    logger.info(
        "list_project_versions_response",
        project_id=project_id,
        version_count=len(versions),
    )

    return versions


@router.get(
    "/{project_id}/versions/{version_number}", response_model=ProjectVersionResponse
)
async def get_project_version(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    version_number: int,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a specific version snapshot with full data.

    Requires VIEW permission on the project.
    """
    logger.info(
        "get_project_version_request",
        project_id=project_id,
        version_number=version_number,
        user_id=current_user.id,
    )

    # Check if project exists
    project = await get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check if user has view access
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to view this project",
        )

    # Get version
    version = await VersionHistoryService.get_version(db, project_id, version_number)
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {version_number} not found for this project",
        )

    logger.info(
        "get_project_version_response",
        project_id=project_id,
        version_number=version_number,
    )

    return version


@router.post(
    "/{project_id}/versions/{version_number}/restore",
    response_model=VersionRestoreResponse,
)
async def restore_project_version(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    version_number: int,
    restore_request: VersionRestoreRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Restore a project to a previous version.

    Creates a new version snapshot with the restored state.
    Requires EDIT permission on the project.
    """
    logger.info(
        "restore_project_version_request",
        project_id=project_id,
        version_number=version_number,
        user_id=current_user.id,
    )

    # Check if project exists
    project = await get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check if user has edit access
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to edit this project",
        )

    try:
        # Restore version
        updated_project, new_version = await VersionHistoryService.restore_version(
            db=db,
            project_id=project_id,
            version_number=version_number,
            user_id=current_user.id,
            comment=restore_request.comment,
        )

        logger.info(
            "restore_project_version_success",
            project_id=project_id,
            restored_from=version_number,
            new_version=new_version.version_number,
        )

        return VersionRestoreResponse(
            success=True,
            new_version_number=new_version.version_number,  # type: ignore[arg-type]
            restored_from_version=version_number,
            message=f"Successfully restored project to version {version_number}",
        )

    except ValueError as e:
        logger.error(
            "restore_project_version_failed",
            project_id=project_id,
            version_number=version_number,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.get(
    "/{project_id}/versions/{version_from}/compare/{version_to}",
    response_model=VersionComparisonResponse,
)
async def compare_project_versions(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    version_from: int,
    version_to: int,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Compare two versions and return differences.

    Requires VIEW permission on the project.
    """
    logger.info(
        "compare_project_versions_request",
        project_id=project_id,
        version_from=version_from,
        version_to=version_to,
        user_id=current_user.id,
    )

    # Check if project exists
    project = await get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check if user has view access
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to view this project",
        )

    try:
        # Compare versions
        comparison = await VersionHistoryService.compare_versions(
            db, project_id, version_from, version_to
        )

        logger.info(
            "compare_project_versions_response",
            project_id=project_id,
            version_from=version_from,
            version_to=version_to,
        )

        return comparison

    except ValueError as e:
        logger.error(
            "compare_project_versions_failed",
            project_id=project_id,
            version_from=version_from,
            version_to=version_to,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.get("/{project_id}/commands", response_model=EditCommandHistoryResponse)
async def get_project_command_history(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get command history (event log) for a project.

    Returns all edit commands in sequence order.
    Requires VIEW permission on the project.
    """
    logger.info(
        "get_project_command_history_request",
        project_id=project_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Check if project exists
    project = await get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check if user has view access
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to view this project",
        )

    # Get command history
    history = await EventSourcingService.get_command_history(
        db, project_id, skip, limit
    )

    logger.info(
        "get_project_command_history_response",
        project_id=project_id,
        command_count=len(history.commands),
        total_count=history.total_count,
    )

    return history
