"""
Transition Analyzer Service for discovering state transitions.

Analyzes input events and screenshots to identify transitions between states,
creating a state transition graph.
"""

from datetime import datetime
from typing import cast
from uuid import UUID

import structlog
from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.schemas.state_discovery import DiscoveredState, StateTransition

logger = structlog.get_logger(__name__)


def _normalize_timestamp(ts: datetime) -> datetime:
    """Normalize timestamp to naive UTC for comparison.

    Handles mixed timezone-aware and naive timestamps by converting
    both to naive UTC timestamps.
    """
    if ts.tzinfo is not None:
        return ts.replace(tzinfo=None)
    return ts


class TransitionAnalyzer:
    """Service for analyzing and creating state transitions."""

    @staticmethod
    def create_transitions(
        states: list[DiscoveredState],
        input_events: list[AutomationInputEvent],
        screenshots: list[AutomationScreenshot],
    ) -> int:
        """
        Create state transitions based on input events.

        A transition is created when an input event occurs in one state
        and is followed by a screenshot in a different state.

        Modifies states in-place by adding transitions to their outgoing_transitions list.

        Args:
            states: List of discovered states
            input_events: List of input events
            screenshots: List of screenshots for temporal reference

        Returns:
            Total number of transitions created
        """
        # Build screenshot ID to state mapping
        screenshot_to_state: dict[UUID, DiscoveredState] = {}
        for state in states:
            for screenshot_id in state.screenshot_ids:
                screenshot_to_state[screenshot_id] = state

        # Sort screenshots by timestamp for efficient next-screenshot lookup
        sorted_screenshots = sorted(screenshots, key=lambda s: s.timestamp)

        # For each input event, find transitions
        transition_count = 0
        for input_event in input_events:
            # Find the state containing this input event
            source_state = None
            for state in states:
                if (
                    input_event.id is not None
                    and int(input_event.id) in state.input_events
                ):
                    source_state = state
                    break

            if not source_state:
                continue

            # Find the next screenshot after this input event
            next_screenshot = None
            input_ts = _normalize_timestamp(input_event.timestamp)  # type: ignore[arg-type]
            for screenshot in sorted_screenshots:
                screenshot_ts = _normalize_timestamp(screenshot.timestamp)
                if screenshot_ts > input_ts:
                    next_screenshot = screenshot
                    break

            if not next_screenshot:
                continue

            # Check if next screenshot is in a different state
            target_state = screenshot_to_state.get(next_screenshot.id)
            if not target_state or target_state.state_id == source_state.state_id:
                continue

            # Create transition if it doesn't already exist
            if TransitionAnalyzer._create_or_update_transition(
                source_state, target_state, input_event
            ):
                transition_count += 1

        logger.info(
            "transitions_created",
            total_transitions=transition_count,
            states_with_transitions=sum(1 for s in states if s.outgoing_transitions),
        )

        return transition_count

    @staticmethod
    def _create_or_update_transition(
        source_state: DiscoveredState,
        target_state: DiscoveredState,
        input_event: AutomationInputEvent,
    ) -> bool:
        """
        Create a transition between states or update existing one.

        Args:
            source_state: State where the transition originates
            target_state: State where the transition leads
            input_event: Input event that triggered the transition

        Returns:
            True if a new transition was created, False if it already existed
        """
        # Check if transition already exists
        existing_transition = None
        for transition in source_state.outgoing_transitions:
            if transition.to_state_id == target_state.state_id:
                existing_transition = transition
                break

        if not existing_transition:
            # Create new transition
            transition = StateTransition(
                from_state_id=source_state.state_id,
                to_state_id=target_state.state_id,
                trigger_event_id=(
                    int(input_event.id) if input_event.id is not None else None
                ),
                event_type=(
                    str(input_event.event_type.value)
                    if input_event.event_type is not None
                    else None
                ),
                timestamp=cast(datetime, input_event.timestamp),
                confidence=1.0,
            )
            source_state.outgoing_transitions.append(transition)
            return True

        return False
