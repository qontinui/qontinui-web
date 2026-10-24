"""Ownership lookups shared by the ui_bridge_states routers.

Each helper resolves one row scoped to its parent and raises the route's 404
when it is absent, so every router reports a missing parent identically.
"""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import project as project_crud
from app.crud import ui_bridge_exploration_session as session_crud
from app.crud import ui_bridge_state_graph as graph_crud
from app.models.project import Project
from app.models.ui_bridge_state import (
    UIBridgeExplorationSession,
    UIBridgeState,
    UIBridgeStateConfig,
)
from app.models.ui_bridge_transition import UIBridgeTransition


async def get_project_or_404(
    project_id: UUID,
    user_id: UUID,
    db: AsyncSession,
) -> Project:
    """Get project by ID, ensuring user has access."""
    project = await project_crud.get_owned_project(db, project_id, user_id)
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
    config = await graph_crud.get_config(db, project_id, config_id)
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
    *,
    with_knowledge: bool = False,
) -> UIBridgeState:
    """Get state by ID, ensuring it belongs to config.

    ``with_knowledge=True`` eager-loads the knowledge ``state_to_response``
    reads.
    """
    state = await graph_crud.get_state(
        db, config_id, state_id, with_knowledge=with_knowledge
    )
    if not state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State not found",
        )
    return state


async def get_exploration_session_or_404(
    session_id: UUID,
    project_id: UUID,
    db: AsyncSession,
) -> UIBridgeExplorationSession:
    """Get exploration session by ID, ensuring it belongs to project."""
    session = await session_crud.get_session(db, project_id, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exploration session not found",
        )
    return session


async def get_transition_or_404(
    transition_id: UUID,
    config_id: UUID,
    db: AsyncSession,
) -> UIBridgeTransition:
    """Get transition by ID, ensuring it belongs to config."""
    transition = await graph_crud.get_transition(db, config_id, transition_id)
    if not transition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transition not found",
        )
    return transition
