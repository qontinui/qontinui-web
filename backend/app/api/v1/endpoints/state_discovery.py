"""
State Discovery API endpoints.

Provides endpoints to trigger state discovery and retrieve discovered states
from automation sessions using computer vision-based analysis.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.state_discovery import (
    StateDiscoveryConfig,
    StateDiscoveryResponse,
    StateDiscoveryStatus,
    StateDiscoveryTriggerRequest,
    StateUpdateRequest,
)
from app.services.state_discovery_wrapper import state_discovery_service

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
    config: StateDiscoveryConfig | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Trigger automated state discovery using computer vision analysis.

    This endpoint analyzes screenshots from an automation session to discover
    distinct UI states based on visual similarity and stability of screen regions.

    **Process:**
    1. Verify session belongs to user
    2. Load screenshots from session
    3. Run computer vision-based state discovery
    4. Identify stable visual regions (state images)
    5. Group regions into states based on co-occurrence
    6. Detect state transitions based on input events
    7. Return analysis results

    **Parameters:**
    - `session_id`: Automation session UUID
    - `config`: Optional configuration for the discovery algorithm

    **Configuration:**
    ```json
    {
      "similarity_threshold": 0.90,
      "min_region_size": [20, 20],
      "stability_threshold": 0.95,
      "cooccurrence_threshold": 0.80,
      "max_screenshots": null
    }
    ```

    **Returns:**
    - Discovered states with visual regions
    - State transitions
    - Processing statistics

    **Example Response:**
    ```json
    {
      "session_id": "123e4567-e89b-12d3-a456-426614174000",
      "total_states": 3,
      "total_transitions": 2,
      "states": [
        {
          "state_id": "state_0",
          "name": "Login Screen",
          "confidence": 0.95,
          "state_images": [
            {
              "id": "img_0",
              "name": "Login Button",
              "x": 100, "y": 200,
              "width": 150, "height": 40,
              "stability_score": 0.98,
              "screenshots": ["screenshot_1", "screenshot_2"]
            }
          ]
        }
      ],
      "algorithm": "computer_vision",
      "processing_time_ms": 1234.5
    }
    ```
    """
    logger.info(
        "state_discovery_request",
        session_id=str(session_id),
        user_id=str(current_user.id),
        algorithm="computer_vision",
    )

    try:
        # Use default config if none provided
        if config is None:
            config = StateDiscoveryConfig()

        # Convert config to parameters dict for service
        parameters = {
            "similarity_threshold": config.similarity_threshold,
            "min_region_size": config.min_region_size,
            "stability_threshold": config.stability_threshold,
            "cooccurrence_threshold": config.cooccurrence_threshold,
            "max_screenshots": config.max_screenshots,
        }

        # Perform state discovery using computer vision algorithm
        # Note: This assumes the service will be updated to support
        # "computer_vision" algorithm by another agent
        result = await state_discovery_service.discover_states_from_session(
            session_id=session_id,
            db=db,
            algorithm="computer_vision",
            parameters=parameters,
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
    except NotImplementedError as e:
        logger.warning(
            "state_discovery_not_implemented",
            session_id=str(session_id),
            user_id=str(current_user.id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Computer vision-based state discovery is not yet implemented. "
            "The AutomatedStateDiscoveryService is being developed.",
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
    include_state_images: bool = Query(
        True, description="Include full StateImage data in response"
    ),
    include_transitions: bool = Query(
        True, description="Include state transitions in response"
    ),
    algorithm: str = Query(
        "computer_vision",
        description="Algorithm to use for discovery (computer_vision, timestamp_clustering)",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get discovered states from database or trigger on-demand analysis.

    This endpoint retrieves previously discovered states if they exist in the database,
    or performs state discovery on-demand using the specified algorithm.

    **Parameters:**
    - `session_id`: Automation session UUID
    - `include_state_images`: Include full StateImage data (default: true)
    - `include_transitions`: Include state transitions (default: true)
    - `algorithm`: Algorithm to use (default: "computer_vision")

    **Returns:**
    - Discovered states with optional visual regions
    - Optional state transitions
    - Processing metadata

    **Note:**
    - If states have been cached/persisted, they will be returned from the database
    - Otherwise, discovery will be performed on-demand with default parameters
    - For custom parameters, use the POST /discover-states endpoint

    **Example Response:**
    ```json
    {
      "session_id": "123e4567-e89b-12d3-a456-426614174000",
      "total_states": 3,
      "total_transitions": 2,
      "states": [
        {
          "state_id": "state_0",
          "name": "Login Screen",
          "screenshot_ids": [1, 2, 3],
          "representative_screenshot_id": 1,
          "confidence": 0.95,
          "state_images": [
            {
              "id": "img_0",
              "name": "Login Button",
              "x": 100, "y": 200,
              "width": 150, "height": 40,
              "stability_score": 0.98
            }
          ],
          "outgoing_transitions": [...]
        }
      ],
      "algorithm": "computer_vision",
      "processing_time_ms": 1234.5
    }
    ```
    """
    logger.info(
        "get_discovered_states_request",
        session_id=str(session_id),
        user_id=str(current_user.id),
        algorithm=algorithm,
        include_state_images=include_state_images,
        include_transitions=include_transitions,
    )

    try:
        # TODO: Check if states are cached in database first
        # For now, perform on-demand discovery

        # Use default parameters based on algorithm
        if algorithm == "computer_vision":
            config = StateDiscoveryConfig()
            parameters = {
                "similarity_threshold": config.similarity_threshold,
                "min_region_size": config.min_region_size,
                "stability_threshold": config.stability_threshold,
                "cooccurrence_threshold": config.cooccurrence_threshold,
                "max_screenshots": config.max_screenshots,
            }
        else:
            # timestamp_clustering defaults
            parameters = {
                "state_threshold_seconds": 2.0,
                "max_input_distance_seconds": 5.0,
            }

        # Perform state discovery
        result = await state_discovery_service.discover_states_from_session(
            session_id=session_id,
            db=db,
            algorithm=algorithm,
            parameters=parameters,
        )

        # Filter response based on flags
        if not include_state_images:
            for state in result.states:
                state.state_images = []

        if not include_transitions:
            for state in result.states:
                state.outgoing_transitions = []

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
    except NotImplementedError as e:
        logger.warning(
            "get_discovered_states_not_implemented",
            session_id=str(session_id),
            user_id=str(current_user.id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Algorithm '{algorithm}' is not yet implemented.",
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


@router.patch(
    "/discovered-states/{state_id}",
    status_code=status.HTTP_200_OK,
)
async def update_discovered_state(
    *,
    state_id: str,
    update: StateUpdateRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Update a discovered state (e.g., rename, update metadata).

    This endpoint allows users to modify discovered states, such as giving them
    human-readable names or adding custom metadata.

    **Parameters:**
    - `state_id`: State identifier (e.g., "state_0")
    - `update`: State update request containing optional name and metadata

    **Request Body:**
    ```json
    {
      "name": "Login Page",
      "metadata": {
        "description": "Main login screen",
        "category": "authentication"
      }
    }
    ```

    **Returns:**
    - Success message with updated state information

    **Note:**
    - This endpoint requires database persistence to be implemented
    - Currently returns NOT_IMPLEMENTED until state persistence is added
    """
    logger.info(
        "update_discovered_state_request",
        state_id=state_id,
        user_id=str(current_user.id),
        update=update.model_dump(exclude_none=True),
    )

    # TODO: Implement database persistence for discovered states
    # Once DiscoveredState model is added to database:
    # 1. Query for state by state_id
    # 2. Verify user has permission to update (check session ownership)
    # 3. Update name and/or metadata
    # 4. Save to database
    # 5. Return updated state

    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="State updates require database persistence, which is not yet implemented. "
        "This feature will be available once discovered states are persisted to the database.",
    )


@router.delete(
    "/sessions/{session_id}/discovered-states",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_discovered_states(
    *,
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """
    Clear state discovery results for re-analysis.

    This endpoint removes all cached/persisted state discovery results for a session,
    allowing the user to re-run discovery with different parameters.

    **Parameters:**
    - `session_id`: Automation session UUID

    **Returns:**
    - 204 No Content on success

    **Note:**
    - This endpoint requires database persistence to be implemented
    - Currently returns NOT_IMPLEMENTED until state persistence is added
    - This is a destructive operation - deleted states cannot be recovered
    """
    logger.info(
        "clear_discovered_states_request",
        session_id=str(session_id),
        user_id=str(current_user.id),
    )

    # TODO: Implement database persistence for discovered states
    # Once DiscoveredState model is added to database:
    # 1. Verify session exists
    # 2. Verify user owns the session
    # 3. Delete all discovered states for this session
    # 4. Delete all state transitions for this session
    # 5. Return 204 No Content

    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Clearing states requires database persistence, which is not yet implemented. "
        "This feature will be available once discovered states are persisted to the database.",
    )


@router.get(
    "/sessions/{session_id}/state-discovery-status",
    response_model=StateDiscoveryStatus,
    status_code=status.HTTP_200_OK,
)
async def get_state_discovery_status(
    *,
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get state discovery processing status.

    This endpoint returns the current status of state discovery for a session,
    useful for tracking long-running analysis jobs.

    **Parameters:**
    - `session_id`: Automation session UUID

    **Returns:**
    ```json
    {
      "session_id": "123e4567-e89b-12d3-a456-426614174000",
      "status": "completed",
      "message": "State discovery completed successfully",
      "started_at": "2025-11-16T12:00:00Z",
      "completed_at": "2025-11-16T12:01:30Z",
      "error": null
    }
    ```

    **Status Values:**
    - `pending`: Discovery has been queued but not started
    - `processing`: Discovery is currently running
    - `completed`: Discovery finished successfully
    - `failed`: Discovery encountered an error

    **Note:**
    - This endpoint requires database persistence to track status
    - Currently returns NOT_IMPLEMENTED until state persistence is added
    - For real-time updates, consider using WebSocket notifications
    """
    logger.info(
        "get_state_discovery_status_request",
        session_id=str(session_id),
        user_id=str(current_user.id),
    )

    # TODO: Implement database persistence for discovery status
    # Once state discovery status tracking is added:
    # 1. Query for discovery status by session_id
    # 2. Verify user owns the session
    # 3. Return status with timestamps and any error messages
    #
    # Alternative approach: Use background task queue (Celery/Redis)
    # to track long-running discovery jobs

    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Status tracking requires database persistence or task queue, "
        "which is not yet implemented. Currently, state discovery runs synchronously "
        "and returns results immediately.",
    )
