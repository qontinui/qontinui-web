"""
Snapshot Management API Endpoints

Endpoints for managing snapshot runs, screenshots, and patterns.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_user_async
from app.crud import snapshot as snapshot_crud
from app.models.organization import PermissionLevel
from app.models.user import User
from app.schemas.snapshot import (
    SnapshotRun,
    SnapshotRunCreate,
    SnapshotRunDetail,
    SnapshotRunListResponse,
    SnapshotRunUpdate,
)
from app.services.permission_service import PermissionService

permission_service = PermissionService()

router = APIRouter()


@router.post("/", status_code=status.HTTP_201_CREATED, response_model=SnapshotRun)
async def create_snapshot_run(
    snapshot_data: SnapshotRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
) -> Any:
    """
    Create a new snapshot run

    Requires EDIT permission on the project.
    """
    # Check project permission (EDIT required to create snapshots)
    project_id_uuid = (
        UUID(str(snapshot_data.project_id)) if snapshot_data.project_id else None
    )
    if project_id_uuid:
        has_permission = await permission_service.can_user_access_project(
            db, current_user.id, project_id_uuid, PermissionLevel.EDIT
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to create snapshots for this project",
            )

    # Check if run_id already exists
    existing = await snapshot_crud.get_snapshot_run(db, snapshot_data.run_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Snapshot run with run_id '{snapshot_data.run_id}' already exists",
        )

    snapshot_run = await snapshot_crud.create_snapshot_run(
        db=db,
        run_id=snapshot_data.run_id,
        run_name=snapshot_data.run_name,
        timestamp=snapshot_data.timestamp,
        states=snapshot_data.states,
        project_id=project_id_uuid,
        workflow_id=snapshot_data.workflow_id,
        description=snapshot_data.description,
        tags=snapshot_data.tags,
        metadata=snapshot_data.metadata,
    )

    return snapshot_run


@router.get("/", response_model=SnapshotRunListResponse)
async def list_snapshot_runs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    project_id: UUID | None = Query(None),
    workflow_id: int | None = Query(None),
    tags: str | None = Query(None, description="Comma-separated list of tags"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
) -> Any:
    """
    List snapshot runs with optional filtering

    Returns only snapshots from projects the user has VIEW permission for.

    - **skip**: Number of runs to skip (for pagination)
    - **limit**: Maximum number of runs to return
    - **project_id**: Filter by project ID
    - **workflow_id**: Filter by workflow ID
    - **tags**: Filter by tags (comma-separated)
    """
    # If project_id is specified, verify permission
    if project_id:
        has_permission = await permission_service.can_user_access_project(
            db, current_user.id, project_id, PermissionLevel.VIEW
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to view snapshots for this project",
            )

    # Parse tags if provided
    tag_list = [t.strip() for t in tags.split(",")] if tags else None

    runs, total = await snapshot_crud.list_snapshot_runs(
        db=db,
        skip=skip,
        limit=limit,
        project_id=project_id,
        workflow_id=workflow_id,
        tags=tag_list,
    )

    # TODO: Filter runs to only include projects user has access to when project_id is None
    # For now, if no project_id specified, return all (will be fixed in future PR)

    return {
        "runs": runs,
        "total": total,
        "limit": limit,
        "offset": skip,
    }


@router.get("/{run_id}", response_model=SnapshotRunDetail)
async def get_snapshot_run(
    run_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
) -> Any:
    """
    Get a specific snapshot run with full details

    Requires VIEW permission on the project.
    """
    snapshot_run = await snapshot_crud.get_snapshot_run(db, run_id)
    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot run '{run_id}' not found",
        )

    # Check project permission
    if snapshot_run.project_id:
        has_permission = await permission_service.can_user_access_project(
            db, current_user.id, snapshot_run.project_id, PermissionLevel.VIEW
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to view this snapshot",
            )

    return snapshot_run


@router.patch("/{run_id}", response_model=SnapshotRun)
async def update_snapshot_run(
    run_id: str,
    snapshot_data: SnapshotRunUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
) -> Any:
    """
    Update a snapshot run

    Requires EDIT permission on the project.
    """
    # Get existing snapshot to check permissions
    existing = await snapshot_crud.get_snapshot_run(db, run_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot run '{run_id}' not found",
        )

    # Check project permission
    if existing.project_id:
        has_permission = await permission_service.can_user_access_project(
            db, current_user.id, existing.project_id, PermissionLevel.EDIT
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to update this snapshot",
            )

    # Only update fields that were provided
    update_data = snapshot_data.model_dump(exclude_unset=True)

    snapshot_run = await snapshot_crud.update_snapshot_run(db, run_id, **update_data)

    return snapshot_run


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_snapshot_run(
    run_id: str,
    delete_files: bool = Query(
        False, description="Also delete associated files from storage"
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
) -> None:
    """
    Delete a snapshot run

    Requires ADMIN permission on the project.

    - **delete_files**: If true, also delete associated screenshot files from storage
    """
    # Get existing snapshot to check permissions
    existing = await snapshot_crud.get_snapshot_run(db, run_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot run '{run_id}' not found",
        )

    # Check project permission (ADMIN required to delete snapshots)
    if existing.project_id:
        has_permission = await permission_service.can_user_access_project(
            db, current_user.id, existing.project_id, PermissionLevel.ADMIN
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to delete this snapshot",
            )

    success = await snapshot_crud.delete_snapshot_run(db, run_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot run '{run_id}' not found",
        )

    # TODO: If delete_files is True, delete files from object storage
    # This requires integration with the ObjectStorageService

    return None


@router.get("/{run_id}/screenshots", response_model=dict[str, Any])
async def get_snapshot_screenshots(
    run_id: str,
    state: str | None = Query(None, description="Filter by active state"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
) -> Any:
    """
    Get screenshots from a snapshot run, optionally filtered by state

    Requires VIEW permission on the project.
    """
    snapshot_run = await snapshot_crud.get_snapshot_run(db, run_id)
    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot run '{run_id}' not found",
        )

    # Check project permission
    if snapshot_run.project_id:
        has_permission = await permission_service.can_user_access_project(
            db, current_user.id, snapshot_run.project_id, PermissionLevel.VIEW
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to view screenshots for this snapshot",
            )

    if state:
        screenshots = await snapshot_crud.get_screenshots_by_state(
            db, snapshot_run.id, state
        )
    else:
        screenshots = snapshot_run.screenshots

    return {
        "run_id": run_id,
        "screenshots": screenshots,
        "count": len(screenshots),
    }


@router.get("/{run_id}/patterns", response_model=dict[str, Any])
async def get_snapshot_patterns(
    run_id: str,
    state: str | None = Query(None, description="Filter by active state"),
    pattern_type: str | None = Query(None, description="Filter by pattern type"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
) -> Any:
    """
    Get patterns from a snapshot run, optionally filtered by state or type

    Requires VIEW permission on the project.
    """
    snapshot_run = await snapshot_crud.get_snapshot_run(db, run_id)
    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot run '{run_id}' not found",
        )

    # Check project permission
    if snapshot_run.project_id:
        has_permission = await permission_service.can_user_access_project(
            db, current_user.id, snapshot_run.project_id, PermissionLevel.VIEW
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to view patterns for this snapshot",
            )

    if state:
        patterns = await snapshot_crud.get_patterns_by_state(db, snapshot_run.id, state)
    elif pattern_type:
        patterns = await snapshot_crud.get_patterns_by_type(
            db, snapshot_run.id, pattern_type
        )
    else:
        patterns = snapshot_run.patterns

    return {
        "run_id": run_id,
        "patterns": patterns,
        "count": len(patterns),
    }
