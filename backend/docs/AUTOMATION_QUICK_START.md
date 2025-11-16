# Automation WebSocket - Quick Start Guide

## 1. Apply Database Migration

```bash
cd /mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend
alembic upgrade head
```

This creates the following tables:
- `automation_sessions`
- `automation_logs`
- `automation_screenshots`
- `screenshot_input_associations`

## 2. Start Backend Server

```bash
cd /mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

## 3. WebSocket Endpoints

### Runner Connection (qontinui-runner → Backend)
```
ws://localhost:8001/api/v1/automation/ws/runner?token={JWT_TOKEN}
```

**Message Types:**
- `session_start` - Start automation session
- `screenshot` - Upload screenshot (base64 PNG)
- `log` - Send log entry with structured data
- `heartbeat` - Keep connection alive
- `session_end` - End session with status

### Monitoring Connection (Frontend → Backend)
```
ws://localhost:8001/api/v1/automation/sessions/{session_id}/monitor?token={JWT_TOKEN}
```

Streams real-time logs and screenshots as they arrive.

## 4. REST API Endpoints

**Base URL:** `http://localhost:8001/api/v1/automation`

### List Sessions
```bash
curl http://localhost:8001/api/v1/automation/sessions
```

### Get Session Timeline
```bash
curl http://localhost:8001/api/v1/automation/sessions/{session_id}/timeline
```

### Get Image Recognition Stats
```bash
curl http://localhost:8001/api/v1/automation/sessions/{session_id}/image-recognition
```

### Get Screenshot Inputs
```bash
curl http://localhost:8001/api/v1/automation/screenshots/{screenshot_id}/inputs
```

## 5. Test with qontinui-runner

Configure runner WebSocket settings:

```json
{
  "websocket": {
    "enabled": true,
    "url": "ws://localhost:8001/api/v1/automation/ws/runner",
    "token": "YOUR_JWT_TOKEN"
  }
}
```

## 6. API Documentation

Interactive API docs:
```
http://localhost:8001/docs
```

## 7. Key Features

✅ **Automatic Input Association** - Text typed and mouse clicks are automatically linked to screenshots
✅ **Real-time Monitoring** - WebSocket streaming of live automation events
✅ **Timeline Queries** - Chronological view of all session events
✅ **Image Recognition Stats** - Success rates, confidence scores by image
✅ **Structured Logging** - All events stored with JSONB metadata

## 8. Database Queries

### View Recent Sessions
```sql
SELECT id, status, runner_version, created_at, ended_at
FROM automation_sessions
ORDER BY created_at DESC
LIMIT 10;
```

### View Session Logs
```sql
SELECT sequence_number, level, message, timestamp
FROM automation_logs
WHERE session_id = 'YOUR_SESSION_ID'
ORDER BY sequence_number;
```

### View Input Associations
```sql
SELECT
  s.name AS screenshot_name,
  a.input_type,
  a.input_data,
  a.timestamp_diff_ms
FROM screenshot_input_associations a
JOIN automation_screenshots s ON a.screenshot_id = s.id
WHERE s.session_id = 'YOUR_SESSION_ID'
ORDER BY a.created_at;
```

## 9. Troubleshooting

### WebSocket Connection Fails
- Check JWT token is valid
- Verify backend server is running
- Check firewall allows WebSocket connections

### Screenshots Not Uploading
- Verify object storage is configured
- Check base64 encoding is correct
- Verify image format is PNG or JPEG

### Input Association Not Working
- Verify screenshots have correct timestamps
- Check log events have `event_type` in `log_data`
- Ensure events are within 5-second time window

### Monitoring WebSocket Not Receiving Events
- Verify session_id is correct
- Check user has access to session's project
- Ensure backend is saving events to database

## 10. Next Steps

1. **Frontend Integration** - Connect monitoring WebSocket to display live events
2. **Timeline Visualization** - Show chronological event flow
3. **Screenshot Gallery** - Display all session screenshots
4. **Stats Dashboard** - Show image recognition success rates
5. **Session Replay** - Playback automation execution

---

For detailed documentation, see:
- `AUTOMATION_WEBSOCKET_IMPLEMENTATION_SUMMARY.md`
- `automation-api-endpoints.md`
- `websocket-monitoring-endpoint.md`
