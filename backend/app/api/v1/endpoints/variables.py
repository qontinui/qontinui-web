"""
Workflow Variables API Endpoints

Provides endpoints for managing workflow variables:
- Global variables (project-scoped)
- Workflow variables (workflow-scoped)
- Variable history tracking
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.crud import variable as variable_crud
from app.models.project import Project
from app.models.user import User
from app.schemas.variable import (
    VariableCreate,
    VariableHistoryListResponse,
    VariableHistoryRead,
    VariableListResponse,
    VariableRead,
    VariableScope,
    VariableSnapshot,
    VariableSnapshotResponse,
    VariableUpdate,
)
from app.utils.authorization import verify_project_access

logger = structlog.get_logger(__name__)

router = APIRouter()


# ============================================================================
# Helper Functions
# ============================================================================


async def get_project_or_404(db: AsyncSession, project_id: str) -> Project:
    """Get project or raise 404."""
    result = await db.execute(select(Project).filter(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project


def verify_workflow_ownership(project: Project, workflow_id: str) -> None:
    """
    Verify that a workflow belongs to the project.

    For now, we assume workflow_id is valid if provided.
    In a full implementation, this would query a Workflow model.
    """
    # TODO: Add proper workflow validation when Workflow model exists
    pass


# ============================================================================
# Global Variables (Project-scoped)
# ============================================================================


@router.get("/variables/global", response_model=VariableListResponse)
async def list_global_variables(
    project_id: str = Query(..., description="Project ID"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    List all global variables for a project.

    Global variables are shared across all workflows in the project.

    - **project_id**: Project ID (required query parameter)
    - **skip**: Number of variables to skip (for pagination)
    - **limit**: Maximum number of variables to return (1-500)
    """
    logger.info(
        "list_global_variables",
        project_id=project_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "view variables")

    # List global variables
    project_uuid = UUID(project_id)
    variables, total = await variable_crud.list_variables(
        db, project_uuid, workflow_id=None, skip=skip, limit=limit
    )

    return VariableListResponse(
        variables=[VariableRead.model_validate(v) for v in variables],
        total=total,
    )


