"""
State Clusterer Service for grouping screenshots into states.

Provides clustering algorithms to group screenshots based on temporal proximity
and other similarity metrics.
"""

from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_screenshot import AutomationScreenshot
from app.schemas.state_discovery import DiscoveredState

logger = structlog.get_logger(__name__)


class StateClusterer:
    """Service for clustering screenshots into states."""

    @staticmethod
    async def cluster_by_timestamp(
        session_id: UUID,
        db: AsyncSession,
        state_threshold_seconds: float = 2.0,
    ) -> list[DiscoveredState]:
        """
        Cluster screenshots into states based on temporal proximity.

        Groups screenshots by time gaps - when the gap between consecutive
        screenshots exceeds the threshold, a new state is created.

        Args:
            session_id: Automation session ID
            db: Database session
            state_threshold_seconds: Minimum time gap to consider new state

        Returns:
            List of discovered states with grouped screenshots
        """
        # Load screenshots sorted by timestamp
        screenshot_result = await db.execute(
            select(AutomationScreenshot)
            .where(AutomationScreenshot.session_id == session_id)
            .order_by(AutomationScreenshot.timestamp)
        )
        screenshots = list(screenshot_result.scalars().all())

        logger.info(
            "clustering_screenshots",
            session_id=str(session_id),
            screenshot_count=len(screenshots),
            threshold=state_threshold_seconds,
        )

        if not screenshots:
            return []

        # Cluster screenshots into states
        states: list[DiscoveredState] = []
        current_state_screenshots: list[AutomationScreenshot] = [screenshots[0]]
        state_counter = 0

        for i in range(1, len(screenshots)):
            prev_screenshot = screenshots[i - 1]
            curr_screenshot = screenshots[i]

            # Calculate time gap
            time_gap = (
                curr_screenshot.timestamp - prev_screenshot.timestamp
            ).total_seconds()

            # If gap is large enough, create new state
            if time_gap >= state_threshold_seconds:
                # Finalize current state
                state = StateClusterer._create_state_from_screenshots(
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
            state = StateClusterer._create_state_from_screenshots(
                state_id=f"state_{state_counter}",
                screenshots=current_state_screenshots,
            )
            states.append(state)

        logger.info(
            "clustering_completed",
            session_id=str(session_id),
            state_count=len(states),
        )

        return states

    @staticmethod
    def _create_state_from_screenshots(
        state_id: str,
        screenshots: list[AutomationScreenshot],
    ) -> DiscoveredState:
        """
        Create a DiscoveredState from a list of screenshots.

        Args:
            state_id: Unique identifier for the state
            screenshots: List of screenshots belonging to this state

        Returns:
            DiscoveredState with metadata

        Raises:
            ValueError: If screenshots list is empty
        """
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
