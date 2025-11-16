# State Discovery API

## Overview

The State Discovery API provides endpoints to analyze automation sessions and discover states and state transitions. This enables automated analysis of UI workflows to understand application behavior and state transitions.

## Endpoints

### POST `/api/v1/state-discovery/sessions/{session_id}/discover-states`

Trigger state discovery for an automation session.

**Request Body:**
```json
{
  "algorithm": "timestamp_clustering",
  "parameters": {
    "state_threshold_seconds": 2.0,
    "max_input_distance_seconds": 5.0
  }
}
```

**Response:** `StateDiscoveryResponse`

### GET `/api/v1/state-discovery/sessions/{session_id}/discovered-states`

Get discovered states for an automation session (performs discovery on-demand).

**Query Parameters:**
- `algorithm` (string, default: "timestamp_clustering")
- `state_threshold_seconds` (float, default: 2.0)
- `max_input_distance_seconds` (float, default: 5.0)

**Response:** `StateDiscoveryResponse`

## Response Schema

### StateDiscoveryResponse

```json
{
  "session_id": "uuid",
  "total_states": 5,
  "total_transitions": 4,
  "states": [
    {
      "state_id": "state_0",
      "screenshot_ids": [1, 2, 3],
      "representative_screenshot_id": 1,
      "timestamp_first_seen": "2025-11-16T12:00:00Z",
      "timestamp_last_seen": "2025-11-16T12:00:05Z",
      "visit_count": 1,
      "input_events": [10, 11],
      "outgoing_transitions": [
        {
          "from_state_id": "state_0",
          "to_state_id": "state_1",
          "trigger_event_id": 11,
          "event_type": "mouse.clicked",
          "timestamp": "2025-11-16T12:00:05Z",
          "confidence": 1.0
        }
      ],
      "metadata": {
        "screenshot_count": 3,
        "duration_seconds": 5.0
      }
    }
  ],
  "algorithm": "timestamp_clustering",
  "parameters": {
    "state_threshold_seconds": 2.0,
    "max_input_distance_seconds": 5.0
  },
  "processing_time_ms": 45.2
}
```

### DiscoveredState

- `state_id`: Unique state identifier
- `screenshot_ids`: List of screenshot IDs in this state
- `representative_screenshot_id`: Primary screenshot representing the state
- `timestamp_first_seen`: First time this state was observed
- `timestamp_last_seen`: Last time this state was observed
- `visit_count`: Number of times state was visited
- `input_events`: List of input event IDs that occurred in this state
- `outgoing_transitions`: Transitions from this state to others
- `metadata`: Additional state metadata (screenshot count, duration, etc.)

### StateTransition

- `from_state_id`: Source state ID
- `to_state_id`: Destination state ID
- `trigger_event_id`: Input event that triggered the transition
- `event_type`: Type of triggering event (e.g., "mouse.clicked")
- `timestamp`: When the transition occurred
- `confidence`: Confidence score (0.0-1.0)

## Algorithm: Timestamp Clustering

The default algorithm groups screenshots by temporal proximity and associates input events with their surrounding screenshots.

### Algorithm Steps

1. **Load Data**: Load all screenshots and input events for the session
2. **Sort**: Sort screenshots chronologically
3. **Cluster**: Group screenshots into states based on time gaps
4. **Associate Inputs**: Link input events to nearest screenshots
5. **Create Transitions**: Build state transitions based on input events between states

### Parameters

- `state_threshold_seconds` (default: 2.0): Minimum time gap between screenshots to consider a new state
- `max_input_distance_seconds` (default: 5.0): Maximum time between input event and screenshot for association

### Example

Given screenshots at times: [0s, 0.5s, 1s, 5s, 5.5s]

With default parameters (threshold=2s):
- **State 0**: Screenshots at 0s, 0.5s, 1s
- **State 1**: Screenshots at 5s, 5.5s

The 4-second gap between 1s and 5s exceeds the threshold, creating two states.

## Files

### Implementation
- `/app/api/v1/endpoints/state_discovery.py` - API endpoints
- `/app/services/state_discovery_service.py` - Core discovery algorithm
- `/app/schemas/state_discovery.py` - Pydantic response models

### Tests
- `/tests/test_state_discovery.py` - Comprehensive test suite

## Usage Example

### Python Client

```python
import httpx

async def discover_states(session_id: str):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"http://localhost:8000/api/v1/state-discovery/sessions/{session_id}/discover-states",
            json={
                "algorithm": "timestamp_clustering",
                "parameters": {
                    "state_threshold_seconds": 3.0,
                    "max_input_distance_seconds": 10.0
                }
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        response.raise_for_status()
        return response.json()
```

### cURL

```bash
curl -X POST "http://localhost:8000/api/v1/state-discovery/sessions/{session_id}/discover-states" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "algorithm": "timestamp_clustering",
    "parameters": {
      "state_threshold_seconds": 2.0,
      "max_input_distance_seconds": 5.0
    }
  }'
```

## Future Enhancements

### Potential Algorithm Improvements

1. **Visual Similarity Clustering**
   - Use image hashing or computer vision to group visually similar screenshots
   - Detect when UI returns to a previously seen state
   - Parameters: `similarity_threshold`, `hash_algorithm`

2. **DOM-based Clustering**
   - If DOM snapshots are available, cluster by DOM structure similarity
   - More accurate than visual similarity for web applications
   - Parameters: `dom_similarity_threshold`, `ignore_dynamic_elements`

3. **Semantic Clustering**
   - Use machine learning to understand semantic meaning of states
   - Cluster by functional purpose (login, dashboard, settings, etc.)
   - Parameters: `model_type`, `confidence_threshold`

4. **Hybrid Approaches**
   - Combine multiple algorithms (time + visual + DOM)
   - Weight different signals based on application type
   - Parameters: `weights`, `combination_strategy`

### Additional Features

- **State Labeling**: Automatic naming of states based on content
- **Anomaly Detection**: Identify unusual state transitions
- **Performance Analysis**: Track time spent in each state
- **Coverage Analysis**: Identify unvisited states
- **Regression Detection**: Compare state graphs across sessions

## Performance Considerations

- Discovery is performed on-demand (not cached)
- Processing time scales linearly with number of screenshots
- Typical sessions (100-500 screenshots) complete in < 100ms
- Large sessions (1000+ screenshots) may take several seconds

## Error Handling

- **404 Not Found**: Session ID does not exist
- **422 Validation Error**: Invalid parameters
- **500 Internal Server Error**: Algorithm failure

## Security

- Requires authentication (JWT token)
- User can only access their own automation sessions
- No authorization checks implemented (assumes user owns session)

## Monitoring

Service logs include:
- `state_discovery_started` - Discovery initiated
- `state_discovery_data_loaded` - Data loaded successfully
- `state_discovery_completed` - Discovery finished successfully
- `state_discovery_error` - Discovery failed