@router.post(
    "/variables/global",
    response_model=VariableRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_global_variable(
    variable_data: VariableCreate,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Create a new global variable.

    Global variables are accessible from all workflows in the project.

    - **project_id**: Project ID (required query parameter)
    - **name**: Variable name (alphanumeric and underscore only)
    - **value**: Variable value (must be JSON-serializable)
    - **description**: Optional description
    """
    logger.info(
        "create_global_variable",
        project_id=project_id,
        user_id=current_user.id,
        name=variable_data.name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "create variables")

    # Force scope to GLOBAL
    variable_data.scope = VariableScope.GLOBAL

    # Check if variable already exists
    project_uuid = UUID(project_id)
    existing = await variable_crud.get_variable(
        db, project_uuid, variable_data.name, workflow_id=None
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Global variable '{variable_data.name}' already exists",
        )

    # Create variable
    variable = await variable_crud.create_variable(
        db, variable_data, project_uuid, workflow_id=None
    )

    return VariableRead.model_validate(variable)


@router.get("/variables/global/{name}", response_model=VariableRead)
async def get_global_variable(
    name: str,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get a specific global variable by name.

    - **name**: Variable name
    - **project_id**: Project ID (required query parameter)
    """
    logger.info(
        "get_global_variable",
        project_id=project_id,
        user_id=current_user.id,
        name=name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "view variables")

    # Get variable
    project_uuid = UUID(project_id)
    variable = await variable_crud.get_variable(
        db, project_uuid, name, workflow_id=None
    )

    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Global variable '{name}' not found",
        )

    return VariableRead.model_validate(variable)


@router.put("/variables/global/{name}", response_model=VariableRead)
async def update_global_variable(
    name: str,
    variable_update: VariableUpdate,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Update a global variable.

    - **name**: Variable name
    - **project_id**: Project ID (required query parameter)
    - **value**: New variable value (optional)
    - **description**: New description (optional)
    """
    logger.info(
        "update_global_variable",
        project_id=project_id,
        user_id=current_user.id,
        name=name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "update variables")

    # Get variable
    project_uuid = UUID(project_id)
    variable = await variable_crud.get_variable(
        db, project_uuid, name, workflow_id=None
    )

    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Global variable '{name}' not found",
        )

    # Record old value for history
    old_value = variable.value

    # Update variable
    variable = await variable_crud.update_variable(db, variable, variable_update)

    # Record change in history if value changed
    if variable_update.value is not None and old_value != variable.value:
        await variable_crud.record_variable_change(
            db,
            UUID(str(variable.id)),
            old_value,
            variable.value,
            changed_by_action="manual_update",
        )

    return VariableRead.model_validate(variable)


@router.delete("/variables/global/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_global_variable(
    name: str,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """
    Delete a global variable.

    - **name**: Variable name
    - **project_id**: Project ID (required query parameter)
    """
    logger.info(
        "delete_global_variable",
        project_id=project_id,
        user_id=current_user.id,
        name=name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "delete variables")

    # Get variable
    project_uuid = UUID(project_id)
    variable = await variable_crud.get_variable(
        db, project_uuid, name, workflow_id=None
    )

    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Global variable '{name}' not found",
        )

    # Delete variable
    await variable_crud.delete_variable(db, variable)


# ============================================================================
# Workflow Variables (Workflow-scoped)
# ============================================================================


@router.get("/workflows/{workflow_id}/variables", response_model=VariableListResponse)
async def list_workflow_variables(
    workflow_id: str,
    project_id: str = Query(..., description="Project ID"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    List all variables specific to a workflow.

    Workflow variables are only accessible within the specific workflow.

    - **workflow_id**: Workflow ID
    - **project_id**: Project ID (required query parameter)
    - **skip**: Number of variables to skip (for pagination)
    - **limit**: Maximum number of variables to return (1-500)
    """
    logger.info(
        "list_workflow_variables",
        workflow_id=workflow_id,
        project_id=project_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "view variables")

    # Verify workflow belongs to project
    verify_workflow_ownership(project, workflow_id)

    # List workflow variables
    project_uuid = UUID(project_id)
    workflow_uuid = UUID(workflow_id)
    variables, total = await variable_crud.list_variables(
        db, project_uuid, workflow_id=workflow_uuid, skip=skip, limit=limit
    )

    return VariableListResponse(
        variables=[VariableRead.model_validate(v) for v in variables],
        total=total,
    )


@router.post(
    "/workflows/{workflow_id}/variables",
    response_model=VariableRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow_variable(
    workflow_id: str,
    variable_data: VariableCreate,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Create a new workflow-specific variable.

    Workflow variables are only accessible within the specific workflow.

    - **workflow_id**: Workflow ID
    - **project_id**: Project ID (required query parameter)
    - **name**: Variable name (alphanumeric and underscore only)
    - **value**: Variable value (must be JSON-serializable)
    - **description**: Optional description
    """
    logger.info(
        "create_workflow_variable",
        workflow_id=workflow_id,
        project_id=project_id,
        user_id=current_user.id,
        name=variable_data.name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "create variables")

    # Verify workflow belongs to project
    verify_workflow_ownership(project, workflow_id)

    # Force scope to WORKFLOW
    variable_data.scope = VariableScope.WORKFLOW

    # Check if variable already exists
    project_uuid = UUID(project_id)
    workflow_uuid = UUID(workflow_id)
    existing = await variable_crud.get_variable(
        db, project_uuid, variable_data.name, workflow_id=workflow_uuid
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Workflow variable '{variable_data.name}' already exists",
        )

    # Create variable
    variable = await variable_crud.create_variable(
        db, variable_data, project_uuid, workflow_id=workflow_uuid
    )

    return VariableRead.model_validate(variable)


@router.get("/workflows/{workflow_id}/variables/{name}", response_model=VariableRead)
async def get_workflow_variable(
    workflow_id: str,
    name: str,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get a specific workflow variable by name.

    - **workflow_id**: Workflow ID
    - **name**: Variable name
    - **project_id**: Project ID (required query parameter)
    """
    logger.info(
        "get_workflow_variable",
        workflow_id=workflow_id,
        project_id=project_id,
        user_id=current_user.id,
        name=name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "view variables")

    # Verify workflow belongs to project
    verify_workflow_ownership(project, workflow_id)

    # Get variable
    project_uuid = UUID(project_id)
    workflow_uuid = UUID(workflow_id)
    variable = await variable_crud.get_variable(
        db, project_uuid, name, workflow_id=workflow_uuid
    )

    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow variable '{name}' not found",
        )

    return VariableRead.model_validate(variable)


@router.put("/workflows/{workflow_id}/variables/{name}", response_model=VariableRead)
async def update_workflow_variable(
    workflow_id: str,
    name: str,
    variable_update: VariableUpdate,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Update a workflow variable.

    - **workflow_id**: Workflow ID
    - **name**: Variable name
    - **project_id**: Project ID (required query parameter)
    - **value**: New variable value (optional)
    - **description**: New description (optional)
    """
    logger.info(
        "update_workflow_variable",
        workflow_id=workflow_id,
        project_id=project_id,
        user_id=current_user.id,
        name=name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "update variables")

    # Verify workflow belongs to project
    verify_workflow_ownership(project, workflow_id)

    # Get variable
    project_uuid = UUID(project_id)
    workflow_uuid = UUID(workflow_id)
    variable = await variable_crud.get_variable(
        db, project_uuid, name, workflow_id=workflow_uuid
    )

    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow variable '{name}' not found",
        )

    # Record old value for history
    old_value = variable.value

    # Update variable
    variable = await variable_crud.update_variable(db, variable, variable_update)

    # Record change in history if value changed
    if variable_update.value is not None and old_value != variable.value:
        await variable_crud.record_variable_change(
            db,
            UUID(str(variable.id)),
            old_value,
            variable.value,
            changed_by_action="manual_update",
        )

    return VariableRead.model_validate(variable)


@router.delete(
    "/workflows/{workflow_id}/variables/{name}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_workflow_variable(
    workflow_id: str,
    name: str,
    project_id: str = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """
    Delete a workflow variable.

    - **workflow_id**: Workflow ID
    - **name**: Variable name
    - **project_id**: Project ID (required query parameter)
    """
    logger.info(
        "delete_workflow_variable",
        workflow_id=workflow_id,
        project_id=project_id,
        user_id=current_user.id,
        name=name,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "delete variables")

    # Verify workflow belongs to project
    verify_workflow_ownership(project, workflow_id)

    # Get variable
    project_uuid = UUID(project_id)
    workflow_uuid = UUID(workflow_id)
    variable = await variable_crud.get_variable(
        db, project_uuid, name, workflow_id=workflow_uuid
    )

    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow variable '{name}' not found",
        )

    # Delete variable
    await variable_crud.delete_variable(db, variable)


# ============================================================================
# Variable History
# ============================================================================


@router.get(
    "/variables/{variable_id}/history", response_model=VariableHistoryListResponse
)
async def get_variable_history(
    variable_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get change history for a specific variable.

    Returns all recorded changes to the variable, ordered by most recent first.

    - **variable_id**: Variable ID
    - **skip**: Number of history entries to skip (for pagination)
    - **limit**: Maximum number of history entries to return (1-500)
    """
    logger.info(
        "get_variable_history",
        variable_id=variable_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Get variable to verify it exists and user has access
    variable_uuid = UUID(variable_id)
    variable = await variable_crud.get_variable_by_id(db, variable_uuid)

    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Variable not found",
        )

    # Verify project access
    project = await get_project_or_404(db, str(variable.project_id))
    verify_project_access(project, current_user, "view variable history")

    # Get history
    history, total = await variable_crud.get_variable_history(
        db, variable_uuid, skip=skip, limit=limit
    )

    return VariableHistoryListResponse(
        history=[VariableHistoryRead.model_validate(h) for h in history],
        total=total,
    )


@router.get(
    "/workflow-runs/{run_id}/variables", response_model=VariableSnapshotResponse
)
async def get_run_variables_snapshot(
    run_id: str,
    project_id: str = Query(..., description="Project ID"),
    workflow_id: str = Query(..., description="Workflow ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get a snapshot of all variables available at the time of a workflow run.

    Includes both global (project-scoped) and workflow-scoped variables.

    - **run_id**: Workflow run ID
    - **project_id**: Project ID (required query parameter)
    - **workflow_id**: Workflow ID (required query parameter)
    """
    logger.info(
        "get_run_variables_snapshot",
        run_id=run_id,
        project_id=project_id,
        workflow_id=workflow_id,
        user_id=current_user.id,
    )

    # Verify project exists and user has access
    project = await get_project_or_404(db, project_id)
    verify_project_access(project, current_user, "view variables")

    # Verify workflow belongs to project
    verify_workflow_ownership(project, workflow_id)

    # Get all applicable variables
    project_uuid = UUID(project_id)
    workflow_uuid = UUID(workflow_id)
    variables = await variable_crud.get_run_variables_snapshot(
        db, project_uuid, workflow_uuid
    )

    # Convert to snapshot format
    from datetime import datetime

    snapshots = [
        VariableSnapshot(
            name=str(v.name),
            value=v.value,
            scope=v.scope,  # type: ignore[arg-type]
            description=str(v.description) if v.description else None,
        )
        for v in variables
    ]

    return VariableSnapshotResponse(
        run_id=run_id,
        variables=snapshots,
        timestamp=datetime.utcnow(),
    )


@router.get(
    "/workflow-runs/{run_id}/variable-changes",
    response_model=VariableHistoryListResponse,
)
async def get_run_variable_changes(
    run_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get all variable changes that occurred during a specific workflow run.

    Returns changes ordered by when they occurred during the run.

    - **run_id**: Workflow run ID
    - **skip**: Number of changes to skip (for pagination)
    - **limit**: Maximum number of changes to return (1-500)
    """
    logger.info(
        "get_run_variable_changes",
        run_id=run_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Get variable changes for this run
    run_uuid = UUID(run_id)
    changes, total = await variable_crud.get_run_variable_changes(
        db, run_uuid, skip=skip, limit=limit
    )

    # Verify user has access to the project (by checking first variable if any)
    if changes:
        first_change = changes[0]
        variable = await variable_crud.get_variable_by_id(
            db, UUID(str(first_change.variable_id))
        )
        if variable:
            project = await get_project_or_404(db, str(variable.project_id))
            verify_project_access(project, current_user, "view variable changes")

    return VariableHistoryListResponse(
        history=[VariableHistoryRead.model_validate(c) for c in changes],
        total=total,
    )
