"""
API endpoints for UI Bridge state discovery and management.

Provides endpoints to:
- Discover states from render logs and save to database
- Manage state configurations per project
- Update state descriptions and acceptance criteria
- Manage domain knowledge and link it to states
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.project import Project
from app.models.ui_bridge_state import (
    DomainKnowledge,
    UIBridgeExplorationSession,
    UIBridgeState,
    UIBridgeStateConfig,
    UIBridgeStateDomainKnowledge,
)
from app.models.ui_bridge_transition import UIBridgeTransition
from app.models.user import User
from app.schemas.ui_bridge_state import (
    DomainKnowledgeCreate,
    DomainKnowledgeListResponse,
    DomainKnowledgeResponse,
    DomainKnowledgeUpdate,
    ExplorationSessionAppendRenders,
    ExplorationSessionCreate,
    ExplorationSessionListResponse,
    ExplorationSessionResponse,
    ExplorationSessionUpdate,
    ExplorationSessionWithRenders,
    ExportResponse,
    PathfindingRequest,
    PathfindingResponse,
    PathfindingStep,
    UIBridgeDiscoverAndSaveRequest,
    UIBridgeDiscoverAndSaveResponse,
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
    UIBridgeTransitionCreate,
    UIBridgeTransitionListResponse,
    UIBridgeTransitionResponse,
    UIBridgeTransitionUpdate,
)

# Note: qontinui imports are done lazily in endpoints that need them
# to avoid loading torch/easyocr at application startup

logger = structlog.get_logger(__name__)

router = APIRouter()


# =============================================================================
# Helper Functions
# =============================================================================


async def get_project_or_404(
    project_id: UUID,
    user_id: UUID,
    db: AsyncSession,
) -> Project:
    """Get project by ID, ensuring user has access."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == user_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return project


async def get_config_or_404(
    config_id: UUID,
    project_id: UUID,
    db: AsyncSession,
) -> UIBridgeStateConfig:
    """Get config by ID, ensuring it belongs to project."""
    result = await db.execute(
        select(UIBridgeStateConfig).where(
            UIBridgeStateConfig.id == config_id,
            UIBridgeStateConfig.project_id == project_id,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State configuration not found",
        )
    return config


async def get_state_or_404(
    state_id: UUID,
    config_id: UUID,
    db: AsyncSession,
) -> UIBridgeState:
    """Get state by ID, ensuring it belongs to config."""
    result = await db.execute(
        select(UIBridgeState).where(
            UIBridgeState.id == state_id,
            UIBridgeState.config_id == config_id,
        )
    )
    state = result.scalar_one_or_none()
    if not state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State not found",
        )
    return state


