"""Message handlers for automation WebSocket events.

Contains logic for processing input events, tree events,
and other data-intensive operations that require database access.

Screenshot handling is in screenshot_handler.py for better separation.
"""

import time
import uuid
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import AutomationInputEvent, InputEventType
from app.models.automation_screenshot import AutomationScreenshot
from app.models.execution_tree_event import ExecutionTreeEvent
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.websockets.automation.schemas import make_timestamp

# Re-export screenshot handler for backward compatibility
from app.websockets.automation.screenshot_handler import (
    handle_screenshot as handle_screenshot,
)

logger = structlog.get_logger(__name__)


async def link_screenshots_to_input(
    db: AsyncSession,
    input_event: AutomationInputEvent,
    session_id: UUID,
) -> None:
    """Link screenshots to an input event based on timestamp proximity.

    Finds screenshots within +/-2.5 seconds of the input event and creates
    associations with appropriate types (before, during, after).

    Args:
        db: Database session.
        input_event: The input event to link screenshots to.
        session_id: Session ID to filter screenshots.
    """
    # Define time window (+/-2.5 seconds)
    time_window = 2.5

    # Calculate time range
    start_time = input_event.timestamp - timedelta(seconds=time_window)
    end_time = input_event.timestamp + timedelta(seconds=time_window)

    # Query screenshots in the time window
    query = (
        select(AutomationScreenshot)
        .where(
            AutomationScreenshot.session_id == session_id,
            AutomationScreenshot.timestamp >= start_time,
            AutomationScreenshot.timestamp <= end_time,
        )
        .order_by(AutomationScreenshot.timestamp)
    )

    result = await db.execute(query)
    screenshots = result.scalars().all()

    # Create associations
    for screenshot in screenshots:
        # Calculate time delta in milliseconds
        time_delta = (
            screenshot.timestamp - input_event.timestamp
        ).total_seconds() * 1000

        # Determine association type
        if time_delta < -100:  # More than 100ms before
            association_type = "before"
        elif time_delta > 100:  # More than 100ms after
            association_type = "after"
        else:  # Within 100ms
            association_type = "during"

        # Create association
        association = ScreenshotInputAssociation(
            screenshot_id=screenshot.id,
            input_event_id=input_event.id,
            association_type=association_type,
            time_delta_ms=int(time_delta),
        )
        db.add(association)

        # Also update direct references if appropriate
        if association_type == "before" and not input_event.screenshot_before_id:
            input_event.screenshot_before_id = screenshot.id  # type: ignore
        elif association_type == "after" and not input_event.screenshot_after_id:
            input_event.screenshot_after_id = screenshot.id  # type: ignore

    await db.commit()


