# Integration Patch for Input Association Service

## File to Modify

`/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/api/v1/endpoints/automation_ws.py`

## Changes Required

### 1. Add Import Statement

At the top of the file, after existing imports:

```python
# Add this import
from app.services.input_association_service import input_association_service
```

### 2. Update handle_log Function

Replace the `handle_log` function (currently at lines 408-472) with this updated version:

```python
async def handle_log(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    """
    Handle log message.

    Creates AutomationLog record and triggers input association logic.

    Args:
        message: Message data from runner
        user: Authenticated user
        db: Database session

    Returns:
        Response message
    """
    try:
        session_id = message.get("session_id")
        if not session_id:
            return create_error("Missing required field: session_id")

        level = message.get("level", "info")
        log_message = message.get("message", "")
        log_data = message.get("log_data", {})
        sequence_number = message.get("sequence_number", 0)

        # Extract timestamp from message or use current time
        timestamp_str = message.get("timestamp")
        if timestamp_str:
            try:
                # Parse ISO format timestamp
                log_timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                log_timestamp = datetime.utcnow()
        else:
            log_timestamp = datetime.utcnow()

        # Import the actual model (replace placeholder)
        from app.models.automation_log import AutomationLog

        # Create log record
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
        # This will create ScreenshotInputAssociation records for input events
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
            # Input associations are nice-to-have, not critical
            logger.error(
                "input_association_failed",
                log_id=str(log.id),
                error=str(e),
                error_type=type(e).__name__,
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

## Summary of Changes

### What Changed

1. **Import added:** `input_association_service` imported at top of file
2. **Timestamp parsing:** Added logic to parse timestamp from message
3. **Model import:** Import actual `AutomationLog` model instead of using placeholder
4. **Database save:** Uncommented database operations (add, commit, refresh)
5. **Association processing:** Call `input_association_service.process_log_for_input_events()`
6. **Error handling:** Wrap association processing in try/except
7. **Logging:** Add info log when association created, error log when failed

### Why These Changes

- **Timestamp parsing:** Log entries need accurate timestamps for screenshot matching
- **Database save:** Log must be saved before creating associations (needs log.id)
- **Association processing:** Core functionality - links screenshots to input events
- **Error handling:** Associations are optional - don't break log ingestion if they fail
- **Logging:** Track association success/failure for monitoring and debugging

## Testing the Integration

### 1. Send a log message without input event

```json
{
  "type": "log",
  "session_id": "uuid-here",
  "level": "info",
  "message": "Test started",
  "log_data": {
    "event_type": "test_start"
  },
  "sequence_number": 1,
  "timestamp": "2024-11-14T12:00:00.000000Z"
}
```

**Expected:** Log created, no association (not an input event)

### 2. Send a log message with mouse click

```json
{
  "type": "log",
  "session_id": "uuid-here",
  "level": "info",
  "message": "Mouse clicked",
  "log_data": {
    "event_type": "mouse_clicked",
    "x": 150,
    "y": 200,
    "button": "left"
  },
  "sequence_number": 2,
  "timestamp": "2024-11-14T12:00:01.000000Z"
}
```

**Expected:**
- Log created
- Association created (if screenshot exists within 5 seconds)
- Info log with association details

### 3. Send a log message with text typing

```json
{
  "type": "log",
  "session_id": "uuid-here",
  "level": "info",
  "message": "Text typed",
  "log_data": {
    "event_type": "text_typed",
    "text": "hello world",
    "field_name": "username"
  },
  "sequence_number": 3,
  "timestamp": "2024-11-14T12:00:02.000000Z"
}
```

**Expected:**
- Log created
- Association created (if screenshot exists within 5 seconds)
- Info log with association details

## Verification

After integration, verify:

1. **Logs are saved:** Check `automation_logs` table
2. **Associations created:** Check `screenshot_input_associations` table
3. **Logs show success:** Look for "input_association_created" log messages
4. **No errors:** No "input_association_failed" logs (unless expected)

## Database Queries for Verification

```sql
-- Check recent logs
SELECT id, session_id, level, message, log_data->>'event_type' as event_type, timestamp
FROM automation_logs
ORDER BY created_at DESC
LIMIT 10;

-- Check recent associations
SELECT
  sia.id,
  sia.input_type,
  sia.timestamp_diff_ms,
  al.message as log_message,
  asc.name as screenshot_name
FROM screenshot_input_associations sia
JOIN automation_logs al ON sia.log_id = al.id
JOIN automation_screenshots asc ON sia.screenshot_id = asc.id
ORDER BY sia.created_at DESC
LIMIT 10;

-- Check association success rate
SELECT
  COUNT(DISTINCT al.id) as total_input_logs,
  COUNT(DISTINCT sia.log_id) as logs_with_associations,
  ROUND(COUNT(DISTINCT sia.log_id) * 100.0 / COUNT(DISTINCT al.id), 2) as success_rate
FROM automation_logs al
LEFT JOIN screenshot_input_associations sia ON al.id = sia.log_id
WHERE al.log_data->>'event_type' IN ('text_typed', 'mouse_clicked', 'mouse_dragged');
```

## Rollback Instructions

If you need to rollback:

1. Remove the import: `from app.services.input_association_service import input_association_service`
2. Revert `handle_log` function to original version
3. Re-add TODO comments if needed

The service file can remain - it won't be used if not imported.

## Notes

- The service is designed to be **non-blocking** - if association fails, log still succeeds
- Screenshots must exist in database before logs for associations to work
- Time window is 5 seconds - logs more than 5 seconds from any screenshot won't associate
- The service prefers screenshots BEFORE input events (screenshots captured first, then action)
