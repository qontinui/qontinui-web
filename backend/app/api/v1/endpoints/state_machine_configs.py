"""
API endpoints for state machine configuration management.

Provides REST API for saving, loading, and managing state machine builder
configurations in PostgreSQL for cross-device persistence.
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.crud import state_machine_config as crud
from app.models.project import Project
from app.models.user import User
from app.schemas.state_machine_config import (StateMachineConfigCreate,
                                              StateMachineConfigListResponse,
                                              StateMachineConfigResponse,
                                              StateMachineConfigSummary,
                                              StateMachineConfigUpdate)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


async def _verify_project_access(
    db: AsyncSession, project_id: UUID, user: User
) -> Project:
    """Verify user has access to a project."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    if project.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project",
        )
    return project


@router.get(
    "/projects/{project_id}/state-machine-configs",
    response_model=StateMachineConfigListResponse,
)
async def list_configs(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List state machine configs for a project."""
    await _verify_project_access(db, project_id, current_user)
    configs, total = await crud.list_configs(db, project_id, skip=offset, limit=limit)
    return StateMachineConfigListResponse(
        configs=[StateMachineConfigSummary.model_validate(c) for c in configs],
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.post(
    "/projects/{project_id}/state-machine-configs",
    response_model=StateMachineConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_config(
    project_id: UUID,
    data: StateMachineConfigCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new state machine config."""
    await _verify_project_access(db, project_id, current_user)
    config = await crud.create_config(db, project_id, current_user.id, data)
    return StateMachineConfigResponse.model_validate(config)


@router.get(
    "/projects/{project_id}/state-machine-configs/{config_id}",
    response_model=StateMachineConfigResponse,
)
async def get_config(
    project_id: UUID,
    config_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get a state machine config by ID."""
    await _verify_project_access(db, project_id, current_user)
    config = await crud.get_config(db, project_id, config_id)
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Config not found",
        )
    return StateMachineConfigResponse.model_validate(config)


@router.put(
    "/projects/{project_id}/state-machine-configs/{config_id}",
    response_model=StateMachineConfigResponse,
)
async def update_config(
    project_id: UUID,
    config_id: UUID,
    data: StateMachineConfigUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update a state machine config."""
    await _verify_project_access(db, project_id, current_user)
    config = await crud.get_config(db, project_id, config_id)
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Config not found",
        )
    updated = await crud.update_config(db, config, data)
    return StateMachineConfigResponse.model_validate(updated)


@router.delete(
    "/projects/{project_id}/state-machine-configs/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_config(
    project_id: UUID,
    config_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a state machine config."""
    await _verify_project_access(db, project_id, current_user)
    config = await crud.get_config(db, project_id, config_id)
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Config not found",
        )
    await crud.delete_config(db, config)
