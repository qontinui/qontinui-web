# Automation API Endpoints

REST API endpoints for querying automation session data in qontinui-web backend.

## Overview

This implementation adds comprehensive REST API endpoints for querying automation test sessions, logs, screenshots, and their relationships. The endpoints support pagination, filtering, timeline analysis, and statistical reporting.

## Files Created/Modified

### New Files

1. **`/app/api/v1/endpoints/automation.py`** - Main endpoint implementations
2. **`/app/schemas/automation.py`** - Pydantic response models

### Modified Files

1. **`/app/api/v1/api.py`** - Added automation router registration

## Endpoint Specifications

### 1. GET /api/v1/automation/sessions

List all automation sessions with pagination and filtering.

**Query Parameters:**
- `skip` (int, default: 0): Number of sessions to skip for pagination
- `limit` (int, default: 50, max: 100): Maximum sessions to return
- `status` (string, optional): Filter by session status (active, completed, failed)
- `start_date` (datetime, optional): Filter sessions created after this date
- `end_date` (datetime, optional): Filter sessions created before this date

**Response Model:** `AutomationSessionListResponse`
```json
{
  "sessions": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "runner_version": "string",
      "runner_os": "string",
      "runner_hostname": "string",
      "status": "active",
      "configuration_snapshot": {},
      "created_at": "2025-11-14T12:00:00Z",
      "ended_at": null,
      "log_count": 150,
      "screenshot_count": 25
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

### 2. GET /api/v1/automation/sessions/{session_id}

Get details for a specific automation session.

**Path Parameters:**
- `session_id` (UUID): The session ID

**Response Model:** `AutomationSessionWithStats`
- Includes all session fields plus `log_count` and `screenshot_count`

**Status Codes:**
- 200: Success
- 404: Session not found

### 3. GET /api/v1/automation/sessions/{session_id}/timeline

Get chronological timeline of all events (logs + screenshots) for a session.

**Path Parameters:**
- `session_id` (UUID): The session ID

**Response Model:** `SessionTimeline`
```json
{
  "session": { /* session object */ },
  "timeline": [
    {
      "event_type": "log",
      "timestamp": "2025-11-14T12:00:00Z",
      "id": "uuid",
      "data": {
        "sequence_number": 1,
        "level": "INFO",
        "message": "Starting automation",
        "log_data": {},
        "created_at": "2025-11-14T12:00:00Z"
      }
    },
    {
      "event_type": "screenshot",
      "timestamp": "2025-11-14T12:00:05Z",
      "id": "uuid",
      "data": {
        "name": "screenshot_001.png",
        "storage_path": "s3://...",
        "width": 1920,
        "height": 1080,
        "content_type": "image/png",
        "automation_metadata": {},
        "presigned_url": null,
        "created_at": "2025-11-14T12:00:05Z"
      }
    }
  ],
  "total_events": 175
}
```

**Features:**
- Merges logs and screenshots into single timeline
- Sorted chronologically by timestamp
- Each event tagged with type ("log" or "screenshot")
- Full event data included

**Status Codes:**
- 200: Success
- 404: Session not found

### 4. GET /api/v1/automation/sessions/{session_id}/image-recognition

Query image recognition logs and calculate statistics.

**Path Parameters:**
- `session_id` (UUID): The session ID

**Response Model:** `ImageRecognitionReport`
```json
{
  "session_id": "uuid",
  "total_attempts": 50,
  "successful": 45,
  "failed": 5,
  "overall_success_rate": 90.0,
  "images": [
    {
      "image_id": "login_button",
      "total_attempts": 10,
      "successful": 9,
      "failed": 1,
      "success_rate": 90.0,
      "avg_confidence": 0.87
    },
    {
      "image_id": "submit_form",
      "total_attempts": 8,
      "successful": 8,
      "failed": 0,
      "success_rate": 100.0,
      "avg_confidence": 0.92
    }
  ]
}
```

**Features:**
- Filters logs where `log_data->>'event_type' = 'image_recognition'`
- Calculates overall statistics (total, successful, failed, success rate)
- Groups by `image_id` from log_data
- Per-image statistics including average confidence
- Images sorted by total attempts (descending)
- Returns empty report if no image recognition events found

**Status Codes:**
- 200: Success (includes empty report if no events)
- 404: Session not found

### 5. GET /api/v1/automation/screenshots/{screenshot_id}/inputs

Get screenshot with all associated input events.

**Path Parameters:**
- `screenshot_id` (UUID): The screenshot ID

**Response Model:** `ScreenshotWithInputs`
```json
{
  "screenshot": {
    "id": "uuid",
    "session_id": "uuid",
    "name": "screenshot_001.png",
    "storage_path": "s3://...",
    "width": 1920,
    "height": 1080,
    "content_type": "image/png",
    "automation_metadata": {},
    "timestamp": "2025-11-14T12:00:00Z",
    "presigned_url": null,
    "created_at": "2025-11-14T12:00:00Z"
  },
  "inputs": [
    {
      "association_id": "uuid",
      "input_type": "click",
      "input_data": {
        "x": 500,
        "y": 300,
        "button": "left"
      },
      "timestamp_diff_ms": -100,
      "log_timestamp": "2025-11-14T11:59:59.900Z",
      "log_sequence": 42,
      "log_message": "Clicked login button",
      "log_level": "INFO"
    },
    {
      "association_id": "uuid",
      "input_type": "type",
      "input_data": {
        "text": "username@example.com"
      },
      "timestamp_diff_ms": 50,
      "log_timestamp": "2025-11-14T12:00:00.050Z",
      "log_sequence": 43,
      "log_message": "Typed into username field",
      "log_level": "INFO"
    }
  ]
}
```

**Features:**
- Joins through `ScreenshotInputAssociation` table
- Returns full screenshot data plus array of associated input events
- Input events include log metadata (timestamp, sequence, message, level)
- Inputs sorted by `timestamp_diff_ms` (chronological order relative to screenshot)
- Negative `timestamp_diff_ms` means event occurred before screenshot
- Positive `timestamp_diff_ms` means event occurred after screenshot

**Status Codes:**
- 200: Success
- 404: Screenshot not found

## Database Models Used

### AutomationSession
- Main session tracking table
- Includes runner metadata and session lifecycle
- Relationships: logs, screenshots

### AutomationLog
- Sequential log entries from automation runs
- JSONB `log_data` field for structured event data
- GIN index on `log_data` for efficient JSON queries

### AutomationScreenshot
- Screenshots captured during automation
- Includes storage paths and dimensions
- Relationships: input_associations

### ScreenshotInputAssociation
- Links screenshots to input events (logs)
- Tracks timing relationship between screenshot and input
- Input types: click, type, scroll, etc.

## Schema Models

All response models use Pydantic schemas with proper validation:

- `AutomationSession` - Basic session info
- `AutomationSessionWithStats` - Session with counts
- `AutomationSessionListResponse` - Paginated list response
- `AutomationLog` - Log entry
- `AutomationScreenshot` - Screenshot metadata
- `ScreenshotInputAssociation` - Input association
- `TimelineEvent` - Merged log/screenshot event
- `SessionTimeline` - Full timeline response
- `ImageRecognitionStats` - Per-image statistics
- `ImageRecognitionReport` - Full recognition analysis
- `ScreenshotWithInputs` - Screenshot with inputs

## Implementation Details

### Async SQLAlchemy Queries

All endpoints use async SQLAlchemy queries:
```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

