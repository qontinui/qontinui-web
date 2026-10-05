"""CRUD operations for the UI Bridge state graph.

Covers the four row kinds that make up one discovered state machine:
``UIBridgeStateConfig`` (the graph), ``UIBridgeState`` (its nodes),
``UIBridgeStateDomainKnowledge`` (knowledge links on a node) and
``UIBridgeTransition`` (its edges).

Commit boundaries are part of each function's contract and are named in
its docstring. ``add_*`` functions never commit, so callers that build a
whole graph (discovery, the recording pipeline) commit once, after every
row is added. The ``create_*`` / ``update_*`` / ``delete_*`` functions
commit, matching the single-resource routes that call them.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.ui_bridge_state import (
    UIBridgeState,
    UIBridgeStateConfig,
    UIBridgeStateDomainKnowledge,
)
from app.models.ui_bridge_transition import UIBridgeTransition
from app.schemas.ui_bridge_state import (
    UIBridgeStateUpdate,
    UIBridgeTransitionCreate,
    UIBridgeTransitionUpdate,
)


def _state_knowledge_option() -> Any:
    """Eager-load option: a state's knowledge links and their knowledge rows."""
    return selectinload(UIBridgeState.domain_knowledge_refs).selectinload(
        UIBridgeStateDomainKnowledge.knowledge
    )


# =============================================================================
# Configs
# =============================================================================


async def list_configs(
    db: AsyncSession, project_id: UUID
) -> Sequence[UIBridgeStateConfig]:
    """List a project's configs, most recently updated first."""
    result = await db.execute(
        select(UIBridgeStateConfig)
        .where(UIBridgeStateConfig.project_id == project_id)
        .order_by(UIBridgeStateConfig.updated_at.desc())
    )
    return result.scalars().all()


async def get_config(
    db: AsyncSession, project_id: UUID, config_id: UUID
) -> UIBridgeStateConfig | None:
    """Get a config by ID, scoped to its project. No relationships loaded."""
    result = await db.execute(
        select(UIBridgeStateConfig).where(
            UIBridgeStateConfig.id == config_id,
            UIBridgeStateConfig.project_id == project_id,
        )
    )
    return result.scalar_one_or_none()


async def get_config_with_states(
    db: AsyncSession, project_id: UUID, config_id: UUID
) -> UIBridgeStateConfig | None:
    """Get a config with its states and their knowledge (no transitions)."""
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
    return result.scalar_one_or_none()


async def load_config_graph(
    db: AsyncSession,
    project_id: UUID,
    config_id: UUID,
    *,
    with_knowledge: bool,
) -> UIBridgeStateConfig | None:
    """Load a config with its states and transitions eagerly.

    ``with_knowledge=True`` also loads each state's knowledge links and the
    linked knowledge rows, which ``state_to_response`` reads.
    """
    states_option = selectinload(UIBridgeStateConfig.states)
    if with_knowledge:
        states_option = states_option.selectinload(
            UIBridgeState.domain_knowledge_refs
        ).selectinload(UIBridgeStateDomainKnowledge.knowledge)

    result = await db.execute(
        select(UIBridgeStateConfig)
        .options(
            states_option,
            selectinload(UIBridgeStateConfig.transitions),
        )
        .where(
            UIBridgeStateConfig.id == config_id,
            UIBridgeStateConfig.project_id == project_id,
        )
    )
    return result.scalar_one_or_none()


async def add_config(
    db: AsyncSession,
    *,
    project_id: UUID,
    name: str,
    description: str | None = None,
    render_count: int = 0,
    element_count: int = 0,
    include_html_ids: bool = False,
    discovery_result: dict[str, Any] | None = None,
) -> UIBridgeStateConfig:
    """Add a config and flush so its ``id`` is populated. Does not commit.

    The keyword defaults equal the model's column defaults, so omitting a
    field produces the same row as not setting it on the model.
    """
    config = UIBridgeStateConfig(
        project_id=project_id,
        name=name,
        description=description,
        render_count=render_count,
        element_count=element_count,
        include_html_ids=include_html_ids,
        discovery_result=discovery_result if discovery_result is not None else {},
    )
    db.add(config)
    await db.flush()
    return config


async def create_config(
    db: AsyncSession,
    project_id: UUID,
    *,
    name: str,
    description: str | None,
    include_html_ids: bool,
) -> UIBridgeStateConfig:
    """Create an empty config. Commits, then refreshes it."""
    config = await add_config(
        db,
        project_id=project_id,
        name=name,
        description=description,
        include_html_ids=include_html_ids,
    )
    await db.commit()
    await db.refresh(config)
    return config


