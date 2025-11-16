"""
State Discovery Service for automation session analysis.

Analyzes automation sessions to discover states and state transitions.
"""

import time
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.schemas.state_discovery import (
    DiscoveredState,
    StateDiscoveryResponse,
    StateTransition,
)

logger = structlog.get_logger(__name__)


class StateDiscoveryService:
    """Service for discovering states from automation sessions."""

    @staticmethod
    async def discover_states_from_session(
        session_id: UUID,
        db: AsyncSession,
        algorithm: str = "timestamp_clustering",
        parameters: dict[str, Any] | None = None,
    ) -> StateDiscoveryResponse:
        """
        Discover states from an automation session.

        Args:
            session_id: Automation session ID
            db: Database session
            algorithm: Algorithm to use for state discovery
            parameters: Algorithm-specific parameters

        Returns:
            StateDiscoveryResponse with discovered states and transitions
        """
        start_time = time.time()
        logger.info(
            "state_discovery_started",
            session_id=str(session_id),
            algorithm=algorithm,
        )

        # Verify session exists
        session_result = await db.execute(
            select(AutomationSession).where(AutomationSession.id == session_id)
        )
        session = session_result.scalar_one_or_none()
        if not session:
            raise ValueError(f"Session {session_id} not found")

        # Default parameters
        if parameters is None:
            parameters = {}

        # Route to appropriate algorithm
        if algorithm == "timestamp_clustering":
            result = await StateDiscoveryService._timestamp_clustering_algorithm(
                session_id, db, parameters
            )
        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")

        # Calculate processing time
        processing_time_ms = (time.time() - start_time) * 1000
        result.processing_time_ms = processing_time_ms

        logger.info(
            "state_discovery_completed",
            session_id=str(session_id),
            total_states=result.total_states,
            total_transitions=result.total_transitions,
            processing_time_ms=processing_time_ms,
        )

        return result

    @staticmethod
    async def _timestamp_clustering_algorithm(
        session_id: UUID,
        db: AsyncSession,
        parameters: dict[str, Any],
    ) -> StateDiscoveryResponse:
        """
        Simple timestamp-based clustering algorithm.

        Groups screenshots by temporal proximity and associates input events
        with their surrounding screenshots to create a basic state graph.

        Parameters:
            - state_threshold_seconds: Minimum time gap to consider new state (default: 2.0)
            - max_input_distance_seconds: Max time between input and screenshot (default: 5.0)

        Algorithm:
            1. Load all screenshots and input events for the session
            2. Sort screenshots by timestamp
            3. Group screenshots into states based on time gaps
            4. Associate input events with nearest screenshots
            5. Create transitions based on input events between states
        """
        state_threshold = parameters.get("state_threshold_seconds", 2.0)
        max_input_distance = parameters.get("max_input_distance_seconds", 5.0)

        # Load screenshots
        screenshot_result = await db.execute(
            select(AutomationScreenshot)
            .where(AutomationScreenshot.session_id == session_id)
            .order_by(AutomationScreenshot.timestamp)
        )
        screenshots = list(screenshot_result.scalars().all())

        # Load input events
        input_event_result = await db.execute(
            select(AutomationInputEvent)
            .where(AutomationInputEvent.session_id == session_id)
            .order_by(AutomationInputEvent.timestamp)
        )
        input_events = list(input_event_result.scalars().all())

        logger.info(
            "state_discovery_data_loaded",
            session_id=str(session_id),
            screenshot_count=len(screenshots),
            input_event_count=len(input_events),
        )

        # If no screenshots, return empty result
        if not screenshots:
            return StateDiscoveryResponse(
                session_id=session_id,
                total_states=0,
                total_transitions=0,
                states=[],
                algorithm="timestamp_clustering",
                parameters=parameters,
            )

        # Cluster screenshots into states
        states: list[DiscoveredState] = []
        current_state_screenshots: list[AutomationScreenshot] = [screenshots[0]]
        state_counter = 0

        for i in range(1, len(screenshots)):
            prev_screenshot = screenshots[i - 1]
            curr_screenshot = screenshots[i]

            # Calculate time gap
            time_gap = (curr_screenshot.timestamp - prev_screenshot.timestamp).total_seconds()

            # If gap is large enough, create new state
            if time_gap >= state_threshold:
                # Finalize current state
                state = StateDiscoveryService._create_state_from_screenshots(
                    state_id=f"state_{state_counter}",
                    screenshots=current_state_screenshots,
                )
                states.append(state)
                state_counter += 1

                # Start new state
                current_state_screenshots = [curr_screenshot]
            else:
                # Add to current state
                current_state_screenshots.append(curr_screenshot)

        # Add final state
        if current_state_screenshots:
            state = StateDiscoveryService._create_state_from_screenshots(
                state_id=f"state_{state_counter}",
                screenshots=current_state_screenshots,
            )
            states.append(state)

        # Associate input events with states
        for input_event in input_events:
            # Find nearest screenshot(s) within time window
            nearest_state = StateDiscoveryService._find_state_for_input(
                input_event, states, screenshots, max_input_distance
            )
            if nearest_state:
                nearest_state.input_events.append(input_event.id)

        # Create transitions based on input events
        StateDiscoveryService._create_transitions(states, input_events, screenshots)

        # Count total transitions
        total_transitions = sum(len(state.outgoing_transitions) for state in states)

        return StateDiscoveryResponse(
            session_id=session_id,
            total_states=len(states),
            total_transitions=total_transitions,
            states=states,
            algorithm="timestamp_clustering",
            parameters=parameters,
        )

    @staticmethod
    def _create_state_from_screenshots(
        state_id: str,
        screenshots: list[AutomationScreenshot],
    ) -> DiscoveredState:
        """Create a DiscoveredState from a list of screenshots."""
        if not screenshots:
            raise ValueError("Cannot create state from empty screenshot list")

        screenshot_ids = [s.id for s in screenshots]
        representative_screenshot_id = screenshots[0].id  # Use first as representative

        return DiscoveredState(
            state_id=state_id,
            screenshot_ids=screenshot_ids,
            representative_screenshot_id=representative_screenshot_id,
            timestamp_first_seen=screenshots[0].timestamp,
            timestamp_last_seen=screenshots[-1].timestamp,
            visit_count=1,
            input_events=[],
            outgoing_transitions=[],
            metadata={
                "screenshot_count": len(screenshots),
                "duration_seconds": (
                    screenshots[-1].timestamp - screenshots[0].timestamp
                ).total_seconds(),
            },
        )

    @staticmethod
    def _find_state_for_input(
        input_event: AutomationInputEvent,
        states: list[DiscoveredState],
        screenshots: list[AutomationScreenshot],
        max_distance_seconds: float,
    ) -> DiscoveredState | None:
        """
        Find the state that an input event belongs to.

        Looks for the state containing the screenshot closest to the input event timestamp.
        """
        # Build screenshot ID to screenshot mapping
        screenshot_map = {s.id: s for s in screenshots}

        best_state = None
        best_distance = float("inf")

        for state in states:
            for screenshot_id in state.screenshot_ids:
                screenshot = screenshot_map.get(screenshot_id)
                if not screenshot:
                    continue

                # Calculate time distance
                time_diff = abs(
                    (input_event.timestamp - screenshot.timestamp).total_seconds()
                )

                # Check if this is better and within threshold
                if time_diff < best_distance and time_diff <= max_distance_seconds:
                    best_distance = time_diff
                    best_state = state

        return best_state

    @staticmethod
    def _create_transitions(
        states: list[DiscoveredState],
        input_events: list[AutomationInputEvent],
        screenshots: list[AutomationScreenshot],
    ) -> None:
        """
        Create state transitions based on input events.

        A transition is created when an input event occurs in one state
        and is followed by a screenshot in a different state.
        """
        # Build screenshot ID to state mapping
        screenshot_to_state: dict[int, DiscoveredState] = {}
        for state in states:
            for screenshot_id in state.screenshot_ids:
                screenshot_to_state[screenshot_id] = state

        # Sort screenshots by timestamp
        sorted_screenshots = sorted(screenshots, key=lambda s: s.timestamp)

        # For each input event, find transitions
        for i, input_event in enumerate(input_events):
            # Find the state containing this input event
            source_state = None
            for state in states:
                if input_event.id in state.input_events:
                    source_state = state
                    break

            if not source_state:
                continue

            # Find the next screenshot after this input event
            next_screenshot = None
            for screenshot in sorted_screenshots:
                if screenshot.timestamp > input_event.timestamp:
                    next_screenshot = screenshot
                    break

            if not next_screenshot:
                continue

            # Check if next screenshot is in a different state
            target_state = screenshot_to_state.get(next_screenshot.id)
            if not target_state or target_state.state_id == source_state.state_id:
                continue

            # Create transition
            # Check if transition already exists
            existing_transition = None
            for transition in source_state.outgoing_transitions:
                if transition.to_state_id == target_state.state_id:
                    existing_transition = transition
                    break

            if not existing_transition:
                transition = StateTransition(
                    from_state_id=source_state.state_id,
                    to_state_id=target_state.state_id,
                    trigger_event_id=input_event.id,
                    event_type=input_event.event_type,
                    timestamp=input_event.timestamp,
                    confidence=1.0,
                )
                source_state.outgoing_transitions.append(transition)


# Singleton instance
state_discovery_service = StateDiscoveryService()