query = select(AutomationSession).where(...)
result = await db.execute(query)
sessions = result.scalars().all()
```

### JSON Filtering

Image recognition endpoint uses PostgreSQL JSON operators:
```python
AutomationLog.log_data["event_type"].astext == "image_recognition"
```

### Eager Loading

Relationships are eager-loaded where needed:
```python
.options(selectinload(AutomationScreenshot.input_associations))
```

### Pagination

Standard skip/limit pattern:
```python
query.offset(skip).limit(limit)
```

### Error Handling

Consistent HTTP error responses:
- 404 for not found
- Proper error messages

### Logging

Structured logging with context:
```python
logger.info("get_session_timeline", session_id=str(session_id))
```

## Testing Recommendations

1. **List Sessions**
   - Test pagination (skip, limit)
   - Test status filtering
   - Test date range filtering
   - Verify counts are correct

2. **Session Timeline**
   - Verify logs and screenshots are merged correctly
   - Verify chronological ordering
   - Check event data completeness

3. **Image Recognition Stats**
   - Test with sessions that have image recognition events
   - Test with sessions that have no image recognition events
   - Verify success rate calculations
   - Verify average confidence calculations
   - Check grouping by image_id

4. **Screenshot Inputs**
   - Test screenshots with multiple inputs
   - Test screenshots with no inputs
   - Verify timestamp_diff_ms calculations
   - Check chronological ordering of inputs

## Authentication

The endpoints currently don't require authentication. To add authentication:

```python
from app.api.deps import get_current_active_user_async
from app.models.user import User

@router.get("/sessions")
async def list_automation_sessions(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    # Implementation
```

## URL Structure

All endpoints are under `/api/v1/automation`:

- `GET /api/v1/automation/sessions` - List sessions
- `GET /api/v1/automation/sessions/{session_id}` - Get session
- `GET /api/v1/automation/sessions/{session_id}/timeline` - Get timeline
- `GET /api/v1/automation/sessions/{session_id}/image-recognition` - Get stats
- `GET /api/v1/automation/screenshots/{screenshot_id}/inputs` - Get inputs

## Future Enhancements

1. **Authentication** - Add user-based access control
2. **Authorization** - Verify project access if `project_id` is set
3. **Caching** - Cache timeline and statistics for large sessions
4. **Streaming** - Stream timeline events for very large sessions
5. **Additional Filters** - Add more filtering options (runner_version, hostname, etc.)
6. **Export** - Add export endpoints for timeline and statistics
7. **Real-time Updates** - WebSocket support for live session monitoring
8. **Aggregations** - Add more statistical aggregations (percentiles, histograms, etc.)
