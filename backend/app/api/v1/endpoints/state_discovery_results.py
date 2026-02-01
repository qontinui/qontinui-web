"""
API endpoints for unified state discovery results.

Provides endpoints to:
- List all discovery results for a project (from any source)
- Get a specific discovery result with full state machine data
- Create discovery results (from UI Bridge, Playwright, etc.)
- Update and delete discovery results
- Export/import state machines
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.project import Project
from app.models.state_discovery_result import StateDiscoveryResult
from app.models.user import User
from app.schemas.state_discovery_result import (
    DiscoverySourceType,
    StateDiscoveryResultCreate,
    StateDiscoveryResultListResponse,
    StateDiscoveryResultResponse,
    StateDiscoveryResultSummary,
    StateDiscoveryResultUpdate,
    StateMachineExport,
    StateMachineImport,
)

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


async def get_result_or_404(
    result_id: UUID,
    project_id: UUID,
    db: AsyncSession,
) -> StateDiscoveryResult:
    """Get discovery result by ID, ensuring it belongs to project."""
    result = await db.execute(
        select(StateDiscoveryResult).where(
            StateDiscoveryResult.id == result_id,
            StateDiscoveryResult.project_id == project_id,
        )
    )
    discovery_result = result.scalar_one_or_none()
    if not discovery_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State discovery result not found",
        )
    return discovery_result


# =============================================================================
# List and Get Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/state-discovery-results",
    response_model=StateDiscoveryResultListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_discovery_results(
    project_id: UUID,
    source_type: DiscoverySourceType | None = Query(
        None, description="Filter by source type"
    ),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    List all state discovery results for a project.

    Returns summary information for quick display. Use the detail endpoint
    to get full state machine data.
    """
    await get_project_or_404(project_id, current_user.id, db)

    query = select(StateDiscoveryResult).where(
        StateDiscoveryResult.project_id == project_id
    )

    if source_type:
        query = query.where(StateDiscoveryResult.source_type == source_type.value)

    # Get total count
    count_result = await db.execute(
        select(StateDiscoveryResult.id).where(
            StateDiscoveryResult.project_id == project_id
        )
    )
    total = len(count_result.all())

    # Get paginated results
    query = query.order_by(StateDiscoveryResult.created_at.desc())
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    results = result.scalars().all()

    return StateDiscoveryResultListResponse(
        items=[StateDiscoveryResultSummary.model_validate(r) for r in results],
        total=total,
    )


