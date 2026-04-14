"""
State Discovery API endpoints.

Provides endpoints to trigger state discovery and retrieve discovered states
from automation sessions.
"""

from enum import StrEnum
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.state_discovery import (
    StateDiscoveryResponse,
    StateDiscoveryTriggerRequest,
)
from app.services.state_discovery_service import state_discovery_service
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

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


@router.post(
    "/ui-bridge/discover-states",
    response_model=UIBridgeDiscoveryResponse,
    status_code=status.HTTP_200_OK,
)
async def discover_ui_bridge_states(
    request: UIBridgeDiscoverRequest,
    _current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Discover states from UI Bridge render logs (no persistence).

    This endpoint runs state discovery and returns the results without
    saving to the database. Use this for previewing discovery results
    before saving.

    **Strategies:**
    - `auto` (default): Uses fingerprint strategy (with ID fallback if no fingerprint data)
    - `fingerprint`: Enhanced discovery with element fingerprints (supports ID fallback)

    For fingerprint discovery, provide `cooccurrence_export` with fingerprint data.
    """
    # Import here to avoid circular dependency at module load
    from qontinui.discovery.state_discovery import (
        DiscoveryStrategyType,
        StateDiscoveryService,
    )

    # Map request strategy to library strategy type
    strategy_map = {
        "auto": DiscoveryStrategyType.AUTO,
        "fingerprint": DiscoveryStrategyType.FINGERPRINT,
    }
    strategy = strategy_map.get(request.strategy.value, DiscoveryStrategyType.AUTO)

    logger.info(
        "Running UI Bridge state discovery",
        render_count=len(request.renders),
        strategy=request.strategy.value,
        has_cooccurrence_export=request.cooccurrence_export is not None,
    )

    try:
        service = StateDiscoveryService()

        if request.cooccurrence_export:
            result = service.discover_from_export(
                request.cooccurrence_export,
                strategy=strategy,
            )
        else:
            result = service.discover_from_renders(
                request.renders,
                include_html_ids=request.include_html_ids,
                strategy=strategy,
            )

        # Convert to response format
        states = [
            UIBridgeDiscoveredState(
                id=s.id,
                name=s.name,
                element_ids=s.element_ids,
                render_ids=s.render_ids,
                confidence=s.confidence,
                position_zone=s.position_zone,
                landmark_context=s.landmark_context,
                is_global=s.is_global,
                is_modal=s.is_modal,
            )
            for s in result.states
        ]

        elements = [
            UIBridgeDiscoveredElement(
                id=e.id,
                name=e.name,
                element_type=e.element_type,
                render_ids=e.render_ids,
                fingerprint_hash=e.fingerprint_hash,
                position_zone=e.position_zone,
            )
            for e in result.elements
        ]

        logger.info(
            "UI Bridge state discovery completed",
            states_found=len(states),
            elements_found=len(elements),
            strategy_used=result.strategy_used.value,
        )

        return UIBridgeDiscoveryResponse(
            states=states,
            elements=elements,
            element_to_renders=result.element_to_renders,
            render_count=result.render_count,
            unique_element_count=result.unique_element_count,
            strategy_used=result.strategy_used.value,
            strategy_metadata=result.strategy_metadata,
        )

    except Exception as e:
        logger.error("UI Bridge state discovery failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"State discovery failed: {str(e)}",
        )
