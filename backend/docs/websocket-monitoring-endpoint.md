# WebSocket Session Monitoring Endpoint

## Overview

A real-time monitoring WebSocket endpoint for live session viewing in the qontinui-web backend. This endpoint allows authenticated users to monitor active automation sessions and receive live logs and screenshots as they occur.

## Endpoint Details

**Endpoint Path:** `/api/v1/automation/sessions/{session_id}/monitor`

**Protocol:** WebSocket

**Authentication:** JWT token via query parameter

## Connection

### URL Format
```
ws://localhost:8001/api/v1/automation/sessions/{session_id}/monitor?token=<jwt_token>
```

### Parameters

- **Path Parameter:**
  - `session_id` (UUID): The automation session to monitor

- **Query Parameter:**
  - `token` (string): JWT access token for authentication

## Authentication & Authorization

1. **JWT Authentication**: Token is validated using the same pattern as the runner endpoint
2. **Session Validation**: Session must exist in the database
3. **Project Access Control**: If the session has a `project_id`, the user must own that project
4. **Active User Check**: User account must be active

## Polling Implementation

Since there's no pub/sub system yet, the endpoint uses a database polling approach:

- **Poll Interval**: 1.5 seconds
- **Log Tracking**: Tracks `last_log_sequence` to fetch only new logs
- **Screenshot Tracking**: Tracks `last_screenshot_timestamp` to fetch only new screenshots
- **Ordering**: Logs ordered by sequence_number ASC, screenshots by timestamp ASC

## Event Formats

### Log Event
```json
{
  "type": "log",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "sequence_number": 42,
    "level": "info",
    "message": "Action completed successfully",
    "log_data": {
      "action": "click",
      "target": "button#submit"
    },
    "timestamp": "2025-11-14T12:34:56.789000Z"
  },
  "timestamp": "2025-11-14T12:34:57.000000Z"
}
```

### Screenshot Event
```json
{
  "type": "screenshot",
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "name": "screenshot_001",
    "presigned_url": "https://s3.amazonaws.com/bucket/path?signature=...",
    "width": 1920,
    "height": 1080,
    "automation_metadata": {
      "step": "login",
      "action": "after_click"
    },
    "timestamp": "2025-11-14T12:34:56.500000Z"
  },
  "timestamp": "2025-11-14T12:34:57.000000Z"
}
```

### Heartbeat Event
```json
{
  "type": "heartbeat",
  "timestamp": "2025-11-14T12:34:57.000000Z"
}
```

Sent every ~15 seconds (every 10 polls) to keep the connection alive.

### Error Event
```json
{
  "type": "error",
  "error": "Error message",
  "details": {
    "error_type": "DatabaseError",
    "context": "additional info"
  },
  "timestamp": "2025-11-14T12:34:57.000000Z"
}
```

## Features

### Security
- JWT token authentication
- Project ownership verification
- Session existence validation
- Proper error handling and logging

### Performance
- Efficient database queries with indexed fields
- Only fetches new events since last poll
- Presigned URLs generated on-demand for screenshots
- Configurable poll interval

### Reliability
- Graceful disconnection handling
- Error recovery (continues monitoring despite errors)
- Proper cleanup in finally blocks
- Structured logging for debugging

### Client Experience
- Regular heartbeats to detect connection issues
- Clear error messages
- ISO8601 timestamps for all events
- Type-safe event schemas

## Pydantic Schemas

Three new schemas were added to `/backend/app/schemas/automation.py`:

### MonitoringLogEvent
```python
class MonitoringLogEvent(BaseModel):
    id: UUID
    sequence_number: int
    level: str
    message: str
    log_data: dict[str, Any] = Field(default_factory=dict)
    timestamp: IsoDatetime
```

### MonitoringScreenshotEvent
```python
class MonitoringScreenshotEvent(BaseModel):
    id: UUID
    name: str
    presigned_url: str
    width: int
    height: int
    automation_metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: IsoDatetime
```

### MonitoringEvent
```python
class MonitoringEvent(BaseModel):
    type: str  # "log" or "screenshot"
    data: MonitoringLogEvent | MonitoringScreenshotEvent
    timestamp: IsoDatetime
```

## Implementation Notes

### Database Queries

**Logs Query:**
```sql
SELECT * FROM automation_logs
WHERE session_id = :session_id
  AND sequence_number > :last_sequence
ORDER BY sequence_number ASC
```

**Screenshots Query:**
```sql
SELECT * FROM automation_screenshots
WHERE session_id = :session_id
  AND timestamp > :last_timestamp
ORDER BY timestamp ASC
```

### State Tracking
- `last_log_sequence`: Integer, starts at 0
- `last_screenshot_timestamp`: Datetime, starts at `datetime.min`
- `heartbeat_counter`: Integer, resets every 10 polls

### Connection Lifecycle

1. **Accept** - WebSocket connection accepted
2. **Authenticate** - Validate JWT token
3. **Authorize** - Check session and project access
4. **Monitor** - Poll for new events every 1.5 seconds
5. **Disconnect** - Graceful cleanup on client disconnect or error