@router.get(
    "/projects/{project_id}/state-discovery-results/{result_id}",
    response_model=StateDiscoveryResultResponse,
    status_code=status.HTTP_200_OK,
)
async def get_discovery_result(
    project_id: UUID,
    result_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a specific state discovery result with full state machine data.

    Includes images, states, transitions, and element mapping.
    """
    await get_project_or_404(project_id, current_user.id, db)
    discovery_result = await get_result_or_404(result_id, project_id, db)

    return StateDiscoveryResultResponse.model_validate(discovery_result)


# =============================================================================
# Create Endpoint
# =============================================================================


@router.post(
    "/projects/{project_id}/state-discovery-results",
    response_model=StateDiscoveryResultResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_discovery_result(
    project_id: UUID,
    request: StateDiscoveryResultCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Create a new state discovery result.

    This endpoint is called after running state discovery from any source
    (Playwright, UI Bridge, recording, etc.) to save the unified state machine.
    """
    await get_project_or_404(project_id, current_user.id, db)

    # Convert Pydantic models to dicts for JSON storage
    images_data = [img.model_dump() for img in request.images]
    states_data = [state.model_dump() for state in request.states]
    transitions_data = [trans.model_dump() for trans in request.transitions]

    discovery_result = StateDiscoveryResult(
        project_id=project_id,
        name=request.name,
        description=request.description,
        source_type=request.source_type.value,
        source_session_id=request.source_session_id,
        discovery_strategy=request.discovery_strategy,
        images=images_data,
        states=states_data,
        transitions=transitions_data,
        element_to_renders=request.element_to_renders,
        image_count=len(request.images),
        state_count=len(request.states),
        transition_count=len(request.transitions),
        render_count=len(
            {
                render_id
                for render_ids in request.element_to_renders.values()
                for render_id in render_ids
            }
        ),
        unique_element_count=len(request.element_to_renders),
        confidence=request.confidence,
        discovery_metadata=request.discovery_metadata,
    )

    db.add(discovery_result)
    await db.commit()
    await db.refresh(discovery_result)

    logger.info(
        "Created state discovery result",
        result_id=str(discovery_result.id),
        project_id=str(project_id),
        source_type=request.source_type.value,
        state_count=len(request.states),
        user_id=str(current_user.id),
    )

    return StateDiscoveryResultResponse.model_validate(discovery_result)


# =============================================================================
# Update and Delete Endpoints
# =============================================================================


@router.patch(
    "/projects/{project_id}/state-discovery-results/{result_id}",
    response_model=StateDiscoveryResultResponse,
    status_code=status.HTTP_200_OK,
)
async def update_discovery_result(
    project_id: UUID,
    result_id: UUID,
    request: StateDiscoveryResultUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a state discovery result."""
    await get_project_or_404(project_id, current_user.id, db)
    discovery_result = await get_result_or_404(result_id, project_id, db)

    if request.name is not None:
        discovery_result.name = request.name
    if request.description is not None:
        discovery_result.description = request.description
    if request.images is not None:
        discovery_result.images = [img.model_dump() for img in request.images]
        discovery_result.image_count = len(request.images)
    if request.states is not None:
        discovery_result.states = [state.model_dump() for state in request.states]
        discovery_result.state_count = len(request.states)
    if request.transitions is not None:
        discovery_result.transitions = [
            trans.model_dump() for trans in request.transitions
        ]
        discovery_result.transition_count = len(request.transitions)
    if request.discovery_metadata is not None:
        discovery_result.discovery_metadata = request.discovery_metadata

    await db.commit()
    await db.refresh(discovery_result)

    return StateDiscoveryResultResponse.model_validate(discovery_result)


@router.delete(
    "/projects/{project_id}/state-discovery-results/{result_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_discovery_result(
    project_id: UUID,
    result_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete a state discovery result."""
    await get_project_or_404(project_id, current_user.id, db)
    discovery_result = await get_result_or_404(result_id, project_id, db)

    await db.delete(discovery_result)
    await db.commit()

    logger.info(
        "Deleted state discovery result",
        result_id=str(result_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )


# =============================================================================
# Export/Import Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/state-discovery-results/{result_id}/export",
    response_model=StateMachineExport,
    status_code=status.HTTP_200_OK,
)
async def export_state_machine(
    project_id: UUID,
    result_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Export a state machine in a portable format.

    The exported format can be imported into other projects or used
    for workflow automation.
    """
    await get_project_or_404(project_id, current_user.id, db)
    discovery_result = await get_result_or_404(result_id, project_id, db)

    return StateMachineExport(
        version="1.0.0",
        name=discovery_result.name,
        description=discovery_result.description,
        source_type=discovery_result.source_type,
        images=discovery_result.images,
        states=discovery_result.states,
        transitions=discovery_result.transitions,
        element_to_renders=discovery_result.element_to_renders,
        metadata={
            "original_id": str(discovery_result.id),
            "original_project_id": str(discovery_result.project_id),
            "exported_at": datetime.utcnow().isoformat(),
            "discovery_strategy": discovery_result.discovery_strategy,
            "confidence": discovery_result.confidence,
        },
    )


@router.post(
    "/projects/{project_id}/state-discovery-results/import",
    response_model=StateDiscoveryResultResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_state_machine(
    project_id: UUID,
    request: StateMachineImport,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Import a state machine from an exported format.

    Creates a new discovery result in the project from the imported data.
    """
    await get_project_or_404(project_id, current_user.id, db)

    sm = request.state_machine
    name = request.name or sm.name

    # Convert to dicts for storage
    images_data = [img.model_dump() for img in sm.images]
    states_data = [state.model_dump() for state in sm.states]
    transitions_data = [trans.model_dump() for trans in sm.transitions]

    discovery_result = StateDiscoveryResult(
        project_id=project_id,
        name=name,
        description=sm.description,
        source_type=sm.source_type,
        source_session_id=None,  # Imported, no original session
        discovery_strategy=sm.metadata.get("discovery_strategy"),
        images=images_data,
        states=states_data,
        transitions=transitions_data,
        element_to_renders=sm.element_to_renders,
        image_count=len(sm.images),
        state_count=len(sm.states),
        transition_count=len(sm.transitions),
        render_count=len(
            {
                render_id
                for render_ids in sm.element_to_renders.values()
                for render_id in render_ids
            }
        ),
        unique_element_count=len(sm.element_to_renders),
        confidence=sm.metadata.get("confidence", 0.0),
        discovery_metadata={
            "imported": True,
            "imported_at": datetime.utcnow().isoformat(),
            "original_metadata": sm.metadata,
        },
    )

    db.add(discovery_result)
    await db.commit()
    await db.refresh(discovery_result)

    logger.info(
        "Imported state machine",
        result_id=str(discovery_result.id),
        project_id=str(project_id),
        original_name=sm.name,
        user_id=str(current_user.id),
    )

    return StateDiscoveryResultResponse.model_validate(discovery_result)
