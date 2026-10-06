"""State config, state, and state↔knowledge link routes, plus the export and
full-graph reads of a config.

Three routers rather than one: ``__init__`` interleaves them with the other
modules' routers to keep today's route registration order (export and full
were registered after transitions and around pathfind).
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import ui_bridge_domain_knowledge as knowledge_crud
from app.crud import ui_bridge_state_graph as graph_crud
from app.models.user import User
from app.schemas.ui_bridge_state import (
    ExportResponse,
    UIBridgeStateConfigCreate,
    UIBridgeStateConfigListResponse,
    UIBridgeStateConfigResponse,
    UIBridgeStateConfigUpdate,
    UIBridgeStateConfigWithStates,
    UIBridgeStateConfigWithStatesAndTransitions,
    UIBridgeStateDomainKnowledgeLink,
    UIBridgeStateListResponse,
    UIBridgeStateResponse,
    UIBridgeStateUpdate,
)

from ._deps import get_config_or_404, get_project_or_404, get_state_or_404
from ._presenters import (
    build_export_response,
    state_to_response,
    transition_to_response,
)

logger = structlog.get_logger(__name__)

router = APIRouter()
export_router = APIRouter()
full_router = APIRouter()


# =============================================================================
# State Config Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/ui-bridge-configs",
    response_model=UIBridgeStateConfigListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_state_configs(
    project_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all state configurations for a project."""
    await get_project_or_404(project_id, current_user.id, db)

    configs = await graph_crud.list_configs(db, project_id)

    return UIBridgeStateConfigListResponse(
        items=[UIBridgeStateConfigResponse.model_validate(c) for c in configs],
        total=len(configs),
    )


