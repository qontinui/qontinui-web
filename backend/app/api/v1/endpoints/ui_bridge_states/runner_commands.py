"""Runner-dispatched routes: state discovery and pathfinding preview.

Thin: parse the request, hand it to ``app.services.ui_bridge_runner_commands``
(which owns runner selection and dispatch), present the result. Two routers
because ``__init__`` interleaves them with the others to keep today's route
registration order.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import ui_bridge_state_graph as graph_crud
from app.models.user import User
from app.schemas.ui_bridge_state import (
    PathfindingRequest,
    PathfindingResponse,
    UIBridgeDiscoverAndSaveRequest,
    UIBridgeDiscoverAndSaveResponse,
    UIBridgeStateConfigResponse,
)
from app.services import ui_bridge_runner_commands as runner_commands

from ._deps import get_project_or_404
from ._presenters import discovered_state_to_response

discover_router = APIRouter()
pathfind_router = APIRouter()


# =============================================================================
# Discovery and Save Endpoint
# =============================================================================


@discover_router.post(
    "/projects/{project_id}/ui-bridge-discover",
    response_model=UIBridgeDiscoverAndSaveResponse,
    status_code=status.HTTP_201_CREATED,
)
async def discover_and_save_states(
    project_id: UUID,
    request: UIBridgeDiscoverAndSaveRequest,
    runner_id: UUID | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Discover states from render logs and save to database.

    This endpoint dispatches the discovery work to the user's currently-
    connected qontinui-runner over the existing ``runner_command_ws``
    WebSocket relay (command ``state_machine.ui_bridge.discover``). The
    runner runs ``qontinui.discovery.state_discovery.StateDiscoveryService``
    against the supplied render-log entries and returns the discovered
    states + elements; web then persists the result to
    ``ui_bridge_state_configs`` + ``ui_bridge_states`` rows and returns
    the persisted shape.

    **Strategies:**
    - ``auto`` (default): fingerprint strategy with ID fallback.
    - ``fingerprint``: enhanced discovery with element fingerprints.

    **Runner selection:**
    - If ``?runner_id=<uuid>`` is provided, that runner is used (must
      belong to the current user).
    - Otherwise the user's most-recently-heartbeat-active connected
      runner is selected.
    - If no runner is connected, returns 503 with the
      ``no_runner_connected`` envelope.
    """
    await get_project_or_404(project_id, current_user.id, db)

    result = await runner_commands.discover_and_persist(
        db,
        user=current_user,
        project_id=project_id,
        request=request,
        runner_id=runner_id,
    )

    return UIBridgeDiscoverAndSaveResponse(
        config=UIBridgeStateConfigResponse.model_validate(result.config),
        states=[discovered_state_to_response(s) for s in result.states],
        render_count=result.render_count,
        unique_element_count=result.unique_element_count,
    )


# =============================================================================
# Pathfinding Preview Endpoint
# =============================================================================


@pathfind_router.post(
    "/projects/{project_id}/ui-bridge-configs/{config_id}/pathfind",
    response_model=PathfindingResponse,
    status_code=status.HTTP_200_OK,
)
async def pathfind(
    project_id: UUID,
    config_id: UUID,
    request: PathfindingRequest,
    runner_id: UUID | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Find path between states using multistate pathfinding.

    This dispatches pathfinding work to the user's currently-connected
    qontinui-runner over the existing ``runner_command_ws`` WebSocket
    relay (command ``state_machine.ui_bridge.pathfind``). The runner
    reconstructs a ``UIBridgeRuntime`` from the serialised config
    (states + transitions) carried in the request and invokes
    ``find_path`` against the supplied ``from_states`` /
    ``target_states``. No actions are executed.

    **Runner selection** matches ``ui-bridge-discover``: optional
    ``?runner_id=<uuid>`` override, else the user's
    most-recently-heartbeat-active connected runner; 503 with
    ``no_runner_connected`` envelope otherwise.
    """
    await get_project_or_404(project_id, current_user.id, db)

    # Load the persisted config (states + transitions) — this is what
    # the runner reconstructs into a UIBridgeRuntime.
    config = await graph_crud.load_config_graph(
        db, project_id, config_id, with_knowledge=False
    )
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="State configuration not found",
        )

    return await runner_commands.pathfind(
        db,
        user=current_user,
        project_id=project_id,
        config_id=config_id,
        config=config,
        request=request,
        runner_id=runner_id,
    )