async def handle_input_event(
    message: dict[str, Any],
    db: AsyncSession,
    session_id: UUID | None = None,
) -> dict[str, Any]:
    """Handle input event message.

    Creates AutomationInputEvent record and links to nearby screenshots.

    Args:
        message: Message data containing input event details.
        db: Database session.
        session_id: Current automation session ID.

    Returns:
        Response message dict.
    """
    try:
        if not session_id:
            return {
                "type": "error",
                "message": "No active session. Start session first.",
            }

        event_type = message.get("event_type")
        if not event_type:
            return {
                "type": "error",
                "message": "Missing required field: event_type",
            }

        # Validate event_type against enum
        try:
            event_type_enum = InputEventType(event_type)
        except ValueError:
            valid_types = [e.value for e in InputEventType]
            return {
                "type": "error",
                "message": (
                    f"Invalid event_type: '{event_type}'. "
                    f"Valid types are: {', '.join(valid_types)}"
                ),
            }

        # Parse timestamp
        timestamp_str = message.get("timestamp")
        if timestamp_str:
            try:
                event_timestamp = datetime.fromisoformat(
                    timestamp_str.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                event_timestamp = datetime.utcnow()
        else:
            event_timestamp = datetime.utcnow()

        # Create input event record
        input_event = AutomationInputEvent(
            session_id=session_id,
            event_type=event_type_enum,
            timestamp=event_timestamp,
        )

        # Handle mouse events
        if event_type_enum in [
            InputEventType.MOUSE_CLICKED,
            InputEventType.MOUSE_MOVED,
        ]:
            input_event.mouse_x = message.get("x")  # type: ignore
            input_event.mouse_y = message.get("y")  # type: ignore
            input_event.mouse_button = message.get("button")  # type: ignore

        # Handle drag events
        elif event_type_enum == InputEventType.MOUSE_DRAGGED:
            input_event.drag_from_x = message.get("from_x")  # type: ignore
            input_event.drag_from_y = message.get("from_y")  # type: ignore
            input_event.drag_to_x = message.get("to_x")  # type: ignore
            input_event.drag_to_y = message.get("to_y")  # type: ignore
            input_event.drag_duration = message.get("duration")  # type: ignore
            input_event.drag_path_points = message.get("path_points")  # type: ignore
            input_event.drag_avg_speed = message.get("avg_speed")  # type: ignore
            input_event.drag_max_speed = message.get("max_speed")  # type: ignore

        # Handle keyboard events
        elif event_type_enum == InputEventType.KEYBOARD_TEXT_TYPED:
            input_event.text_typed = message.get("text")  # type: ignore
            input_event.character_count = len(message.get("text", ""))  # type: ignore

        # Save to database
        db.add(input_event)
        await db.commit()
        await db.refresh(input_event)

        # Link screenshots to input event
        try:
            await link_screenshots_to_input(db, input_event, session_id)
        except Exception as e:
            logger.error(
                "screenshot_linking_failed",
                input_event_id=str(input_event.id),
                error=str(e),
                error_type=type(e).__name__,
            )

        logger.info(
            "input_event_stored",
            session_id=str(session_id),
            event_type=event_type,
            event_id=str(input_event.id),
        )

        return {
            "type": "input_event_received",
            "event_id": str(input_event.id),
            "timestamp": make_timestamp(),
        }

    except Exception as e:
        logger.error("input_event_error", error=str(e), error_type=type(e).__name__)
        return {
            "type": "error",
            "message": f"Failed to process input event: {str(e)}",
        }


async def store_tree_event(
    db: AsyncSession,
    event_data: dict[str, Any],
) -> ExecutionTreeEvent | None:
    """Store a tree event from the runner in the database.

    Args:
        db: Database session.
        event_data: The tree event data from the runner.

    Returns:
        The created ExecutionTreeEvent or None if failed.
    """
    try:
        # Extract run_id - can be in root or in data
        run_id_str = event_data.get("run_id") or event_data.get("data", {}).get(
            "run_id"
        )
        if not run_id_str:
            logger.warning("tree_event_missing_run_id", event_data=event_data)
            return None

        run_id = UUID(run_id_str) if isinstance(run_id_str, str) else run_id_str

        # Extract node data
        node = event_data.get("node", {})
        node_metadata = node.get("metadata", {})

        # Extract state context
        state_context = node_metadata.get("state_context", {})

        tree_event = ExecutionTreeEvent(
            run_id=run_id,
            event_type=event_data.get("event_type", "unknown"),
            node_id=node.get("id", str(uuid.uuid4())),
            node_type=node.get("node_type", "action"),
            node_name=node.get("name", "Unknown"),
            parent_node_id=node.get("parent_id"),
            path=event_data.get("path"),
            sequence=event_data.get("sequence", 0),
            event_timestamp=event_data.get("timestamp", time.time()),
            node_start_timestamp=node.get("timestamp"),
            node_end_timestamp=node.get("end_timestamp"),
            duration_ms=(
                (node.get("end_timestamp", 0) - node.get("timestamp", 0)) * 1000
                if node.get("end_timestamp") and node.get("timestamp")
                else node.get("duration", 0) * 1000 if node.get("duration") else None
            ),
            status=node.get("status", "pending"),
            error_message=node.get("error"),
            active_states_before=state_context.get("active_before", []),
            active_states_after=state_context.get("active_after", []),
            states_changed=state_context.get("changed", False),
            node_metadata=node_metadata,
        )

        db.add(tree_event)
        await db.commit()
        await db.refresh(tree_event)

        logger.debug(
            "tree_event_stored",
            run_id=str(run_id),
            event_type=tree_event.event_type,
            node_name=tree_event.node_name,
            event_id=str(tree_event.id),
        )

        return tree_event

    except Exception as e:
        logger.error(
            "tree_event_storage_failed",
            error=str(e),
            event_data=event_data,
        )
        await db.rollback()
        return None