@router.get(
    "/projects/{project_id}/ui-bridge-configs/{config_id}",
    response_model=UIBridgeStateConfigWithStates,
    status_code=status.HTTP_200_OK,
)
async def get_state_config(
    project_id: UUID,
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get a state configuration with all its states."""
    await get_project_or_404(project_id, current_user.id, db)

    config = await graph_crud.get_config_with_states(db, project_id, config_id)

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State configuration not found",
        )

    return UIBridgeStateConfigWithStates(
        id=config.id,
        project_id=config.project_id,
        name=config.name,
        description=config.description,
        render_count=config.render_count,
        element_count=config.element_count,
        include_html_ids=config.include_html_ids,
        created_at=config.created_at,
        updated_at=config.updated_at,
        states=[state_to_response(s) for s in config.states],
    )


@router.post(
    "/projects/{project_id}/ui-bridge-configs",
    response_model=UIBridgeStateConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_state_config(
    project_id: UUID,
    request: UIBridgeStateConfigCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new state configuration."""
    await get_project_or_404(project_id, current_user.id, db)

    config = await graph_crud.create_config(
        db,
        project_id,
        name=request.name,
        description=request.description,
        include_html_ids=request.include_html_ids,
    )

    logger.info(
        "Created UI Bridge state config",
        config_id=str(config.id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return UIBridgeStateConfigResponse.model_validate(config)


@router.patch(
    "/projects/{project_id}/ui-bridge-configs/{config_id}",
    response_model=UIBridgeStateConfigResponse,
    status_code=status.HTTP_200_OK,
)
async def update_state_config(
    project_id: UUID,
    config_id: UUID,
    request: UIBridgeStateConfigUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a state configuration."""
    await get_project_or_404(project_id, current_user.id, db)
    config = await get_config_or_404(config_id, project_id, db)

    config = await graph_crud.update_config(
        db, config, name=request.name, description=request.description
    )

    return UIBridgeStateConfigResponse.model_validate(config)


@router.delete(
    "/projects/{project_id}/ui-bridge-configs/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_state_config(
    project_id: UUID,
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete a state configuration and all its states."""
    await get_project_or_404(project_id, current_user.id, db)
    config = await get_config_or_404(config_id, project_id, db)

    await graph_crud.delete_config(db, config)

    logger.info(
        "Deleted UI Bridge state config",
        config_id=str(config_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )


# =============================================================================
# State Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/states",
    response_model=UIBridgeStateListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_states(
    project_id: UUID,
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all states in a configuration."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    states = await graph_crud.list_states(db, config_id)

    return UIBridgeStateListResponse(
        items=[state_to_response(s) for s in states],
        total=len(states),
    )


@router.get(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}",
    response_model=UIBridgeStateResponse,
    status_code=status.HTTP_200_OK,
)
async def get_state(
    project_id: UUID,
    config_id: UUID,
    state_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get a single state with domain knowledge."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    state = await get_state_or_404(state_id, config_id, db, with_knowledge=True)

    return state_to_response(state)


@router.patch(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}",
    response_model=UIBridgeStateResponse,
    status_code=status.HTTP_200_OK,
)
async def update_state(
    project_id: UUID,
    config_id: UUID,
    state_id: UUID,
    request: UIBridgeStateUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a state's description or acceptance criteria."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    state = await get_state_or_404(state_id, config_id, db, with_knowledge=True)

    state = await graph_crud.update_state(db, state, request)

    return state_to_response(state)


@router.post(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}/knowledge",
    response_model=UIBridgeStateResponse,
    status_code=status.HTTP_200_OK,
)
async def link_domain_knowledge(
    project_id: UUID,
    config_id: UUID,
    state_id: UUID,
    request: UIBridgeStateDomainKnowledgeLink,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Link domain knowledge to a state."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)

    state = await get_state_or_404(state_id, config_id, db, with_knowledge=True)

    # Verify knowledge exists and belongs to project or is global
    knowledge = await knowledge_crud.get_visible_knowledge(
        db, project_id, request.knowledge_id
    )

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found",
        )

    # Check if already linked
    if await graph_crud.get_knowledge_link(db, state_id, request.knowledge_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge already linked to state",
        )

    # Create link; returns the state reloaded with its new knowledge
    state = await graph_crud.link_knowledge(
        db, state, knowledge_id=request.knowledge_id, order=request.order
    )

    return state_to_response(state)


@router.delete(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}/knowledge/{knowledge_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unlink_domain_knowledge(
    project_id: UUID,
    config_id: UUID,
    state_id: UUID,
    knowledge_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Remove domain knowledge link from a state."""
    await get_project_or_404(project_id, current_user.id, db)
    await get_config_or_404(config_id, project_id, db)
    await get_state_or_404(state_id, config_id, db)

    link = await graph_crud.get_knowledge_link(db, state_id, knowledge_id)

    if link:
        await graph_crud.delete_knowledge_link(db, link)


# =============================================================================
# Export Endpoint
# =============================================================================


@export_router.get(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/export",
    response_model=ExportResponse,
    status_code=status.HTTP_200_OK,
)
async def export_config(
    project_id: UUID,
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Export config as JSON matching UIBridgeRuntime.from_dict() format."""
    await get_project_or_404(project_id, current_user.id, db)

    # Load config with states and transitions
    config = await graph_crud.load_config_graph(
        db, project_id, config_id, with_knowledge=False
    )

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State configuration not found",
        )

    return build_export_response(config)


# =============================================================================
# Config with States AND Transitions
# =============================================================================


@full_router.get(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/full",
    response_model=UIBridgeStateConfigWithStatesAndTransitions,
    status_code=status.HTTP_200_OK,
)
async def get_state_config_full(
    project_id: UUID,
    config_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get a state configuration with all states and transitions."""
    await get_project_or_404(project_id, current_user.id, db)

    config = await graph_crud.load_config_graph(
        db, project_id, config_id, with_knowledge=True
    )

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State configuration not found",
        )

    return UIBridgeStateConfigWithStatesAndTransitions(
        id=config.id,
        project_id=config.project_id,
        name=config.name,
        description=config.description,
        render_count=config.render_count,
        element_count=config.element_count,
        include_html_ids=config.include_html_ids,
        created_at=config.created_at,
        updated_at=config.updated_at,
        states=[state_to_response(s) for s in config.states],
        transitions=[transition_to_response(t) for t in config.transitions],
    )
