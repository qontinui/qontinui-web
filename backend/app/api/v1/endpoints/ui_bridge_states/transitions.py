"""Transition routes for a state config."""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import ui_bridge_state_graph as graph_crud
from app.models.user import User
from app.schemas.ui_bridge_state import (
    UIBridgeTransitionCreate,
    UIBridgeTransitionListResponse,
    UIBridgeTransitionResponse,
    UIBridgeTransitionUpdate,
)

from ._deps import get_config_or_404, get_project_or_404, get_transition_or_404
from ._presenters import transition_to_response

# Pinned to the pre-split module name so the `logger` field on every event
# is unchanged by the package split (structlog add_logger_name is active).
logger = structlog.get_logger("app.api.v1.endpoints.ui_bridge_states")

router = APIRouter()


# =============================================================================
# Transition Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/transitions",
    response_model=UIBridgeTransitionListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_transitions(
    project_id: UUID,
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all transitions in a configuration."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    transitions = await graph_crud.list_transitions(db, config_id)

    return UIBridgeTransitionListResponse(
        items=[transition_to_response(t) for t in transitions],
        total=len(transitions),
    )


@router.post(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/transitions",
    response_model=UIBridgeTransitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_transition(
    project_id: UUID,
    config_id: UUID,
    request: UIBridgeTransitionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new transition."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    # transition_id is derived from the name (create only; PATCH keeps it)
    transition = await graph_crud.create_transition(db, config_id, request)

    logger.info(
        "Created UI Bridge transition",
        transition_id=str(transition.id),
        config_id=str(config_id),
        project_id=str(project_id),
    )

    return transition_to_response(transition)


@router.patch(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/transitions/{transition_id}",
    response_model=UIBridgeTransitionResponse,
    status_code=status.HTTP_200_OK,
)
async def update_transition(
    project_id: UUID,
    config_id: UUID,
    transition_id: UUID,
    request: UIBridgeTransitionUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a transition."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    transition = await get_transition_or_404(transition_id, config_id, db)

    transition = await graph_crud.update_transition(db, transition, request)

    return transition_to_response(transition)


@router.delete(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/transitions/{transition_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_transition(
    project_id: UUID,
    config_id: UUID,
    transition_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete a transition."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    transition = await get_transition_or_404(transition_id, config_id, db)

    await graph_crud.delete_transition(db, transition)

    logger.info(
        "Deleted UI Bridge transition",
        transition_id=str(transition_id),
        config_id=str(config_id),
        project_id=str(project_id),
    )
