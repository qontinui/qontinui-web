"""Runner-dispatched UI Bridge state-machine commands: discover and pathfind.

Both flows ship work to the caller's connected qontinui-runner over the
``runner_command_ws`` relay and own everything between the HTTP route and
the runner: runner selection, the command payload, the dispatch error
mapping (shared, :func:`dispatch_or_http_error`), the runner-``error`` arm,
and — for discover — persisting the result.

The routes stay thin (parse → service → present). Errors are raised as
``HTTPException`` here, as the other WS-bridge services do, because the
503/504/500 envelopes ARE the contract of these routes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import HTTPException, status
from qontinui_schemas.commands.state_machine import (
    UIBridgeDiscoverRequest,
    UIBridgeDiscoverResponse,
    UIBridgePathfindRequest,
    UIBridgePathfindResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_config import get_redis
from app.crud import ui_bridge_state_graph as graph_crud
from app.models.ui_bridge_state import UIBridgeState, UIBridgeStateConfig
from app.models.user import User
from app.schemas.ui_bridge_state import (
    PathfindingRequest,
    PathfindingResponse,
    PathfindingStep,
    UIBridgeDiscoverAndSaveRequest,
)
from app.services.runner import dispatch_or_http_error, resolve_runner_for_request
from app.services.runner_websocket_manager import get_runner_websocket_manager

# The discover/pathfind events were emitted by the endpoint module before
# this extraction; keep its logger name so the `logger` field is unchanged.
logger = structlog.get_logger("app.api.v1.endpoints.ui_bridge_states")

_UI_BRIDGE_DISCOVER_ENDPOINT = "/api/v1/projects/{project_id}/ui-bridge-discover"
_UI_BRIDGE_PATHFIND_ENDPOINT = (
    "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/pathfind"
)

_DISPATCH_TIMEOUT_S = 30.0


@dataclass(frozen=True)
class DiscoverResult:
    """What a discover run persisted, for the route to present."""

    config: UIBridgeStateConfig
    states: list[UIBridgeState]
    render_count: int
    unique_element_count: int


def _discovered_state_rows(response: UIBridgeDiscoverResponse) -> list[dict[str, Any]]:
    """Coerce the runner's loosely-typed state dicts into crud row specs."""
    return [
        {
            "state_id": str(s["id"]),
            "name": str(s["name"]),
            "element_ids": list(s.get("element_ids") or []),
            "render_ids": list(s.get("render_ids") or []),
            "confidence": float(s.get("confidence") or 0.0),
        }
        for s in response.states
    ]


async def discover_and_persist(
    db: AsyncSession,
    *,
    user: User,
    project_id: UUID,
    request: UIBridgeDiscoverAndSaveRequest,
    runner_id: UUID | None,
) -> DiscoverResult:
    """Run state discovery on the runner, then persist config + states.

    The runner's response is validated before anything is written, so a
    runner error (500) or an invalid response leaves the database untouched.
    The config and every state row land in one commit.
    """
    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)
    runner = await resolve_runner_for_request(
        runner_id, user.id, db, manager, _UI_BRIDGE_DISCOVER_ENDPOINT
    )

    request_id = uuid4()
    cmd = UIBridgeDiscoverRequest(
        request_id=request_id,
        project_id=project_id,
        renders=request.renders,
        config_name=request.config_name,
        config_description=request.config_description,
        include_html_ids=request.include_html_ids,
        cooccurrence_export=request.cooccurrence_export,
        strategy=request.strategy.value,
    ).model_dump(mode="json")

    logger.info(
        "ui_bridge_discover_save_dispatch",
        runner_id=str(runner.id),
        request_id=str(request_id),
        project_id=str(project_id),
        render_count=len(request.renders),
        strategy=request.strategy.value,
        config_name=request.config_name,
    )

    raw_response = await dispatch_or_http_error(
        manager,
        runner,
        cmd,
        request_id,
        _UI_BRIDGE_DISCOVER_ENDPOINT,
        _DISPATCH_TIMEOUT_S,
        "ui_bridge_discover_save",
        log=logger,
    )

    if raw_response.get("error"):
        logger.error(
            "ui_bridge_discover_save_runner_error",
            runner_id=str(runner.id),
            request_id=str(request_id),
            error=raw_response.get("error"),
            message=raw_response.get("message"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "runner_error",
                "runner_error": raw_response.get("error"),
                "message": raw_response.get("message") or "Runner returned an error.",
            },
        )

    response = UIBridgeDiscoverResponse.model_validate(raw_response)

    # The runner is stateless w.r.t. persistence; web owns the
    # ui_bridge_state_configs + ui_bridge_states rows.
    config, states = await graph_crud.create_discovered_config(
        db,
        project_id=project_id,
        name=request.config_name,
        description=request.config_description,
        render_count=response.render_count,
        element_count=response.unique_element_count,
        include_html_ids=request.include_html_ids,
        discovery_result={
            "element_to_renders": response.element_to_renders,
            "strategy_used": response.strategy_used,
            "strategy_metadata": response.strategy_metadata,
        },
        states=_discovered_state_rows(response),
    )

    logger.info(
        "ui_bridge_discover_save_completed",
        runner_id=str(runner.id),
        request_id=str(request_id),
        project_id=str(project_id),
        config_id=str(config.id),
        states_persisted=len(states),
        render_count=response.render_count,
        element_count=response.unique_element_count,
        strategy_used=response.strategy_used,
    )

    return DiscoverResult(
        config=config,
        states=list(states),
        render_count=response.render_count,
        unique_element_count=response.unique_element_count,
    )


