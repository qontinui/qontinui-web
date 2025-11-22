"""
State Discovery API endpoints.

Provides endpoints to trigger state discovery and retrieve discovered states
from automation sessions.
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.state_discovery import (
    StateDiscoveryResponse,
    StateDiscoveryStatus,
    StateDiscoveryTriggerRequest,
)
from app.services.state_discovery_service import state_discovery_service
from fastapi import APIRouter, Depends, HTTPException, status
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
