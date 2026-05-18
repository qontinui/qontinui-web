"""
State Discovery API endpoints.

Provides endpoints to trigger state discovery and retrieve discovered states
from automation sessions.
"""

from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from qontinui_schemas.commands.state_machine import (
    DiscoverUIBridgeRequest,
    DiscoverUIBridgeResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.config.redis_config import get_redis
from app.models.user import User
from app.schemas.state_discovery import (
    StateDiscoveryResponse,
    StateDiscoveryTriggerRequest,
)
from app.services.runner import (
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
    pick_active_runner_for_user,
    runner_bridge_503_no_runner,
)
from app.services.runner_websocket_manager import get_runner_websocket_manager
from app.services.state_discovery_service import state_discovery_service

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/sessions/{session_id}/discover-states",
    response_model=StateDiscoveryResponse,
    status_code=status.HTTP_200_OK,
)
async def trigger_state_discovery(
    *,
    session_id: UUID,
    request: StateDiscoveryTriggerRequest = StateDiscoveryTriggerRequest(),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Trigger state discovery for an automation session.

    Analyzes screenshots and input events to discover states and state transitions.

    **Parameters:**
    - `session_id`: Automation session UUID
    - `request.algorithm`: Algorithm to use (default: "timestamp_clustering")
    - `request.parameters`: Algorithm-specific parameters

    **Returns:**
    - Discovered states and transitions
    - Processing metadata

    **Algorithms:**
    - `timestamp_clustering`: Groups screenshots by temporal proximity
      - Parameters:
        - `state_threshold_seconds` (float, default: 2.0): Min time gap for new state
        - `max_input_distance_seconds` (float, default: 5.0): Max time to associate inputs

    **Example:**
    ```json
    {
      "algorithm": "timestamp_clustering",
      "parameters": {
        "state_threshold_seconds": 3.0,
        "max_input_distance_seconds": 10.0
      }
    }
    ```
    """
    logger.info(
        "state_discovery_request",
        session_id=str(session_id),
        user_id=str(current_user.id),
        algorithm=request.algorithm,
    )

    try:
        # Perform state discovery
        result = await state_discovery_service.discover_states_from_session(
            session_id=session_id,
            db=db,
            algorithm=request.algorithm,
            parameters=request.parameters,
        )

        logger.info(
            "state_discovery_success",
            session_id=str(session_id),
            user_id=str(current_user.id),
            total_states=result.total_states,
            total_transitions=result.total_transitions,
        )

        return result

    except ValueError as e:
        logger.warning(
            "state_discovery_invalid_input",
            session_id=str(session_id),
            user_id=str(current_user.id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        logger.error(
            "state_discovery_error",
            session_id=str(session_id),
            user_id=str(current_user.id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"State discovery failed: {str(e)}",
        )


@router.get(
    "/sessions/{session_id}/discovered-states",
    response_model=StateDiscoveryResponse,
    status_code=status.HTTP_200_OK,
)
async def get_discovered_states(
    *,
    session_id: UUID,
    algorithm: str = "timestamp_clustering",
    state_threshold_seconds: float = 2.0,
    max_input_distance_seconds: float = 5.0,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get discovered states for an automation session.

    This endpoint performs state discovery on-demand using the specified algorithm
    and parameters.

    **Parameters:**
    - `session_id`: Automation session UUID
    - `algorithm`: Algorithm to use (default: "timestamp_clustering")
    - `state_threshold_seconds`: Min time gap for new state (default: 2.0)
    - `max_input_distance_seconds`: Max time to associate inputs (default: 5.0)

    **Returns:**
    - Discovered states and transitions
    - Processing metadata

    **Example Response:**
    ```json
    {
      "session_id": "123e4567-e89b-12d3-a456-426614174000",
      "total_states": 5,
      "total_transitions": 4,
      "states": [
        {
          "state_id": "state_0",
          "screenshot_ids": [1, 2, 3],
          "representative_screenshot_id": 1,
          "timestamp_first_seen": "2025-11-16T12:00:00Z",
          "timestamp_last_seen": "2025-11-16T12:00:05Z",
          "visit_count": 1,
          "input_events": [10, 11],
          "outgoing_transitions": [
            {
              "from_state_id": "state_0",
              "to_state_id": "state_1",
              "trigger_event_id": 11,
              "event_type": "mouse.clicked",
              "timestamp": "2025-11-16T12:00:05Z",
              "confidence": 1.0
            }
          ],
          "metadata": {
            "screenshot_count": 3,
            "duration_seconds": 5.0
          }
        }
      ],
      "algorithm": "timestamp_clustering",
      "parameters": {
        "state_threshold_seconds": 2.0,
        "max_input_distance_seconds": 5.0
      },
      "processing_time_ms": 45.2
    }
    ```
    """
    logger.info(
        "get_discovered_states_request",
        session_id=str(session_id),
        user_id=str(current_user.id),
        algorithm=algorithm,
    )

    try:
        # Build parameters
        parameters = {
            "state_threshold_seconds": state_threshold_seconds,
            "max_input_distance_seconds": max_input_distance_seconds,
        }

        # Perform state discovery
        result = await state_discovery_service.discover_states_from_session(
            session_id=session_id,
            db=db,
            algorithm=algorithm,
            parameters=parameters,
        )

        logger.info(
            "get_discovered_states_success",
            session_id=str(session_id),
            user_id=str(current_user.id),
            total_states=result.total_states,
            total_transitions=result.total_transitions,
        )

        return result

    except ValueError as e:
        logger.warning(
            "get_discovered_states_invalid_input",
            session_id=str(session_id),
            user_id=str(current_user.id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        logger.error(
            "get_discovered_states_error",
            session_id=str(session_id),
            user_id=str(current_user.id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"State discovery failed: {str(e)}",
        )


# =============================================================================
# UI Bridge State Discovery (Discovery Only - No Persistence)
# =============================================================================


class UIBridgeDiscoveryStrategy(StrEnum):
    """Discovery strategy options."""

    AUTO = "auto"
    FINGERPRINT = "fingerprint"


class UIBridgeDiscoverRequest(BaseModel):
    """Request for UI Bridge state discovery (no persistence)."""

    renders: list[dict] = Field(
        default_factory=list, description="List of render log entries to analyze"
    )
    include_html_ids: bool = Field(
        default=False, description="Whether to include HTML id attributes"
    )
    cooccurrence_export: dict | None = Field(
        default=None,
        description="Co-occurrence export with fingerprint data for enhanced discovery",
    )
    strategy: UIBridgeDiscoveryStrategy = Field(
        default=UIBridgeDiscoveryStrategy.AUTO,
        description="Discovery strategy: auto or fingerprint",
    )


class UIBridgeDiscoveredState(BaseModel):
    """A discovered state from UI Bridge analysis."""

    id: str
    name: str
    state_image_ids: list[str] = Field(alias="element_ids")
    screenshot_ids: list[str] = Field(alias="render_ids")
    confidence: float
    position_zone: str | None = None
    landmark_context: str | None = None
    is_global: bool = False
    is_modal: bool = False

    model_config = {"populate_by_name": True}


class UIBridgeDiscoveredElement(BaseModel):
    """A discovered element from UI Bridge analysis."""

    id: str
    name: str
    type: str = Field(alias="element_type")
    render_ids: list[str]
    fingerprint_hash: str | None = None
    position_zone: str | None = None

    model_config = {"populate_by_name": True}


class UIBridgeDiscoveryResponse(BaseModel):
    """Response from UI Bridge state discovery."""

    states: list[UIBridgeDiscoveredState]
    elements: list[UIBridgeDiscoveredElement]
    element_to_renders: dict[str, list[str]]
    render_count: int
    unique_element_count: int
    strategy_used: str
    strategy_metadata: dict = Field(default_factory=dict)


_UI_BRIDGE_DISCOVER_ENDPOINT = "/api/v1/state-discovery/ui-bridge/discover-states"


@router.post(
    "/ui-bridge/discover-states",
    response_model=UIBridgeDiscoveryResponse,
    status_code=status.HTTP_200_OK,
)
async def discover_ui_bridge_states(
    request: UIBridgeDiscoverRequest,
    runner_id: UUID | None = None,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Discover states from UI Bridge render logs (no persistence).

    This endpoint dispatches the discovery work to the user's currently-
    connected qontinui-runner over the existing
    ``runner_command_ws`` WebSocket relay (command
    ``state_machine.discover_ui_bridge``). The runner runs
    ``qontinui.discovery.state_discovery.StateDiscoveryService`` against
    the supplied render-log entries and returns the discovered states +
    elements; web does not persist anything.

    **Strategies:**
    - ``auto`` (default): fingerprint strategy with ID fallback.
    - ``fingerprint``: enhanced discovery with element fingerprints.

    For fingerprint discovery, provide ``cooccurrence_export`` with
    fingerprint data.

    **Runner selection:**

    - If ``?runner_id=<uuid>`` is provided, that runner is used (must
      belong to the current user).
    - Otherwise the user's most-recently-heartbeat-active connected
      runner is selected.
    - If no runner is connected, the endpoint returns 503 with the
      ``no_runner_connected`` envelope.
    """
    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)

    if runner_id is not None:
        from app.crud import runner_crud

        owned_runner = await runner_crud.get_runner(db, runner_id=runner_id)
        if owned_runner is None or owned_runner.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error": "runner_not_found", "runner_id": str(runner_id)},
            )
        if not manager.registry.is_runner_connected(str(owned_runner.id)):
            raise runner_bridge_503_no_runner(_UI_BRIDGE_DISCOVER_ENDPOINT)
        runner = owned_runner
    else:
        picked = await pick_active_runner_for_user(
            current_user.id, db, manager.registry
        )
        if picked is None:
            raise runner_bridge_503_no_runner(_UI_BRIDGE_DISCOVER_ENDPOINT)
        runner = picked

    request_id = uuid4()
    cmd = DiscoverUIBridgeRequest(
        request_id=request_id,
        project_id=None,
        renders=request.renders,
        include_html_ids=request.include_html_ids,
        cooccurrence_export=request.cooccurrence_export,
        strategy=request.strategy.value,
    ).model_dump(mode="json")

    logger.info(
        "ui_bridge_discover_dispatch",
        runner_id=str(runner.id),
        request_id=str(request_id),
        render_count=len(request.renders),
        strategy=request.strategy.value,
        has_cooccurrence_export=request.cooccurrence_export is not None,
    )

    try:
        raw_response = await manager.relay.dispatch_and_wait(
            str(runner.id),
            cmd,
            request_id=str(request_id),
            timeout_s=30.0,
        )
    except RunnerNotConnectedError:
        logger.warning(
            "ui_bridge_discover_runner_disconnected_mid_dispatch",
            runner_id=str(runner.id),
            request_id=str(request_id),
        )
        raise runner_bridge_503_no_runner(_UI_BRIDGE_DISCOVER_ENDPOINT)
    except RunnerCommandTimeoutError:
        logger.error(
            "ui_bridge_discover_timeout",
            runner_id=str(runner.id),
            request_id=str(request_id),
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={
                "error": "runner_timeout",
                "endpoint": _UI_BRIDGE_DISCOVER_ENDPOINT,
                "request_id": str(request_id),
            },
        )

    if raw_response.get("error"):
        logger.error(
            "ui_bridge_discover_runner_error",
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

    response = DiscoverUIBridgeResponse.model_validate(raw_response)

    logger.info(
        "ui_bridge_discover_completed",
        runner_id=str(runner.id),
        request_id=str(request_id),
        states_found=len(response.states),
        elements_found=len(response.elements),
        strategy_used=response.strategy_used,
    )

    states = [UIBridgeDiscoveredState.model_validate(s) for s in response.states]
    elements = [UIBridgeDiscoveredElement.model_validate(e) for e in response.elements]

    return UIBridgeDiscoveryResponse(
        states=states,
        elements=elements,
        element_to_renders=response.element_to_renders,
        render_count=response.render_count,
        unique_element_count=response.unique_element_count,
        strategy_used=response.strategy_used,
        strategy_metadata=response.strategy_metadata,
    )
