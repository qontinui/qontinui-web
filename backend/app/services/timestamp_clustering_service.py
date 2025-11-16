"""
Timestamp Clustering Service for State Discovery

Simple algorithm that groups screenshots by timestamp gaps to identify states.
This is a lightweight, fast approach suitable for small sessions.
"""

from datetime import timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.schemas.state_discovery import (
    DiscoveredState,
    StateDiscoveryResponse,
    StateTransition,
)

logger = structlog.get_logger(__name__)


async def discover_states_timestamp_clustering(
    session_id: UUID,
    db: AsyncSession,
    parameters: dict[str, Any],
) -> StateDiscoveryResponse:
    """
    Discover states using simple timestamp clustering.

    Groups screenshots that are close together in time (< threshold)
    into the same state. Creates transitions when input events occur
    between state boundaries.

    Args:
        session_id: Automation session UUID
        db: Database session
        parameters: Algorithm parameters including:
            - state_threshold_seconds: Time gap threshold (default: 2.0)
            - max_input_distance_seconds: Max distance for input linking (default: 5.0)

    Returns:
        StateDiscoveryResponse with discovered states
    """
    # Get parameters
    state_threshold = parameters.get("state_threshold_seconds", 2.0)
    max_input_distance = parameters.get("max_input_distance_seconds", 5.0)

    # Load screenshots ordered by timestamp
    result = await db.execute(
        select(AutomationScreenshot)
        .where(AutomationScreenshot.session_id == session_id)
        .order_by(AutomationScreenshot.timestamp)
    )
    screenshots = result.scalars().all()

    if not screenshots:
        return StateDiscoveryResponse(
            session_id=session_id,
            total_states=0,
            total_transitions=0,
            states=[],
            algorithm="timestamp_clustering",
            parameters=parameters,
        )

    # Cluster screenshots by time gaps
    states = []
    current_state_screenshots = [screenshots[0]]
    state_id_counter = 0

    for i in range(1, len(screenshots)):
        prev = screenshots[i - 1]
        curr = screenshots[i]

        time_gap = (curr.timestamp - prev.timestamp).total_seconds()

        if time_gap > state_threshold:
            # Create new state from current cluster
            state = _create_state_from_screenshots(
                state_id=f"state_{state_id_counter}",
                screenshots=current_state_screenshots,
            )
            states.append(state)
            state_id_counter += 1

            # Start new cluster
            current_state_screenshots = [curr]
        else:
            # Continue current cluster
            current_state_screenshots.append(curr)

    # Add final state
    if current_state_screenshots:
        state = _create_state_from_screenshots(
            state_id=f"state_{state_id_counter}",
            screenshots=current_state_screenshots,
        )
        states.append(state)

    # Load input events
    result = await db.execute(
        select(AutomationInputEvent)
        .where(AutomationInputEvent.session_id == session_id)
        .order_by(AutomationInputEvent.timestamp)
    )
    input_events = result.scalars().all()

    # Assign input events to states
    for event in input_events:
        for state in states:
            # Check if event falls within state timeframe
            state_start = state.timestamp_first_seen
            state_end = state.timestamp_last_seen

            # Allow some buffer around state boundaries
            buffer = timedelta(seconds=max_input_distance)

            if state_start - buffer <= event.timestamp <= state_end + buffer:
                state.input_events.append(event.id)
                break

    # Create transitions between states
    all_transitions = []
    for i in range(len(states) - 1):
        from_state = states[i]
        to_state = states[i + 1]

        # Find triggering input event (last event in from_state)
        trigger_event_id = from_state.input_events[-1] if from_state.input_events else None
        trigger_event_type = None

        if trigger_event_id:
            # Find event details
            for event in input_events:
                if event.id == trigger_event_id:
                    trigger_event_type = event.event_type
                    break

        transition = StateTransition(
            from_state_id=from_state.state_id,
            to_state_id=to_state.state_id,
            trigger_event_id=trigger_event_id,
            event_type=trigger_event_type,
            timestamp=to_state.timestamp_first_seen,
            confidence=0.9,  # High confidence for timestamp-based transitions
        )

        from_state.outgoing_transitions.append(transition)
        all_transitions.append(transition)

    return StateDiscoveryResponse(
        session_id=session_id,
        total_states=len(states),
        total_transitions=len(all_transitions),
        states=states,
        algorithm="timestamp_clustering",
        parameters=parameters,
    )


def _create_state_from_screenshots(
    state_id: str,
    screenshots: list[AutomationScreenshot],
) -> DiscoveredState:
    """Create a DiscoveredState from a list of screenshots."""
    return DiscoveredState(
        state_id=state_id,
        name=None,
        screenshot_ids=[s.id for s in screenshots],
        representative_screenshot_id=screenshots[0].id,
        timestamp_first_seen=screenshots[0].timestamp,
        timestamp_last_seen=screenshots[-1].timestamp,
        visit_count=1,
        confidence=0.9,
        input_events=[],
        state_images=[],
        outgoing_transitions=[],
        metadata={
            "screenshot_count": len(screenshots),
            "duration_seconds": (
                screenshots[-1].timestamp - screenshots[0].timestamp
            ).total_seconds(),
        },
    )
