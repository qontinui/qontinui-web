"""Model → response conversions shared by the ui_bridge_states routers."""

from typing import Any

from app.models.ui_bridge_state import UIBridgeState, UIBridgeStateConfig
from app.models.ui_bridge_transition import UIBridgeTransition
from app.schemas.ui_bridge_state import (
    DomainKnowledgeResponse,
    ExportResponse,
    UIBridgeStateResponse,
    UIBridgeTransitionResponse,
)


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


def discovered_state_to_response(state_row: UIBridgeState) -> UIBridgeStateResponse:
    """Convert a freshly discovered state row to a response.

    Built field by field, not via ``state_to_response``: these rows have no
    ``domain_knowledge_refs`` loaded, and an async lazy load raises.
    """
    return UIBridgeStateResponse(
        id=state_row.id,
        config_id=state_row.config_id,
        state_id=state_row.state_id,
        name=state_row.name,
        description=state_row.description,
        element_ids=state_row.element_ids or [],
        render_ids=state_row.render_ids or [],
        confidence=state_row.confidence,
        acceptance_criteria=state_row.acceptance_criteria or [],
        extra_metadata=state_row.extra_metadata or {},
        created_at=state_row.created_at,
        updated_at=state_row.updated_at,
        domain_knowledge=[],
    )


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


def build_export_response(config: UIBridgeStateConfig) -> ExportResponse:
    """Build the export payload matching ``UIBridgeRuntime.from_dict()``.

    ``config`` must have its states and transitions loaded.
    """
    # Build states dict matching UIBridgeState dataclass fields
    states_dict: dict[str, Any] = {}
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
    transitions_dict: dict[str, Any] = {}
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