def state_to_response(state: UIBridgeState) -> UIBridgeStateResponse:
    """Convert state model to response with domain knowledge."""
    domain_knowledge = []
    if state.domain_knowledge_refs:
        for ref in sorted(state.domain_knowledge_refs, key=lambda x: x.order):
            if ref.knowledge:
                domain_knowledge.append(
                    DomainKnowledgeResponse.model_validate(ref.knowledge)
                )

    return UIBridgeStateResponse(
        id=state.id,
        config_id=state.config_id,
        state_id=state.state_id,
        name=state.name,
        description=state.description,
        element_ids=state.element_ids or [],
        render_ids=state.render_ids or [],
        confidence=state.confidence,
        acceptance_criteria=state.acceptance_criteria or [],
        extra_metadata=state.extra_metadata or {},
        created_at=state.created_at,
        updated_at=state.updated_at,
        domain_knowledge=domain_knowledge,
    )


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

    result = await db.execute(
        select(UIBridgeStateConfig)
        .where(UIBridgeStateConfig.project_id == project_id)
        .order_by(UIBridgeStateConfig.updated_at.desc())
    )
    configs = result.scalars().all()

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

    result = await db.execute(
        select(UIBridgeStateConfig)
        .options(
            selectinload(UIBridgeStateConfig.states)
            .selectinload(UIBridgeState.domain_knowledge_refs)
            .selectinload(UIBridgeStateDomainKnowledge.knowledge)
        )
        .where(
            UIBridgeStateConfig.id == config_id,
            UIBridgeStateConfig.project_id == project_id,
        )
    )
    config = result.scalar_one_or_none()

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

    config = UIBridgeStateConfig(
        project_id=project_id,
        name=request.name,
        description=request.description,
        include_html_ids=request.include_html_ids,
    )

    db.add(config)
    await db.commit()
    await db.refresh(config)

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

    if request.name is not None:
        config.name = request.name
    if request.description is not None:
        config.description = request.description

    await db.commit()
    await db.refresh(config)

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

    await db.delete(config)
    await db.commit()

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

    result = await db.execute(
        select(UIBridgeState)
        .options(
            selectinload(UIBridgeState.domain_knowledge_refs).selectinload(
                UIBridgeStateDomainKnowledge.knowledge
            )
        )
        .where(UIBridgeState.config_id == config_id)
        .order_by(UIBridgeState.name)
    )
    states = result.scalars().all()

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

    result = await db.execute(
        select(UIBridgeState)
        .options(
            selectinload(UIBridgeState.domain_knowledge_refs).selectinload(
                UIBridgeStateDomainKnowledge.knowledge
            )
        )
        .where(
            UIBridgeState.id == state_id,
            UIBridgeState.config_id == config_id,
        )
    )
    state = result.scalar_one_or_none()

    if not state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State not found",
        )

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

    result = await db.execute(
        select(UIBridgeState)
        .options(
            selectinload(UIBridgeState.domain_knowledge_refs).selectinload(
                UIBridgeStateDomainKnowledge.knowledge
            )
        )
        .where(
            UIBridgeState.id == state_id,
            UIBridgeState.config_id == config_id,
        )
    )
    state = result.scalar_one_or_none()

    if not state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State not found",
        )

    if request.name is not None:
        state.name = request.name
    if request.description is not None:
        state.description = request.description
    if request.acceptance_criteria is not None:
        state.acceptance_criteria = request.acceptance_criteria
    if request.extra_metadata is not None:
        state.extra_metadata = request.extra_metadata

    await db.commit()
    await db.refresh(state)

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

    result = await db.execute(
        select(UIBridgeState)
        .options(
            selectinload(UIBridgeState.domain_knowledge_refs).selectinload(
                UIBridgeStateDomainKnowledge.knowledge
            )
        )
        .where(
            UIBridgeState.id == state_id,
            UIBridgeState.config_id == config_id,
        )
    )
    state = result.scalar_one_or_none()

    if not state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State not found",
        )

    # Verify knowledge exists and belongs to project or is global
    knowledge_result = await db.execute(
        select(DomainKnowledge).where(
            DomainKnowledge.id == request.knowledge_id,
            (DomainKnowledge.project_id == project_id)
            | (DomainKnowledge.project_id.is_(None)),
        )
    )
    knowledge = knowledge_result.scalar_one_or_none()

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found",
        )

    # Check if already linked
    existing = await db.execute(
        select(UIBridgeStateDomainKnowledge).where(
            UIBridgeStateDomainKnowledge.state_id == state_id,
            UIBridgeStateDomainKnowledge.knowledge_id == request.knowledge_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge already linked to state",
        )

    # Create link
    link = UIBridgeStateDomainKnowledge(
        state_id=state_id,
        knowledge_id=request.knowledge_id,
        order=request.order,
    )
    db.add(link)
    await db.commit()

    # Refresh state with new knowledge
    await db.refresh(state)
    result = await db.execute(
        select(UIBridgeState)
        .options(
            selectinload(UIBridgeState.domain_knowledge_refs).selectinload(
                UIBridgeStateDomainKnowledge.knowledge
            )
        )
        .where(UIBridgeState.id == state_id)
    )
    state = result.scalar_one()

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

    result = await db.execute(
        select(UIBridgeStateDomainKnowledge).where(
            UIBridgeStateDomainKnowledge.state_id == state_id,
            UIBridgeStateDomainKnowledge.knowledge_id == knowledge_id,
        )
    )
    link = result.scalar_one_or_none()

    if link:
        await db.delete(link)
        await db.commit()


# =============================================================================
# Domain Knowledge Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/domain-knowledge",
    response_model=DomainKnowledgeListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_domain_knowledge(
    project_id: UUID,
    include_global: bool = Query(True, description="Include global knowledge"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List domain knowledge for a project."""
    await get_project_or_404(project_id, current_user.id, db)

    query = select(DomainKnowledge)
    if include_global:
        query = query.where(
            (DomainKnowledge.project_id == project_id)
            | (DomainKnowledge.project_id.is_(None))
        )
    else:
        query = query.where(DomainKnowledge.project_id == project_id)

    query = query.order_by(DomainKnowledge.title)
    result = await db.execute(query)
    items = result.scalars().all()

    return DomainKnowledgeListResponse(
        items=[DomainKnowledgeResponse.model_validate(k) for k in items],
        total=len(items),
    )


@router.post(
    "/projects/{project_id}/domain-knowledge",
    response_model=DomainKnowledgeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_domain_knowledge(
    project_id: UUID,
    request: DomainKnowledgeCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create new domain knowledge for a project."""
    await get_project_or_404(project_id, current_user.id, db)

    knowledge = DomainKnowledge(
        project_id=project_id,
        title=request.title,
        content=request.content,
        tags=request.tags,
    )

    db.add(knowledge)
    await db.commit()
    await db.refresh(knowledge)

    logger.info(
        "Created domain knowledge",
        knowledge_id=str(knowledge.id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return DomainKnowledgeResponse.model_validate(knowledge)


@router.get(
    "/projects/{project_id}/domain-knowledge/{knowledge_id}",
    response_model=DomainKnowledgeResponse,
    status_code=status.HTTP_200_OK,
)
async def get_domain_knowledge(
    project_id: UUID,
    knowledge_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get domain knowledge by ID."""
    await get_project_or_404(project_id, current_user.id, db)

    result = await db.execute(
        select(DomainKnowledge).where(
            DomainKnowledge.id == knowledge_id,
            (DomainKnowledge.project_id == project_id)
            | (DomainKnowledge.project_id.is_(None)),
        )
    )
    knowledge = result.scalar_one_or_none()

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found",
        )

    return DomainKnowledgeResponse.model_validate(knowledge)


@router.patch(
    "/projects/{project_id}/domain-knowledge/{knowledge_id}",
    response_model=DomainKnowledgeResponse,
    status_code=status.HTTP_200_OK,
)
async def update_domain_knowledge(
    project_id: UUID,
    knowledge_id: UUID,
    request: DomainKnowledgeUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update domain knowledge."""
    await get_project_or_404(project_id, current_user.id, db)

    result = await db.execute(
        select(DomainKnowledge).where(
            DomainKnowledge.id == knowledge_id,
            DomainKnowledge.project_id == project_id,  # Can only edit project-specific
        )
    )
    knowledge = result.scalar_one_or_none()

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found or cannot be edited",
        )

    if request.title is not None:
        knowledge.title = request.title
    if request.content is not None:
        knowledge.content = request.content
    if request.tags is not None:
        knowledge.tags = request.tags

    await db.commit()
    await db.refresh(knowledge)

    return DomainKnowledgeResponse.model_validate(knowledge)


@router.delete(
    "/projects/{project_id}/domain-knowledge/{knowledge_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_domain_knowledge(
    project_id: UUID,
    knowledge_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete domain knowledge."""
    await get_project_or_404(project_id, current_user.id, db)

    result = await db.execute(
        select(DomainKnowledge).where(
            DomainKnowledge.id == knowledge_id,
            DomainKnowledge.project_id
            == project_id,  # Can only delete project-specific
        )
    )
    knowledge = result.scalar_one_or_none()

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found or cannot be deleted",
        )

    await db.delete(knowledge)
    await db.commit()

    logger.info(
        "Deleted domain knowledge",
        knowledge_id=str(knowledge_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )


# =============================================================================
# Discovery and Save Endpoint
# =============================================================================


@router.post(
    "/projects/{project_id}/ui-bridge-discover",
    response_model=UIBridgeDiscoverAndSaveResponse,
    status_code=status.HTTP_201_CREATED,
)
async def discover_and_save_states(
    project_id: UUID,
    request: UIBridgeDiscoverAndSaveRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Discover states from render logs and save to database.

    This endpoint:
    1. Runs state discovery using the selected strategy
    2. Creates a new state configuration
    3. Saves all discovered states

    **Strategies:**
    - `auto` (default): Uses fingerprint strategy if fingerprint data provided,
      otherwise falls back to legacy
    - `legacy`: ID-based co-occurrence analysis (data-ui-id, data-testid)
    - `fingerprint`: Enhanced discovery with element fingerprints for cross-page matching

    Use this to persist discovery results for later use.
    """
    await get_project_or_404(project_id, current_user.id, db)

    # Lazy import to avoid loading torch/easyocr at startup
    from qontinui.discovery.state_discovery import (
        DiscoveryStrategyType,
        StateDiscoveryService,
    )

    # Map request strategy to library strategy type
    strategy_map = {
        "auto": DiscoveryStrategyType.AUTO,
        "legacy": DiscoveryStrategyType.LEGACY,
        "fingerprint": DiscoveryStrategyType.FINGERPRINT,
    }
    strategy = strategy_map.get(request.strategy.value, DiscoveryStrategyType.AUTO)

    logger.info(
        "Starting UI Bridge state discovery",
        project_id=str(project_id),
        user_id=str(current_user.id),
        render_count=len(request.renders),
        include_html_ids=request.include_html_ids,
        strategy=request.strategy.value,
        has_cooccurrence_export=request.cooccurrence_export is not None,
    )

    try:
        # Use unified state discovery service
        service = StateDiscoveryService()

        # Choose discovery method based on available data
        if request.cooccurrence_export:
            discovery_result = service.discover_from_export(
                request.cooccurrence_export,
                strategy=strategy,
            )
        else:
            discovery_result = service.discover_from_renders(
                request.renders,
                include_html_ids=request.include_html_ids,
                strategy=strategy,
            )

        # Create config
        config = UIBridgeStateConfig(
            project_id=project_id,
            name=request.config_name,
            description=request.config_description,
            render_count=discovery_result.render_count,
            element_count=discovery_result.unique_element_count,
            include_html_ids=request.include_html_ids,
            discovery_result={
                "element_to_renders": discovery_result.element_to_renders,
                "strategy_used": discovery_result.strategy_used.value,
                "strategy_metadata": discovery_result.strategy_metadata,
            },
        )
        db.add(config)
        await db.flush()  # Get config ID

        # Create states
        states = []
        for discovered_state in discovery_result.states:
            state = UIBridgeState(
                config_id=config.id,
                state_id=discovered_state.id,
                name=discovered_state.name,
                element_ids=discovered_state.element_ids,
                render_ids=discovered_state.render_ids,
                confidence=discovered_state.confidence,
            )
            db.add(state)
            states.append(state)

        await db.commit()
        await db.refresh(config)
        for state in states:
            await db.refresh(state)

        logger.info(
            "Completed UI Bridge state discovery",
            project_id=str(project_id),
            config_id=str(config.id),
            states_discovered=len(states),
            render_count=discovery_result.render_count,
            element_count=discovery_result.unique_element_count,
            strategy_used=discovery_result.strategy_used.value,
        )

        return UIBridgeDiscoverAndSaveResponse(
            config=UIBridgeStateConfigResponse.model_validate(config),
            states=[state_to_response(s) for s in states],
            render_count=discovery_result.render_count,
            unique_element_count=discovery_result.unique_element_count,
        )

    except Exception as e:
        logger.error(
            "UI Bridge state discovery failed",
            project_id=str(project_id),
            user_id=str(current_user.id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"State discovery failed: {str(e)}",
        )


# =============================================================================
# Exploration Session Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/exploration-sessions",
    response_model=ExplorationSessionListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_exploration_sessions(
    project_id: UUID,
    include_completed: bool = Query(True, description="Include completed sessions"),
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List exploration sessions for a project."""
    await get_project_or_404(project_id, current_user.id, db)

    query = select(UIBridgeExplorationSession).where(
        UIBridgeExplorationSession.project_id == project_id
    )

    if not include_completed:
        query = query.where(UIBridgeExplorationSession.status != "completed")

    query = query.order_by(UIBridgeExplorationSession.created_at.desc()).limit(limit)

    result = await db.execute(query)
    sessions = result.scalars().all()

    return ExplorationSessionListResponse(
        items=[ExplorationSessionResponse.model_validate(s) for s in sessions],
        total=len(sessions),
    )


@router.post(
    "/projects/{project_id}/exploration-sessions",
    response_model=ExplorationSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_exploration_session(
    project_id: UUID,
    request: ExplorationSessionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    # Generate name if not provided
    name = request.name or f"Exploration {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"

    session = UIBridgeExplorationSession(
        project_id=project_id,
        name=name,
        status="running",
        target_type=request.target_type,
        target_url=request.target_url,
        exploration_config=request.exploration_config,
        render_logs=[],
        elements_discovered=0,
        elements_explored=0,
        render_count=0,
    )

    db.add(session)
    await db.commit()
    await db.refresh(session)

    logger.info(
        "Created exploration session",
        session_id=str(session.id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return ExplorationSessionResponse.model_validate(session)


@router.get(
    "/projects/{project_id}/exploration-sessions/{session_id}",
    response_model=ExplorationSessionWithRenders,
    status_code=status.HTTP_200_OK,
)
async def get_exploration_session(
    project_id: UUID,
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get an exploration session with render logs."""
    await get_project_or_404(project_id, current_user.id, db)

    result = await db.execute(
        select(UIBridgeExplorationSession).where(
            UIBridgeExplorationSession.id == session_id,
            UIBridgeExplorationSession.project_id == project_id,
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exploration session not found",
        )

    return ExplorationSessionWithRenders.model_validate(session)


@router.patch(
    "/projects/{project_id}/exploration-sessions/{session_id}",
    response_model=ExplorationSessionResponse,
    status_code=status.HTTP_200_OK,
)
async def update_exploration_session(
    project_id: UUID,
    session_id: UUID,
    request: ExplorationSessionUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update an exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    result = await db.execute(
        select(UIBridgeExplorationSession).where(
            UIBridgeExplorationSession.id == session_id,
            UIBridgeExplorationSession.project_id == project_id,
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exploration session not found",
        )

    if request.status is not None:
        session.status = request.status.value
        if request.status.value in ("completed", "failed", "cancelled"):
            session.completed_at = datetime.utcnow()

    if request.render_logs is not None:
        # Append new render logs
        session.render_logs = session.render_logs + request.render_logs
        session.render_count = len(session.render_logs)

    if request.elements_discovered is not None:
        session.elements_discovered = request.elements_discovered

    if request.elements_explored is not None:
        session.elements_explored = request.elements_explored

    if request.error_message is not None:
        session.error_message = request.error_message

    if request.discovery_completed is not None:
        session.discovery_completed = request.discovery_completed

    if request.saved_config_id is not None:
        session.saved_config_id = request.saved_config_id

    await db.commit()
    await db.refresh(session)

    return ExplorationSessionResponse.model_validate(session)


@router.post(
    "/projects/{project_id}/exploration-sessions/{session_id}/renders",
    response_model=ExplorationSessionResponse,
    status_code=status.HTTP_200_OK,
)
async def append_renders_to_session(
    project_id: UUID,
    session_id: UUID,
    request: ExplorationSessionAppendRenders,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Append render logs to an exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    result = await db.execute(
        select(UIBridgeExplorationSession).where(
            UIBridgeExplorationSession.id == session_id,
            UIBridgeExplorationSession.project_id == project_id,
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exploration session not found",
        )

    # Append render logs
    session.render_logs = session.render_logs + request.render_logs
    session.render_count = len(session.render_logs)

    if request.elements_discovered is not None:
        session.elements_discovered = request.elements_discovered

    if request.elements_explored is not None:
        session.elements_explored = request.elements_explored

    await db.commit()
    await db.refresh(session)

    logger.debug(
        "Appended renders to exploration session",
        session_id=str(session_id),
        new_renders=len(request.render_logs),
        total_renders=session.render_count,
    )

    return ExplorationSessionResponse.model_validate(session)


@router.delete(
    "/projects/{project_id}/exploration-sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_exploration_session(
    project_id: UUID,
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete an exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    result = await db.execute(
        select(UIBridgeExplorationSession).where(
            UIBridgeExplorationSession.id == session_id,
            UIBridgeExplorationSession.project_id == project_id,
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exploration session not found",
        )

    await db.delete(session)
    await db.commit()

    logger.info(
        "Deleted exploration session",
        session_id=str(session_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )


# =============================================================================
# Transition Endpoints
# =============================================================================


def transition_to_response(
    transition: UIBridgeTransition,
) -> UIBridgeTransitionResponse:
    """Convert transition model to response."""
    return UIBridgeTransitionResponse(
        id=transition.id,
        config_id=transition.config_id,
        transition_id=transition.transition_id,
        name=transition.name,
        from_states=transition.from_states or [],
        activate_states=transition.activate_states or [],
        exit_states=transition.exit_states or [],
        actions=transition.actions or [],
        path_cost=transition.path_cost,
        stays_visible=transition.stays_visible,
        extra_metadata=transition.extra_metadata or {},
        created_at=transition.created_at,
        updated_at=transition.updated_at,
    )


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

    result = await db.execute(
        select(UIBridgeTransition)
        .where(UIBridgeTransition.config_id == config_id)
        .order_by(UIBridgeTransition.name)
    )
    transitions = result.scalars().all()

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

    # Generate transition_id from name
    import re

    transition_id = re.sub(r"[^a-z0-9]+", "_", request.name.lower()).strip("_")

    transition = UIBridgeTransition(
        config_id=config_id,
        transition_id=transition_id,
        name=request.name,
        from_states=request.from_states,
        activate_states=request.activate_states,
        exit_states=request.exit_states,
        actions=[a.model_dump(exclude_none=True) for a in request.actions],
        path_cost=request.path_cost,
        stays_visible=request.stays_visible,
        extra_metadata=request.extra_metadata,
    )

    db.add(transition)
    await db.commit()
    await db.refresh(transition)

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

    result = await db.execute(
        select(UIBridgeTransition).where(
            UIBridgeTransition.id == transition_id,
            UIBridgeTransition.config_id == config_id,
        )
    )
    transition = result.scalar_one_or_none()

    if not transition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transition not found",
        )

    if request.name is not None:
        transition.name = request.name
    if request.from_states is not None:
        transition.from_states = request.from_states
    if request.activate_states is not None:
        transition.activate_states = request.activate_states
    if request.exit_states is not None:
        transition.exit_states = request.exit_states
    if request.actions is not None:
        transition.actions = [a.model_dump(exclude_none=True) for a in request.actions]
    if request.path_cost is not None:
        transition.path_cost = request.path_cost
    if request.stays_visible is not None:
        transition.stays_visible = request.stays_visible
    if request.extra_metadata is not None:
        transition.extra_metadata = request.extra_metadata

    await db.commit()
    await db.refresh(transition)

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

    result = await db.execute(
        select(UIBridgeTransition).where(
            UIBridgeTransition.id == transition_id,
            UIBridgeTransition.config_id == config_id,
        )
    )
    transition = result.scalar_one_or_none()

    if not transition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transition not found",
        )

    await db.delete(transition)
    await db.commit()

    logger.info(
        "Deleted UI Bridge transition",
        transition_id=str(transition_id),
        config_id=str(config_id),
        project_id=str(project_id),
    )


# =============================================================================
# Export Endpoint
# =============================================================================


@router.get(
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
    result = await db.execute(
        select(UIBridgeStateConfig)
        .options(
            selectinload(UIBridgeStateConfig.states),
            selectinload(UIBridgeStateConfig.transitions),
        )
        .where(
            UIBridgeStateConfig.id == config_id,
            UIBridgeStateConfig.project_id == project_id,
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State configuration not found",
        )

    # Build states dict matching UIBridgeState dataclass fields
    states_dict = {}
    for state in config.states:
        states_dict[state.state_id] = {
            "id": state.state_id,
            "name": state.name,
            "element_ids": state.element_ids or [],
            "blocking": (
                state.extra_metadata.get("blocking", False)
                if state.extra_metadata
                else False
            ),
            "blocks": (
                state.extra_metadata.get("blocks", []) if state.extra_metadata else []
            ),
            "group": (
                state.extra_metadata.get("group") if state.extra_metadata else None
            ),
            "path_cost": (
                state.extra_metadata.get("path_cost", 1.0)
                if state.extra_metadata
                else 1.0
            ),
            "metadata": state.extra_metadata or {},
        }

    # Build transitions dict matching UIBridgeTransition dataclass fields
    transitions_dict = {}
    for trans in config.transitions:
        transitions_dict[trans.transition_id] = {
            "id": trans.transition_id,
            "name": trans.name,
            "from_states": trans.from_states or [],
            "activate_states": trans.activate_states or [],
            "exit_states": trans.exit_states or [],
            "actions": trans.actions or [],
            "path_cost": trans.path_cost,
            "stays_visible": trans.stays_visible,
            "metadata": trans.extra_metadata or {},
        }

    return ExportResponse(
        states=states_dict,
        transitions=transitions_dict,
        config={
            "name": config.name,
            "description": config.description,
            "render_count": config.render_count,
            "element_count": config.element_count,
        },
    )


# =============================================================================
# Pathfinding Preview Endpoint
# =============================================================================


@router.post(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/pathfind",
    response_model=PathfindingResponse,
    status_code=status.HTTP_200_OK,
)
async def pathfind(
    project_id: UUID,
    config_id: UUID,
    request: PathfindingRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Find path between states using multistate pathfinding.

    This builds a UIBridgeRuntime in-memory with a stub client
    and runs pathfinding without executing any actual actions.
    """
    await get_project_or_404(project_id, current_user.id, db)

    # Load config with states and transitions
    result = await db.execute(
        select(UIBridgeStateConfig)
        .options(
            selectinload(UIBridgeStateConfig.states),
            selectinload(UIBridgeStateConfig.transitions),
        )
        .where(
            UIBridgeStateConfig.id == config_id,
            UIBridgeStateConfig.project_id == project_id,
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State configuration not found",
        )

    try:
        # Lazy import to avoid loading torch at startup
        from qontinui.state_machine.ui_bridge_runtime import (
            UIBridgeRuntime,
            UIBridgeRuntimeConfig,
        )
        from qontinui.state_machine.ui_bridge_runtime import (
            UIBridgeState as UIBridgeStateData,
        )
        from qontinui.state_machine.ui_bridge_runtime import (
            UIBridgeTransition as UIBridgeTransitionData,
        )

        # Create a stub client that does nothing
        class StubClient:
            def find(self, **kwargs: Any) -> Any:
                return type("R", (), {"elements": []})()

            def get_active_states(self) -> list[str]:
                return request.from_states

            def execute_transition(self, transition_id: str) -> Any:
                return type("R", (), {"success": True})()

            def navigate_to(self, targets: list[str]) -> Any:
                raise NotImplementedError

            def click(self, element_id: str, **kwargs: Any) -> Any:
                return type("R", (), {"success": True})()

            def type(self, element_id: str, text: str, **kwargs: Any) -> Any:
                return type("R", (), {"success": True})()

        stub = StubClient()
        runtime_config = UIBridgeRuntimeConfig(
            enable_reliability_tracking=False,
        )
        runtime = UIBridgeRuntime(stub, runtime_config)

        # Register states
        for state in config.states:
            runtime.register_state(
                UIBridgeStateData(
                    id=state.state_id,
                    name=state.name,
                    element_ids=state.element_ids or [],
                )
            )

        # Register transitions
        for trans in config.transitions:
            runtime.register_transition(
                UIBridgeTransitionData(
                    id=trans.transition_id,
                    name=trans.name,
                    from_states=trans.from_states or [],
                    activate_states=trans.activate_states or [],
                    exit_states=trans.exit_states or [],
                    actions=trans.actions or [],
                    path_cost=trans.path_cost,
                    stays_visible=trans.stays_visible,
                )
            )

        # Run pathfinding
        path = runtime.find_path(
            target_states=request.target_states,
            from_states=set(request.from_states),
        )

        if not path:
            return PathfindingResponse(
                found=False,
                error="No path found between specified states",
            )

        # Build response
        steps = []
        total_cost = 0.0
        for trans in path.transitions_sequence:
            ui_trans = runtime._ui_transitions.get(trans.id)
            if ui_trans:
                steps.append(
                    PathfindingStep(
                        transition_id=ui_trans.id,
                        transition_name=ui_trans.name,
                        from_states=ui_trans.from_states,
                        activate_states=ui_trans.activate_states,
                        exit_states=ui_trans.exit_states,
                        path_cost=ui_trans.path_cost,
                    )
                )
                total_cost += ui_trans.path_cost

        return PathfindingResponse(
            found=True,
            steps=steps,
            total_cost=total_cost,
        )

    except ImportError:
        return PathfindingResponse(
            found=False,
            error="qontinui core library not available for pathfinding",
        )
    except Exception as e:
        logger.error(
            "Pathfinding failed",
            config_id=str(config_id),
            error=str(e),
        )
        return PathfindingResponse(
            found=False,
            error=f"Pathfinding error: {str(e)}",
        )


# =============================================================================
# Config with States AND Transitions
# =============================================================================


@router.get(
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

    result = await db.execute(
        select(UIBridgeStateConfig)
        .options(
            selectinload(UIBridgeStateConfig.states)
            .selectinload(UIBridgeState.domain_knowledge_refs)
            .selectinload(UIBridgeStateDomainKnowledge.knowledge),
            selectinload(UIBridgeStateConfig.transitions),
        )
        .where(
            UIBridgeStateConfig.id == config_id,
            UIBridgeStateConfig.project_id == project_id,
        )
    )
    config = result.scalar_one_or_none()

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
