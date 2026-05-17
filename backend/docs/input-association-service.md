# Input Association Service

## Overview

The `InputAssociationService` automatically associates automation screenshots with user input events (clicks, typing, drags). This creates a timeline linking visual states (screenshots) with actions, enabling better debugging, analysis, and replay capabilities.

## Location

`/mnt/c/Users/jspin/Documents/qontinui-root/qontinui-web/backend/app/services/input_association_service.py`

## Purpose

When automation tests run:
1. Screenshots are captured periodically
2. User input events (clicks, types, drags) are logged
3. This service links each input event to its nearest screenshot

This creates a visual timeline showing:
- What the screen looked like before each action
- The exact coordinates/data of each action
- Timing relationships between screenshots and actions

## API

### process_log_for_input_events

Main entry point for processing log entries.

```python
async def process_log_for_input_events(
    log_entry: AutomationLog,
    db: AsyncSession
) -> Optional[ScreenshotInputAssociation]
```

**Parameters:**
- `log_entry`: The automation log entry to process
- `db`: Async database session

**Returns:**
- `ScreenshotInputAssociation` if the log represents an input event and a screenshot was found
- `None` if the log is not an input event or no screenshot was found within the time window

**Behavior:**
1. Checks if `log_entry.log_data['event_type']` is in `['text_typed', 'mouse_clicked', 'mouse_dragged']`
2. Finds nearest screenshot within 5-second window
3. Creates `ScreenshotInputAssociation` record with:
   - `screenshot_id`: ID of the nearest screenshot
   - `log_id`: ID of the input log entry
   - `input_type`: The event type (text_typed, mouse_clicked, etc.)
   - `input_data`: Extracted data specific to the input type
   - `timestamp_diff_ms`: Milliseconds between screenshot and input event

### find_nearest_screenshot

Helper method to find the closest screenshot.

```python
async def find_nearest_screenshot(
    session_id: UUID,
    timestamp: datetime,
    time_window_seconds: int,
    db: AsyncSession,
) -> Optional[AutomationScreenshot]
```

**Parameters:**
- `session_id`: The automation session ID
- `timestamp`: Target timestamp to find nearest screenshot
- `time_window_seconds`: Maximum time difference (e.g., 5 seconds)
- `db`: Async database session

**Returns:**
- The nearest `AutomationScreenshot` within the time window
- `None` if no screenshot found

**Algorithm:**
1. Query all screenshots in the session within ±`time_window_seconds`
2. Calculate time difference for each screenshot
3. Prefer screenshots BEFORE the input event (screenshots are captured first, then input happens)
4. Return screenshot with minimum score (time_diff + 0.5 penalty if after)

## Integration with WebSocket Handler

The service should be called from the `handle_log` function in `automation_ws.py` after saving each log entry.

### Current Code (automation_ws.py)

```python
async def handle_log(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    # ... existing code to create log record ...

    # TODO: Add to database when model is properly defined
    # db.add(log)
    # await db.commit()
    # await db.refresh(log)

    # TODO: Trigger input association logic  # <-- THIS IS WHERE TO INTEGRATE
```

### Updated Code (with integration)

```python
from app.services.input_association_service import input_association_service

async def handle_log(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    """
    Handle log message.
    Creates AutomationLog record and triggers input association logic.
    """
    try:
        session_id = message.get("session_id")
        if not session_id:
            return create_error("Missing required field: session_id")

        level = message.get("level", "info")
        log_message = message.get("message", "")
        log_data = message.get("log_data", {})
        sequence_number = message.get("sequence_number", 0)
        timestamp = message.get("timestamp")  # Get timestamp from message

        # Parse timestamp or use current time
        if timestamp:
            log_timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        else:
            log_timestamp = datetime.utcnow()

        # Create log record
        from app.models.automation_log import AutomationLog
        log = AutomationLog(
            session_id=UUID(session_id),
            level=level,
            message=log_message,
            log_data=log_data,
            sequence_number=sequence_number,
            timestamp=log_timestamp,
        )

        # Save to database
        db.add(log)
        await db.commit()
        await db.refresh(log)

        # Process input associations
        try:
            association = await input_association_service.process_log_for_input_events(
                log_entry=log,
                db=db
            )

            if association:
                logger.info(
                    "input_association_created",
                    log_id=str(log.id),
                    screenshot_id=str(association.screenshot_id),
                    input_type=association.input_type,
                    timestamp_diff_ms=association.timestamp_diff_ms,
                )
        except Exception as e:
            # Log the error but don't fail the entire request
            logger.error(
                "input_association_failed",
                log_id=str(log.id),
                error=str(e),
            )

        logger.debug(
            "automation_log_received",
            session_id=session_id,
            level=level,
            sequence=sequence_number,
        )

        return create_response(
            success=True,
            message="Log entry created",
            data={"log_id": str(log.id)},
        )

    except Exception as e:
        logger.error("log_error", error=str(e), error_type=type(e).__name__)
        return create_error(
            "Failed to process log",
            details={"error": str(e)},
        )
```

