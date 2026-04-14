"""
API endpoints for workflow step type configurations.

Manages per-user step types, GUI action types, and workflow phases.
All three auto-seed with built-in defaults on first access.
"""

from uuid import UUID

from app.api.deps import current_active_user, get_async_db
from app.crud import workflow_step_type as crud
from app.models.user import User
from app.schemas.workflow_step_type import (GuiActionTypeConfigCreate,
                                            GuiActionTypeConfigListResponse,
                                            GuiActionTypeConfigResponse,
                                            GuiActionTypeConfigUpdate,
                                            StepTypeConfigCreate,
                                            StepTypeConfigListResponse,
                                            StepTypeConfigResponse,
                                            StepTypeConfigUpdate,
                                            WorkflowPhaseConfigListResponse,
                                            WorkflowPhaseConfigResponse,
                                            WorkflowPhaseConfigUpdate)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


# ─── Step Types ──────────────────────────────────────────────────────────────


@router.get(
    "/step-types",
    response_model=StepTypeConfigListResponse,
    summary="List step types",
)
async def list_step_types(
    phase: str | None = Query(None, description="Filter by phase"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> StepTypeConfigListResponse:
    items = await crud.get_user_step_types(db, current_user.id, phase)
    return StepTypeConfigListResponse(
        items=[StepTypeConfigResponse.model_validate(i) for i in items],
        count=len(items),
    )


@router.post(
    "/step-types",
    response_model=StepTypeConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom step type",
)
async def create_step_type(
    data: StepTypeConfigCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> StepTypeConfigResponse:
    item = await crud.create_step_type(db, current_user.id, data)
    return StepTypeConfigResponse.model_validate(item)


@router.put(
    "/step-types/{config_id}",
    response_model=StepTypeConfigResponse,
    summary="Update a step type",
)
async def update_step_type(
    config_id: UUID,
    data: StepTypeConfigUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> StepTypeConfigResponse:
    item = await crud.update_step_type(db, current_user.id, config_id, data)
    if item is None:
        raise HTTPException(status_code=404, detail="Step type not found")
    return StepTypeConfigResponse.model_validate(item)


@router.delete(
    "/step-types/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a custom step type",
)
async def delete_step_type(
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    result = await crud.delete_step_type(db, current_user.id, config_id)
    if result is True:
        return
    if result == "Step type not found":
        raise HTTPException(status_code=404, detail=result)
    if result == "Cannot delete built-in step type":
        raise HTTPException(status_code=403, detail=result)


@router.post(
    "/step-types/reset",
    response_model=StepTypeConfigListResponse,
    summary="Reset step types to defaults",
)
async def reset_step_types(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> StepTypeConfigListResponse:
    items = await crud.reset_step_types(db, current_user.id)
    return StepTypeConfigListResponse(
        items=[StepTypeConfigResponse.model_validate(i) for i in items],
        count=len(items),
    )


# ─── GUI Action Types ────────────────────────────────────────────────────────


@router.get(
    "/gui-action-types",
    response_model=GuiActionTypeConfigListResponse,
    summary="List GUI action types",
)
async def list_gui_action_types(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> GuiActionTypeConfigListResponse:
    items = await crud.get_user_gui_action_types(db, current_user.id)
    return GuiActionTypeConfigListResponse(
        items=[GuiActionTypeConfigResponse.model_validate(i) for i in items],
        count=len(items),
    )


@router.post(
    "/gui-action-types",
    response_model=GuiActionTypeConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom GUI action type",
)
async def create_gui_action_type(
    data: GuiActionTypeConfigCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> GuiActionTypeConfigResponse:
    item = await crud.create_gui_action_type(db, current_user.id, data)
    return GuiActionTypeConfigResponse.model_validate(item)


@router.put(
    "/gui-action-types/{config_id}",
    response_model=GuiActionTypeConfigResponse,
    summary="Update a GUI action type",
)
async def update_gui_action_type(
    config_id: UUID,
    data: GuiActionTypeConfigUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> GuiActionTypeConfigResponse:
    item = await crud.update_gui_action_type(db, current_user.id, config_id, data)
    if item is None:
        raise HTTPException(status_code=404, detail="GUI action type not found")
    return GuiActionTypeConfigResponse.model_validate(item)


@router.delete(
    "/gui-action-types/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a custom GUI action type",
)
async def delete_gui_action_type(
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    result = await crud.delete_gui_action_type(db, current_user.id, config_id)
    if result is True:
        return
    if result == "GUI action type not found":
        raise HTTPException(status_code=404, detail=result)
    if result == "Cannot delete built-in GUI action type":
        raise HTTPException(status_code=403, detail=result)


@router.post(
    "/gui-action-types/reset",
    response_model=GuiActionTypeConfigListResponse,
    summary="Reset GUI action types to defaults",
)
async def reset_gui_action_types(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> GuiActionTypeConfigListResponse:
    items = await crud.reset_gui_action_types(db, current_user.id)
    return GuiActionTypeConfigListResponse(
        items=[GuiActionTypeConfigResponse.model_validate(i) for i in items],
        count=len(items),
    )


# ─── Workflow Phases ─────────────────────────────────────────────────────────


@router.get(
    "/phases",
    response_model=WorkflowPhaseConfigListResponse,
    summary="List workflow phases",
)
async def list_workflow_phases(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkflowPhaseConfigListResponse:
    items = await crud.get_user_workflow_phases(db, current_user.id)
    return WorkflowPhaseConfigListResponse(
        items=[WorkflowPhaseConfigResponse.model_validate(i) for i in items],
        count=len(items),
    )


@router.put(
    "/phases/{config_id}",
    response_model=WorkflowPhaseConfigResponse,
    summary="Update a workflow phase",
)
async def update_workflow_phase(
    config_id: UUID,
    data: WorkflowPhaseConfigUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkflowPhaseConfigResponse:
    item = await crud.update_workflow_phase(db, current_user.id, config_id, data)
    if item is None:
        raise HTTPException(status_code=404, detail="Workflow phase not found")
    return WorkflowPhaseConfigResponse.model_validate(item)


@router.post(
    "/phases/reset",
    response_model=WorkflowPhaseConfigListResponse,
    summary="Reset workflow phases to defaults",
)
async def reset_workflow_phases(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkflowPhaseConfigListResponse:
    items = await crud.reset_workflow_phases(db, current_user.id)
    return WorkflowPhaseConfigListResponse(
        items=[WorkflowPhaseConfigResponse.model_validate(i) for i in items],
        count=len(items),
    )
