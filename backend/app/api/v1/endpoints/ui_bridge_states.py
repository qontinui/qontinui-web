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
    UIBridgeDiscoverAndSaveRequest,
    UIBridgeDiscoverAndSaveResponse,
    UIBridgeStateConfigCreate,
    UIBridgeStateConfigListResponse,
    UIBridgeStateConfigResponse,
    UIBridgeStateConfigUpdate,
    UIBridgeStateConfigWithStates,
    UIBridgeStateDomainKnowledgeLink,
    UIBridgeStateListResponse,
    UIBridgeStateResponse,
    UIBridgeStateUpdate,
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
