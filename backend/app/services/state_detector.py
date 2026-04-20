"""
State Detector Service for associating input events with states.

Provides functionality to detect which state an input event belongs to
based on temporal proximity to screenshots.
"""

from datetime import datetime
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.schemas.state_discovery import DiscoveredState

logger = structlog.get_logger(__name__)


def _normalize_timestamp(ts: datetime) -> datetime:
    """Normalize timestamp to naive UTC for comparison.

    Handles mixed timezone-aware and naive timestamps by converting
    both to naive UTC timestamps.
    """
    if ts.tzinfo is not None:
        # Convert to UTC and strip timezone
        return ts.replace(tzinfo=None)
    return ts


class StateDetector:
    """Service for detecting and associating input events with states."""

    @staticmethod
    async def load_input_events(
        session_id: UUID,
        db: AsyncSession,
    ) -> list[AutomationInputEvent]:
        """
        Load all input events for a session, sorted by timestamp.

        Args:
            session_id: Automation session ID
            db: Database session

        Returns:
            List of input events sorted by timestamp
        """
        input_event_result = await db.execute(
            select(AutomationInputEvent)
            .where(AutomationInputEvent.session_id == session_id)
            .order_by(AutomationInputEvent.timestamp)
        )
        input_events = list(input_event_result.scalars().all())

        logger.info(
            "input_events_loaded",
            session_id=str(session_id),
            input_event_count=len(input_events),
        )

        return input_events

    @staticmethod
    def associate_inputs_with_states(
        states: list[DiscoveredState],
        input_events: list[AutomationInputEvent],
        screenshots: list[AutomationScreenshot],
        max_distance_seconds: float = 5.0,
    ) -> None:
        """
        Associate input events with their corresponding states.

        Modifies states in-place by adding input event IDs to their input_events list.

        Args:
            states: List of discovered states
            input_events: List of input events to associate
            screenshots: List of all screenshots for temporal reference
            max_distance_seconds: Maximum time between input and screenshot
        """
        for input_event in input_events:
            nearest_state = StateDetector._find_state_for_input(
                input_event, states, screenshots, max_distance_seconds
            )
            if nearest_state and input_event.id is not None:
                nearest_state.input_events.append(int(input_event.id))

        logger.info(
            "inputs_associated",
            total_input_events=len(input_events),
            states_with_inputs=sum(1 for s in states if s.input_events),
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

        Args:
            input_event: Input event to associate
            states: List of discovered states
            screenshots: List of all screenshots
            max_distance_seconds: Maximum time distance to consider

        Returns:
            The best matching state, or None if no match within threshold
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

                # Calculate time distance (normalize timestamps for comparison)
                input_ts = _normalize_timestamp(input_event.timestamp)  # type: ignore[arg-type]
                screenshot_ts = _normalize_timestamp(screenshot.timestamp)
                time_diff = abs((input_ts - screenshot_ts).total_seconds())

                # Check if this is better and within threshold
                if time_diff < best_distance and time_diff <= max_distance_seconds:
                    best_distance = time_diff
                    best_state = state

        return best_state