## Error Handling

### Authentication Errors
- Invalid token → Close with `WS_1008_POLICY_VIOLATION`
- Inactive user → Close with `WS_1008_POLICY_VIOLATION`

### Authorization Errors
- Invalid session_id format → Close with `WS_1003_UNSUPPORTED_DATA`
- Session not found → Close with `WS_1008_POLICY_VIOLATION`
- Unauthorized access → Close with `WS_1008_POLICY_VIOLATION`

### Runtime Errors
- Database errors → Send error event, continue monitoring
- WebSocket disconnect → Clean exit, log disconnection
- Unexpected errors → Log error, attempt graceful close

## Future Improvements

When a pub/sub system is available:

1. Replace polling with Redis Pub/Sub or similar
2. Remove `poll_interval` and `asyncio.sleep()`
3. Subscribe to session-specific channels
4. Push events immediately when they occur
5. Reduce database load significantly

## Usage Example

### JavaScript Client
```javascript
const sessionId = '550e8400-e29b-41d4-a716-446655440000';
const token = 'eyJhbGciOiJIUzI1NiIs...';
const ws = new WebSocket(
  `ws://localhost:8001/api/v1/automation/sessions/${sessionId}/monitor?token=${token}`
);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'log':
      console.log(`[${data.data.level}] ${data.data.message}`);
      break;

    case 'screenshot':
      console.log(`Screenshot: ${data.data.name}`);
      displayImage(data.data.presigned_url);
      break;

    case 'heartbeat':
      console.log('Connection alive');
      break;

    case 'error':
      console.error(`Error: ${data.error}`, data.details);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket disconnected');
};
```

### Python Client
```python
import asyncio
import json
import websockets

async def monitor_session(session_id: str, token: str):
    uri = f"ws://localhost:8001/api/v1/automation/sessions/{session_id}/monitor?token={token}"

    async with websockets.connect(uri) as websocket:
        async for message in websocket:
            data = json.loads(message)

            if data['type'] == 'log':
                print(f"[{data['data']['level']}] {data['data']['message']}")
            elif data['type'] == 'screenshot':
                print(f"Screenshot: {data['data']['name']}")
            elif data['type'] == 'heartbeat':
                print("Heartbeat received")
            elif data['type'] == 'error':
                print(f"Error: {data['error']}")

# Run
asyncio.run(monitor_session(
    session_id="550e8400-e29b-41d4-a716-446655440000",
    token="your-jwt-token"
))
```

## Testing

### Manual Testing

1. Start the backend server
2. Create an automation session via the runner WebSocket
3. Connect to the monitoring endpoint with a valid token
4. Send logs and screenshots via the runner WebSocket
5. Verify events appear in the monitoring WebSocket

### Integration Testing

```python
import pytest
from fastapi.testclient import TestClient

@pytest.mark.asyncio
async def test_monitor_endpoint_authentication():
    """Test that invalid tokens are rejected"""
    # Test implementation
    pass

@pytest.mark.asyncio
async def test_monitor_endpoint_receives_logs():
    """Test that new logs are pushed to monitoring clients"""
    # Test implementation
    pass

@pytest.mark.asyncio
async def test_monitor_endpoint_receives_screenshots():
    """Test that new screenshots are pushed to monitoring clients"""
    # Test implementation
    pass

@pytest.mark.asyncio
async def test_monitor_endpoint_heartbeat():
    """Test that heartbeats are sent regularly"""
    # Test implementation
    pass
```

## Logging

The endpoint uses structured logging with these events:

- `ws_monitor_connected` - When a client connects
- `ws_monitor_authenticated` - When authentication succeeds
- `ws_monitor_heartbeat_sent` - When a heartbeat is sent (debug level)
- `ws_monitor_disconnected` - When client disconnects
- `ws_monitor_poll_error` - When polling encounters an error
- `ws_monitor_fatal_error` - When a fatal error occurs

## Performance Considerations

### Database Load
- Each poll executes 2 queries (logs and screenshots)
- With 10 concurrent monitors polling every 1.5s: ~13 queries/second
- Indexes on `session_id`, `sequence_number`, and `timestamp` are critical

### Memory Usage
- Minimal state per connection (2 integers + timestamp)
- No buffering of historical events
- Presigned URLs generated on-demand

### Network Bandwidth
- Only new events are sent (no duplicates)
- Heartbeats are minimal JSON
- Screenshots send URLs, not image data

## Configuration

Poll interval can be adjusted by changing the `poll_interval` variable:

```python
poll_interval = 1.5  # seconds
```

Heartbeat frequency can be adjusted by changing the counter threshold:

```python
if heartbeat_counter >= 10:  # Send every 10 polls
```

## Files Modified

1. `/backend/app/api/v1/endpoints/automation_ws.py`
   - Added monitoring WebSocket endpoint
   - Imported necessary models and schemas

2. `/backend/app/schemas/automation.py`
   - Added `MonitoringLogEvent` schema
   - Added `MonitoringScreenshotEvent` schema
   - Added `MonitoringEvent` schema
