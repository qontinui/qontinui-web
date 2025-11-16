# Automation API Quick Reference

## Endpoints Overview

All endpoints are under `/api/v1/automation`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sessions` | List all automation sessions with pagination |
| GET | `/sessions/{session_id}` | Get session details with stats |
| GET | `/sessions/{session_id}/timeline` | Get chronological timeline of logs + screenshots |
| GET | `/sessions/{session_id}/image-recognition` | Get image recognition statistics |
| GET | `/screenshots/{screenshot_id}/inputs` | Get screenshot with associated input events |

## Example cURL Requests

### 1. List Sessions
```bash
curl -X GET "http://localhost:8000/api/v1/automation/sessions?limit=10&status=completed"
```

### 2. Get Session Details
```bash
curl -X GET "http://localhost:8000/api/v1/automation/sessions/{session_id}"
```

### 3. Get Session Timeline
```bash
curl -X GET "http://localhost:8000/api/v1/automation/sessions/{session_id}/timeline"
```

### 4. Get Image Recognition Stats
```bash
curl -X GET "http://localhost:8000/api/v1/automation/sessions/{session_id}/image-recognition"
```

### 5. Get Screenshot Inputs
```bash
curl -X GET "http://localhost:8000/api/v1/automation/screenshots/{screenshot_id}/inputs"
```

## Query Parameters

### List Sessions
- `skip` (int, default: 0) - Pagination offset
- `limit` (int, default: 50, max: 100) - Items per page
- `status` (string) - Filter by status: "active", "completed", "failed"
- `start_date` (datetime) - Filter sessions created after date
- `end_date` (datetime) - Filter sessions created before date

## Response Examples

### Session with Stats
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "project_id": "123e4567-e89b-12d3-a456-426614174001",
  "runner_version": "1.0.0",
  "runner_os": "Windows 10",
  "runner_hostname": "test-machine",
  "status": "completed",
  "configuration_snapshot": {},
  "created_at": "2025-11-14T12:00:00Z",
  "ended_at": "2025-11-14T12:30:00Z",
  "log_count": 150,
  "screenshot_count": 25
}
```

### Timeline Event (Log)
```json
{
  "event_type": "log",
  "timestamp": "2025-11-14T12:00:00Z",
  "id": "123e4567-e89b-12d3-a456-426614174002",
  "data": {
    "sequence_number": 1,
    "level": "INFO",
    "message": "Starting automation",
    "log_data": {
      "event_type": "start",
      "details": {}
    },
    "created_at": "2025-11-14T12:00:00Z"
  }
}
```

### Timeline Event (Screenshot)
```json
{
  "event_type": "screenshot",
  "timestamp": "2025-11-14T12:00:05Z",
  "id": "123e4567-e89b-12d3-a456-426614174003",
  "data": {
    "name": "screenshot_001.png",
    "storage_path": "s3://bucket/path/screenshot_001.png",
    "width": 1920,
    "height": 1080,
    "content_type": "image/png",
    "automation_metadata": {},
    "presigned_url": null,
    "created_at": "2025-11-14T12:00:05Z"
  }
}
```

### Image Recognition Stats
```json
{
  "session_id": "123e4567-e89b-12d3-a456-426614174000",
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
    }
  ]
}
```

### Screenshot with Inputs
```json
{
  "screenshot": {
    "id": "123e4567-e89b-12d3-a456-426614174003",
    "session_id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "screenshot_001.png",
    "storage_path": "s3://bucket/path/screenshot_001.png",
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
      "association_id": "123e4567-e89b-12d3-a456-426614174004",
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
    }
  ]
}
```

## Python Client Example

```python
import httpx
from datetime import datetime

async def get_session_timeline(session_id: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"http://localhost:8000/api/v1/automation/sessions/{session_id}/timeline"
        )
        response.raise_for_status()
        return response.json()

async def get_image_recognition_stats(session_id: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"http://localhost:8000/api/v1/automation/sessions/{session_id}/image-recognition"
        )
        response.raise_for_status()
        return response.json()

async def list_sessions(status: str = None, limit: int = 50):
    async with httpx.AsyncClient() as client:
        params = {"limit": limit}
        if status:
            params["status"] = status

        response = await client.get(
            "http://localhost:8000/api/v1/automation/sessions",
            params=params
        )
        response.raise_for_status()
        return response.json()
```

## Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 404 | Resource not found (session, screenshot) |
| 422 | Validation error (invalid parameters) |

## Notes

- All timestamps are in ISO 8601 format with UTC timezone (suffix "Z")
- UUIDs are used for all entity IDs
- Pagination uses skip/limit pattern (not page numbers)
- Timeline events are always sorted chronologically by timestamp
- Image recognition stats return empty report if no events found (not 404)
- Screenshot inputs are sorted by `timestamp_diff_ms` (chronological relative to screenshot)