def build_pathfind_config_payload(config: UIBridgeStateConfig) -> dict[str, Any]:
    """Serialize a loaded config graph into the runner's pathfind ``config``.

    Per state only ``state_id``/``name``/``element_ids`` are sent; the
    export route's ``blocking``/``blocks``/``group``/``path_cost`` are not
    (a known divergence, out of scope for a behaviour-preserving refactor).
    """
    return {
        "states": [
            {
                "state_id": s.state_id,
                "name": s.name,
                "element_ids": list(s.element_ids or []),
            }
            for s in config.states
        ],
        "transitions": [
            {
                "transition_id": t.transition_id,
                "name": t.name,
                "from_states": list(t.from_states or []),
                "activate_states": list(t.activate_states or []),
                "exit_states": list(t.exit_states or []),
                "actions": list(t.actions or []),
                "path_cost": float(t.path_cost),
                "stays_visible": bool(t.stays_visible),
            }
            for t in config.transitions
        ],
    }


async def pathfind(
    db: AsyncSession,
    *,
    user: User,
    project_id: UUID,
    config_id: UUID,
    config: UIBridgeStateConfig,
    request: PathfindingRequest,
    runner_id: UUID | None,
) -> PathfindingResponse:
    """Ask the runner for a path through ``config`` (loaded with its graph).

    A runner-side exception comes back as ``found=False`` with the runner's
    error in ``error``, as does "no path"; only relay failures raise.
    """
    config_payload = build_pathfind_config_payload(config)

    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)
    runner = await resolve_runner_for_request(
        runner_id, user.id, db, manager, _UI_BRIDGE_PATHFIND_ENDPOINT
    )

    request_id = uuid4()
    cmd = UIBridgePathfindRequest(
        request_id=request_id,
        project_id=project_id,
        config_id=config_id,
        from_states=list(request.from_states),
        target_states=list(request.target_states),
        config=config_payload,
    ).model_dump(mode="json")

    logger.info(
        "ui_bridge_pathfind_dispatch",
        runner_id=str(runner.id),
        request_id=str(request_id),
        config_id=str(config_id),
        from_state_count=len(request.from_states),
        target_state_count=len(request.target_states),
        state_count=len(config_payload["states"]),
        transition_count=len(config_payload["transitions"]),
    )

    raw_response = await dispatch_or_http_error(
        manager,
        runner,
        cmd,
        request_id,
        _UI_BRIDGE_PATHFIND_ENDPOINT,
        _DISPATCH_TIMEOUT_S,
        "ui_bridge_pathfind",
        log=logger,
    )

    if raw_response.get("error") and raw_response.get("type") == "command_response":
        # Distinguish "no path" (UIBridgePathfindResponse with found=False
        # and a string `error`) from runner-side exceptions
        # (UIBridgePathfindError with a `traceback` field and an enum
        # `error` literal). The latter has no `found` field.
        if "found" not in raw_response:
            logger.error(
                "ui_bridge_pathfind_runner_error",
                runner_id=str(runner.id),
                request_id=str(request_id),
                error=raw_response.get("error"),
                message=raw_response.get("message"),
            )
            return PathfindingResponse(
                found=False,
                error=(
                    f"Runner error ({raw_response.get('error')}): "
                    f"{raw_response.get('message') or 'unknown'}"
                ),
            )

    response = UIBridgePathfindResponse.model_validate(raw_response)

    logger.info(
        "ui_bridge_pathfind_completed",
        runner_id=str(runner.id),
        request_id=str(request_id),
        config_id=str(config_id),
        found=response.found,
        step_count=len(response.steps),
        total_cost=response.total_cost,
    )

    return PathfindingResponse(
        found=response.found,
        steps=[
            PathfindingStep(
                transition_id=step.transition_id,
                transition_name=step.transition_name,
                from_states=list(step.from_states),
                activate_states=list(step.activate_states),
                exit_states=list(step.exit_states),
                path_cost=step.path_cost,
            )
            for step in response.steps
        ],
        total_cost=response.total_cost,
        error=response.error,
    )


__all__ = [
    "DiscoverResult",
    "build_pathfind_config_payload",
    "discover_and_persist",
    "pathfind",
]