async def update_config(
    db: AsyncSession,
    config: UIBridgeStateConfig,
    *,
    name: str | None,
    description: str | None,
) -> UIBridgeStateConfig:
    """Apply the non-``None`` fields. Commits, then refreshes the config."""
    if name is not None:
        config.name = name
    if description is not None:
        config.description = description

    await db.commit()
    await db.refresh(config)
    return config


async def delete_config(db: AsyncSession, config: UIBridgeStateConfig) -> None:
    """Delete a config. Commits.

    Goes through the ORM so the ``all, delete-orphan`` cascade removes its
    states (and their knowledge links) and transitions.
    """
    await db.delete(config)
    await db.commit()


async def create_discovered_config(
    db: AsyncSession,
    *,
    project_id: UUID,
    name: str,
    description: str | None,
    render_count: int,
    element_count: int,
    include_html_ids: bool,
    discovery_result: dict[str, Any],
    states: Sequence[Mapping[str, Any]],
) -> tuple[UIBridgeStateConfig, list[UIBridgeState]]:
    """Persist a discovered config and its states atomically.

    ``states`` holds :func:`add_state` keyword arguments (without
    ``config_id``). Commits exactly once, after every row is added, then
    refreshes the config and each state.
    """
    config = await add_config(
        db,
        project_id=project_id,
        name=name,
        description=description,
        render_count=render_count,
        element_count=element_count,
        include_html_ids=include_html_ids,
        discovery_result=discovery_result,
    )

    state_rows = [add_state(db, config_id=config.id, **fields) for fields in states]

    await db.commit()

    await db.refresh(config)
    for state_row in state_rows:
        await db.refresh(state_row)

    return config, state_rows


# =============================================================================
# States
# =============================================================================


async def list_states(db: AsyncSession, config_id: UUID) -> Sequence[UIBridgeState]:
    """List a config's states by name, with their knowledge loaded."""
    result = await db.execute(
        select(UIBridgeState)
        .options(_state_knowledge_option())
        .where(UIBridgeState.config_id == config_id)
        .order_by(UIBridgeState.name)
    )
    return result.scalars().all()


async def get_state(
    db: AsyncSession,
    config_id: UUID,
    state_id: UUID,
    *,
    with_knowledge: bool,
) -> UIBridgeState | None:
    """Get a state by ID, scoped to its config.

    ``with_knowledge=True`` eager-loads its knowledge links and rows.
    """
    query = select(UIBridgeState)
    if with_knowledge:
        query = query.options(_state_knowledge_option())
    result = await db.execute(
        query.where(
            UIBridgeState.id == state_id,
            UIBridgeState.config_id == config_id,
        )
    )
    return result.scalar_one_or_none()


def add_state(
    db: AsyncSession,
    *,
    config_id: UUID,
    state_id: str,
    name: str,
    element_ids: list[Any],
    confidence: float,
    render_ids: list[Any] | None = None,
    extra_metadata: dict[str, Any] | None = None,
) -> UIBridgeState:
    """Add a state to the session. Does not flush or commit.

    Omitted ``render_ids`` / ``extra_metadata`` take the model defaults
    (``[]`` / ``{}``).
    """
    state = UIBridgeState(
        config_id=config_id,
        state_id=state_id,
        name=name,
        element_ids=element_ids,
        render_ids=render_ids if render_ids is not None else [],
        confidence=confidence,
        extra_metadata=extra_metadata if extra_metadata is not None else {},
    )
    db.add(state)
    return state


async def update_state(
    db: AsyncSession, state: UIBridgeState, data: UIBridgeStateUpdate
) -> UIBridgeState:
    """Apply the non-``None`` fields. Commits, then refreshes the state."""
    if data.name is not None:
        state.name = data.name
    if data.description is not None:
        state.description = data.description
    if data.acceptance_criteria is not None:
        state.acceptance_criteria = data.acceptance_criteria
    if data.extra_metadata is not None:
        state.extra_metadata = data.extra_metadata

    await db.commit()
    await db.refresh(state)
    return state


# =============================================================================
# Knowledge links
# =============================================================================


async def get_knowledge_link(
    db: AsyncSession, state_id: UUID, knowledge_id: UUID
) -> UIBridgeStateDomainKnowledge | None:
    """Get the link between a state and a knowledge row, if any."""
    result = await db.execute(
        select(UIBridgeStateDomainKnowledge).where(
            UIBridgeStateDomainKnowledge.state_id == state_id,
            UIBridgeStateDomainKnowledge.knowledge_id == knowledge_id,
        )
    )
    return result.scalar_one_or_none()