## Input Event Types

The service recognizes these event types from `log_data['event_type']`:

### text_typed

Keyboard text input event.

**Extracted Data:**
```json
{
  "text": "hello world",
  "field_name": "username_field"
}
```

### mouse_clicked

Mouse click event.

**Extracted Data:**
```json
{
  "x": 150,
  "y": 200,
  "button": "left"
}
```

### mouse_dragged

Mouse drag event.

**Extracted Data:**
```json
{
  "start_x": 100,
  "start_y": 100,
  "end_x": 200,
  "end_y": 200
}
```

## Database Schema

The service creates records in the `screenshot_input_associations` table:

```python
class ScreenshotInputAssociation(Base):
    id: UUID                    # Primary key
    screenshot_id: UUID         # Foreign key to automation_screenshots
    log_id: UUID               # Foreign key to automation_logs
    input_type: str            # 'text_typed', 'mouse_clicked', 'mouse_dragged'
    input_data: dict           # Event-specific data (JSON)
    timestamp_diff_ms: int     # Milliseconds between screenshot and input
    created_at: datetime       # When association was created
```

## Edge Cases Handled

1. **No screenshots found**: Returns `None` if no screenshots exist within the time window
2. **Multiple screenshots**: Selects the closest one, preferring screenshots BEFORE the input
3. **Non-input events**: Ignores log entries that aren't input events
4. **Missing event_type**: Returns `None` if `log_data` doesn't contain `event_type`
5. **Invalid timestamps**: Service assumes timestamps are valid datetime objects

## Performance Considerations

- **Database Query**: Each input event triggers one database query for screenshots
- **Time Window**: 5-second window limits the number of screenshots queried
- **Indexing**: Relies on `automation_screenshots.timestamp` index for performance
- **Async**: All operations are async to prevent blocking

## Testing

Example test case:

```python
import pytest
from datetime import datetime, timedelta
from app.services.input_association_service import input_association_service

@pytest.mark.asyncio
async def test_process_log_for_click_event(db_session):
    # Create a screenshot
    screenshot = AutomationScreenshot(
        session_id=session_id,
        name="test_screenshot",
        storage_path="s3://...",
        width=1920,
        height=1080,
        timestamp=datetime.utcnow(),
    )
    db_session.add(screenshot)
    await db_session.commit()

    # Create a click log 1 second later
    log = AutomationLog(
        session_id=session_id,
        level="info",
        message="Mouse clicked",
        log_data={
            "event_type": "mouse_clicked",
            "x": 100,
            "y": 200,
            "button": "left"
        },
        sequence_number=1,
        timestamp=screenshot.timestamp + timedelta(seconds=1),
    )
    db_session.add(log)
    await db_session.commit()

    # Process the log
    association = await input_association_service.process_log_for_input_events(
        log_entry=log,
        db=db_session
    )

    # Verify association was created
    assert association is not None
    assert association.screenshot_id == screenshot.id
    assert association.log_id == log.id
    assert association.input_type == "mouse_clicked"
    assert association.timestamp_diff_ms == 1000  # 1 second
    assert association.input_data["x"] == 100
    assert association.input_data["y"] == 200
```

## Future Enhancements

Potential improvements:

1. **Configurable time window**: Allow different time windows per event type
2. **Screenshot quality scoring**: Prefer high-quality or full-screen screenshots
3. **Event clustering**: Group related events (e.g., multiple clicks in quick succession)
4. **Reverse association**: Find all input events for a given screenshot
5. **Performance metrics**: Track association success rate and timing
6. **Batch processing**: Process multiple logs in a single database transaction

## Dependencies

- `sqlalchemy`: Async database queries
- `app.models.automation_log`: AutomationLog model
- `app.models.automation_screenshot`: AutomationScreenshot model
- `app.models.screenshot_input_association`: ScreenshotInputAssociation model

## Configuration

Current configuration is hardcoded in the class:

```python
class InputAssociationService:
    INPUT_EVENT_TYPES = {"text_typed", "mouse_clicked", "mouse_dragged"}
    # Time window is passed as parameter (default: 5 seconds)
```

To modify event types or add new ones, update the `INPUT_EVENT_TYPES` set and add corresponding data extraction logic in `process_log_for_input_events`.
