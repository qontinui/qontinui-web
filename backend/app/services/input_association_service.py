"""
Input Association Service

Manages the association between automation screenshots and input events
(clicks, typing, drags) by finding and linking screenshots captured near
the time of each input event.
"""

from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.screenshot_input_association import ScreenshotInputAssociation


class InputAssociationService:
    """Service for associating input events with screenshots."""

    # Event types that trigger screenshot associations
    INPUT_EVENT_TYPES = {"text_typed", "mouse_clicked", "mouse_dragged"}

    @staticmethod
    async def process_log_for_input_events(
        log_entry: AutomationLog, db: AsyncSession
    ) -> Optional[ScreenshotInputAssociation]:
        """
        Process an automation log entry and create screenshot associations for input events.

        This method checks if the log entry represents a user input event (typing, clicking,
        or dragging) and finds the nearest screenshot within a 5-second time window. If found,
        it creates a ScreenshotInputAssociation record linking the two.

        Args:
            log_entry: The automation log entry to process
            db: Async database session

        Returns:
            The created ScreenshotInputAssociation if successful, None otherwise

        Example:
            >>> association = await InputAssociationService.process_log_for_input_events(
            ...     log_entry, db
            ... )
            >>> if association:
            ...     print(f"Associated screenshot {association.screenshot_id} with log {association.log_id}")
        """
        # Check if this is an input event type
        event_type = log_entry.log_data.get("event_type")
        if event_type not in InputAssociationService.INPUT_EVENT_TYPES:
            return None

        # Find the nearest screenshot within 5 seconds
        screenshot = await InputAssociationService.find_nearest_screenshot(
            session_id=log_entry.session_id,
            timestamp=log_entry.timestamp,
            time_window_seconds=5,
            db=db,
        )

        if not screenshot:
            return None

        # Calculate timestamp difference in milliseconds
        time_diff = (log_entry.timestamp - screenshot.timestamp).total_seconds() * 1000
        timestamp_diff_ms = int(time_diff)

        # Extract input-specific data from log_data
        input_data = {}
        if event_type == "mouse_clicked":
            input_data = {
                "x": log_entry.log_data.get("x"),
                "y": log_entry.log_data.get("y"),
                "button": log_entry.log_data.get("button"),
            }
        elif event_type == "text_typed":
            input_data = {
                "text": log_entry.log_data.get("text"),
                "field_name": log_entry.log_data.get("field_name"),
            }
        elif event_type == "mouse_dragged":
            input_data = {
                "start_x": log_entry.log_data.get("start_x"),
                "start_y": log_entry.log_data.get("start_y"),
                "end_x": log_entry.log_data.get("end_x"),
                "end_y": log_entry.log_data.get("end_y"),
            }

        # Create the association
        association = ScreenshotInputAssociation(
            screenshot_id=screenshot.id,
            log_id=log_entry.id,
            input_type=event_type,
            input_data=input_data,
            timestamp_diff_ms=timestamp_diff_ms,
        )

        db.add(association)
        await db.commit()
        await db.refresh(association)

        return association

    @staticmethod
    async def find_nearest_screenshot(
        session_id: UUID,
        timestamp: datetime,
        time_window_seconds: int,
        db: AsyncSession,
    ) -> Optional[AutomationScreenshot]:
        """
        Find the screenshot closest to the given timestamp within the time window.

        This method searches for screenshots in the specified session that occurred
        within the time window before or after the given timestamp. It prefers
        screenshots that were captured BEFORE the input event, as screenshots are
        typically captured first, then the input happens.

        Args:
            session_id: The automation session ID
            timestamp: The target timestamp to find the nearest screenshot to
            time_window_seconds: Maximum time difference in seconds (e.g., 5 for ±5 seconds)
            db: Async database session

        Returns:
            The nearest AutomationScreenshot within the time window, or None if not found

        Algorithm:
            1. Query all screenshots in session within time_window_seconds of timestamp
            2. Calculate absolute time difference for each screenshot
            3. Prefer screenshots BEFORE the input event (earlier timestamps)
            4. Return the screenshot with minimum time difference

        Example:
            >>> screenshot = await InputAssociationService.find_nearest_screenshot(
            ...     session_id=UUID("..."),
            ...     timestamp=datetime.now(),
            ...     time_window_seconds=5,
            ...     db=db
            ... )
            >>> if screenshot:
            ...     print(f"Found screenshot at {screenshot.timestamp}")
        """
        # Calculate time window bounds
        time_delta = timedelta(seconds=time_window_seconds)
        start_time = timestamp - time_delta
        end_time = timestamp + time_delta

        # Query screenshots within the time window
        query = (
            select(AutomationScreenshot)
            .filter(
                AutomationScreenshot.session_id == session_id,
                AutomationScreenshot.timestamp >= start_time,
                AutomationScreenshot.timestamp <= end_time,
            )
            .order_by(AutomationScreenshot.timestamp)
        )

        result = await db.execute(query)
        screenshots = result.scalars().all()

        if not screenshots:
            return None

        # If only one screenshot, return it
        if len(screenshots) == 1:
            return screenshots[0]

        # Find the nearest screenshot, preferring those BEFORE the input event
        # We calculate score: time_diff + penalty_if_after
        # This ensures screenshots before the event are preferred when time_diff is similar
        def calculate_score(screenshot: AutomationScreenshot) -> float:
            time_diff = abs((screenshot.timestamp - timestamp).total_seconds())
            # Add penalty if screenshot is after the input event
            penalty = 0.5 if screenshot.timestamp > timestamp else 0
            return time_diff + penalty

        nearest_screenshot = min(screenshots, key=calculate_score)
        return nearest_screenshot


# Create singleton instance for convenience
input_association_service = InputAssociationService()