async def link_knowledge(
    db: AsyncSession,
    state: UIBridgeState,
    *,
    knowledge_id: UUID,
    order: int,
) -> UIBridgeState:
    """Link knowledge to a state. Commits.

    Returns the state re-queried with its knowledge eager-loaded, so the
    new link is visible without an async lazy load.
    """
    state_id = state.id
    link = UIBridgeStateDomainKnowledge(
        state_id=state_id,
        knowledge_id=knowledge_id,
        order=order,
    )
    db.add(link)
    await db.commit()

    await db.refresh(state)
    result = await db.execute(
        select(UIBridgeState)
        .options(_state_knowledge_option())
        .where(UIBridgeState.id == state_id)
    )
    return result.scalar_one()


async def delete_knowledge_link(
    db: AsyncSession, link: UIBridgeStateDomainKnowledge
) -> None:
    """Delete a knowledge link. Commits."""
    await db.delete(link)
    await db.commit()


# =============================================================================
# Transitions
# =============================================================================


def transition_id_from_name(name: str) -> str:
    """Derive a transition's slug ID from its display name."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


async def list_transitions(
    db: AsyncSession, config_id: UUID
) -> Sequence[UIBridgeTransition]:
    """List a config's transitions by name."""
    result = await db.execute(
        select(UIBridgeTransition)
        .where(UIBridgeTransition.config_id == config_id)
        .order_by(UIBridgeTransition.name)
    )
    return result.scalars().all()


async def get_transition(
    db: AsyncSession, config_id: UUID, transition_id: UUID
) -> UIBridgeTransition | None:
    """Get a transition by row ID, scoped to its config."""
    result = await db.execute(
        select(UIBridgeTransition).where(
            UIBridgeTransition.id == transition_id,
            UIBridgeTransition.config_id == config_id,
        )
    )
    return result.scalar_one_or_none()


def add_transition(
    db: AsyncSession,
    *,
    config_id: UUID,
    transition_id: str,
    name: str,
    from_states: list[Any],
    activate_states: list[Any],
    exit_states: list[Any],
    actions: list[Any],
    path_cost: float,
    stays_visible: bool,
    extra_metadata: dict[str, Any],
) -> UIBridgeTransition:
    """Add a transition to the session. Does not flush or commit."""
    transition = UIBridgeTransition(
        config_id=config_id,
        transition_id=transition_id,
        name=name,
        from_states=from_states,
        activate_states=activate_states,
        exit_states=exit_states,
        actions=actions,
        path_cost=path_cost,
        stays_visible=stays_visible,
        extra_metadata=extra_metadata,
    )
    db.add(transition)
    return transition


async def create_transition(
    db: AsyncSession, config_id: UUID, data: UIBridgeTransitionCreate
) -> UIBridgeTransition:
    """Create a transition, deriving its ``transition_id`` from its name.

    Commits, then refreshes it.
    """
    transition = add_transition(
        db,
        config_id=config_id,
        transition_id=transition_id_from_name(data.name),
        name=data.name,
        from_states=data.from_states,
        activate_states=data.activate_states,
        exit_states=data.exit_states,
        actions=[a.model_dump(exclude_none=True) for a in data.actions],
        path_cost=data.path_cost,
        stays_visible=data.stays_visible,
        extra_metadata=data.extra_metadata,
    )
    await db.commit()
    await db.refresh(transition)
    return transition


async def update_transition(
    db: AsyncSession, transition: UIBridgeTransition, data: UIBridgeTransitionUpdate
) -> UIBridgeTransition:
    """Apply the non-``None`` fields. Commits, then refreshes the transition.

    A renamed transition keeps its ``transition_id``; it is derived on
    create only.
    """
    if data.name is not None:
        transition.name = data.name
    if data.from_states is not None:
        transition.from_states = data.from_states
    if data.activate_states is not None:
        transition.activate_states = data.activate_states
    if data.exit_states is not None:
        transition.exit_states = data.exit_states
    if data.actions is not None:
        transition.actions = [a.model_dump(exclude_none=True) for a in data.actions]
    if data.path_cost is not None:
        transition.path_cost = data.path_cost
    if data.stays_visible is not None:
        transition.stays_visible = data.stays_visible
    if data.extra_metadata is not None:
        transition.extra_metadata = data.extra_metadata

    await db.commit()
    await db.refresh(transition)
    return transition


async def delete_transition(db: AsyncSession, transition: UIBridgeTransition) -> None:
    """Delete a transition. Commits."""
    await db.delete(transition)
    await db.commit()
