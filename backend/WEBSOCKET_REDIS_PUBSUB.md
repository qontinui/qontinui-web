# WebSocket Redis Pub/Sub Implementation

## Overview

This implementation enables horizontal scaling of WebSocket connections using Redis Pub/Sub. Multiple backend instances can now broadcast events to all connected clients, regardless of which instance they're connected to.

## Architecture

### Components

1. **WebSocketManager** (`app/services/websocket_manager.py`)
   - Manages local WebSocket connections
   - Publishes events to Redis channels
   - Subscribes to Redis channels for incoming events
   - Forwards Redis messages to local WebSocket clients

2. **Redis Pub/Sub Channels**
   - Pattern: `ws:session:{session_id}`
   - Each automation session has its own channel
   - All backend instances subscribe to relevant channels
   - Messages are broadcast across all instances

3. **WebSocket Endpoints** (`app/api/v1/endpoints/automation_ws.py`)
   - `/ws/automation/runner` - Runner connection for automation execution
   - `/ws/automation/monitor/{session_id}` - Monitor endpoint for real-time session monitoring

### Data Flow

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│  Backend    │          │    Redis    │          │  Backend    │
│  Instance 1 │          │   Pub/Sub   │          │  Instance 2 │
└──────┬──────┘          └──────┬──────┘          └──────┬──────┘
       │                        │                        │
       │  1. broadcast()        │                        │
       ├───────────────────────>│                        │
       │                        │                        │
       │                        │  2. publish to channel │
       │                        ├───────────────────────>│
       │                        │                        │
       │  3. receive via        │  4. forward to local   │
       │     subscription       │     WebSocket clients  │
       │<───────────────────────┤                        │
       │                        │                        │
       │  5. send to local      │                        │
       │     WebSocket clients  │                        │
       v                        v                        v
  ┌─────────┐            ┌─────────┐            ┌─────────┐
  │ Client  │            │ Client  │            │ Client  │
  │    A    │            │    B    │            │    C    │
  └─────────┘            └─────────┘            └─────────┘
```

## Usage

### 1. Initialize WebSocket Manager

The WebSocket manager is automatically initialized when you call `get_websocket_manager()`:

```python
from app.services.websocket_manager import get_websocket_manager
from app.config.redis_config import get_redis

# Get Redis client
redis_client = await get_redis()

# Get or create WebSocket manager
ws_manager = await get_websocket_manager(redis_client)
```

### 2. Register WebSocket Connection

When a client connects, register the WebSocket:

```python
from fastapi import WebSocket

@router.websocket("/ws/automation/monitor/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()

    # Get WebSocket manager
    redis_client = await get_redis()
    ws_manager = await get_websocket_manager(redis_client)

    # Register connection
    await ws_manager.connect(session_id, websocket)

    try:
        # Your WebSocket logic here
        while True:
            data = await websocket.receive_json()
            # Process messages...
    finally:
        # Cleanup on disconnect
        await ws_manager.disconnect(session_id, websocket)
```

### 3. Broadcast Events

To broadcast an event to all clients monitoring a session:

```python
# Broadcast to all instances via Redis
await ws_manager.broadcast(
    session_id="550e8400-e29b-41d4-a716-446655440000",
    message={
        "type": "session_event",
        "event": "action_completed",
        "data": {
            "action_id": "123",
            "status": "success",
            "duration_ms": 1250
        }
    }
)
```

### 4. Broadcasting from Non-WebSocket Endpoints

You can broadcast events from regular HTTP endpoints or background tasks:

```python
from fastapi import APIRouter, Depends
from app.services.websocket_manager import get_websocket_manager
from app.config.redis_config import get_redis
from redis import asyncio as aioredis

router = APIRouter()

@router.post("/automation/sessions/{session_id}/notify")
async def notify_session(
    session_id: str,
    redis: aioredis.Redis = Depends(get_redis)
):
    """Broadcast a notification to all connected clients for a session."""
    ws_manager = await get_websocket_manager(redis)

    await ws_manager.broadcast(
        session_id,
        {
            "type": "notification",
            "message": "Automation step completed",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    )

    return {"status": "sent", "connections": ws_manager.get_connection_count(session_id)}
```

## WebSocket Endpoints

### Monitor Endpoint

**URL:** `ws://localhost:8000/api/v1/ws/automation/monitor/{session_id}?token=<jwt_token>`

**Features:**
- Real-time monitoring of automation sessions
- Broadcasts connection events (user joined/left)
- Status requests
- Ping/pong for keep-alive

**Client Message Types:**

```json
// Keep connection alive
{
  "type": "ping"
}

// Request session status
{
  "type": "request_status"
}
```

**Server Message Types:**

```json
// Connection acknowledgment
{
  "type": "connected",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "123",
  "username": "john_doe",
  "local_connections": 2,
  "timestamp": "2025-11-21T10:30:00.000Z"
}

// Connection info (user joined/left)
{
  "type": "connection_info",
  "action": "user_joined",
  "user_id": "123",
  "username": "john_doe",
  "timestamp": "2025-11-21T10:30:00.000Z"
}

// Status response
{
  "type": "status",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "local_connections": 2,
  "total_sessions": 5,
  "timestamp": "2025-11-21T10:30:00.000Z"
}

// Ping from server
{
  "type": "ping",
  "timestamp": "2025-11-21T10:30:00.000Z"
}

// Error
{
  "type": "error",
  "message": "Authentication failed"
}
```

## Testing

### Local Testing (Single Instance)

1. Start Redis:
```bash
docker-compose -f docker-compose.dev.yml up -d redis
```

2. Start the backend:
```bash
cd backend
poetry run python run.py
```

3. Connect via WebSocket client (e.g., wscat):
```bash
npm install -g wscat

# Get JWT token first
TOKEN="your-jwt-token-here"
SESSION_ID="550e8400-e29b-41d4-a716-446655440000"

# Connect to monitor endpoint
wscat -c "ws://localhost:8000/api/v1/ws/automation/monitor/${SESSION_ID}?token=${TOKEN}"
```

### Testing Horizontal Scaling (Multiple Instances)

1. Start Redis:
```bash
docker-compose -f docker-compose.dev.yml up -d redis
```

2. Start first backend instance (port 8000):
```bash
cd backend
PORT=8000 poetry run uvicorn app.main:app --reload --port 8000 --host 0.0.0.0
```

3. Start second backend instance (port 8001):
```bash
cd backend
PORT=8001 poetry run uvicorn app.main:app --reload --port 8001 --host 0.0.0.0
```

4. Connect clients to different instances:

**Client A (connects to instance 1):**
```bash
wscat -c "ws://localhost:8000/api/v1/ws/automation/monitor/${SESSION_ID}?token=${TOKEN}"
```

**Client B (connects to instance 2):**
```bash
wscat -c "ws://localhost:8001/api/v1/ws/automation/monitor/${SESSION_ID}?token=${TOKEN}"
```

5. Send a message from either client - both should receive it!

### Broadcast Test Script

Create a test script to broadcast events:

```python
# test_broadcast.py
import asyncio
import json
from redis import asyncio as aioredis

async def test_broadcast():
    """Test broadcasting via Redis Pub/Sub"""
    redis = await aioredis.from_url(
        "redis://localhost:6379/0",
        encoding="utf-8",
        decode_responses=True
    )

    session_id = "550e8400-e29b-41d4-a716-446655440000"
    channel = f"ws:session:{session_id}"

    message = {
        "type": "test_event",
        "message": "Hello from test script!",
        "timestamp": "2025-11-21T10:30:00.000Z"
    }

    # Publish to Redis channel
    await redis.publish(channel, json.dumps(message))
    print(f"Published to {channel}: {message}")

    await redis.close()

if __name__ == "__main__":
    asyncio.run(test_broadcast())
```

Run the script:
```bash
poetry run python test_broadcast.py
```

All connected clients should receive the message!

## Performance Considerations

### Connection Limits

- Each backend instance maintains its own set of WebSocket connections
- Redis Pub/Sub has minimal overhead for message routing
- Scale horizontally by adding more backend instances

### Redis Channel Strategy

- One channel per session: `ws:session:{session_id}`
- Channels are created/destroyed dynamically
- Only active sessions have listeners
- Automatic cleanup when last connection disconnects

### Memory Usage

- Each WebSocket manager instance stores:
  - Local connection registry (minimal memory)
  - Redis Pub/Sub subscriptions (one per active session)
  - Listener tasks (one per active session)

### Network Traffic

- Messages are published once to Redis
- Redis fans out to all subscribed instances
- Only instances with connections forward messages
- No duplicate message delivery

## Production Deployment

### Environment Variables

Ensure Redis is configured in `.env`:

```bash
REDIS_ENABLED=true
REDIS_HOST=localhost  # or Redis cluster endpoint
REDIS_PORT=6379
REDIS_DB=0
```

### Load Balancer Configuration

Configure your load balancer (e.g., AWS ALB) for WebSocket support:

1. **Enable WebSocket support**
   - Set connection timeout to longer duration (e.g., 300 seconds)
   - Enable sticky sessions if needed

2. **Health checks**
   - Use `/health` endpoint for HTTP health checks
   - WebSocket connections don't need separate health checks

3. **Scaling policy**
   - Scale based on CPU/memory usage
   - Consider connection count per instance
   - Redis can handle thousands of channels

### Monitoring

Key metrics to monitor:

1. **WebSocket connections per instance**
   ```python
   ws_manager.get_total_connections()
   ```

2. **Active sessions**
   ```python
   len(ws_manager.get_active_sessions())
   ```

3. **Redis Pub/Sub channels**
   ```bash
   redis-cli PUBSUB CHANNELS "ws:session:*"
   ```

4. **Redis connection count**
   ```bash
   redis-cli CLIENT LIST | grep pubsub
   ```

## Troubleshooting

### Issue: Messages not received by all clients

**Cause:** Redis not running or connection failed

**Solution:**
1. Check Redis is running: `docker ps | grep redis`
2. Check Redis connection in logs: Look for "websocket_manager_initialized"
3. Verify Redis URL in config

### Issue: Duplicate messages

**Cause:** Multiple listener tasks for same session

**Solution:**
- Check `_active_channels` set to prevent duplicates
- Ensure proper cleanup in `disconnect()` method
- Look for "redis_listener_started" in logs (should only appear once per session)

### Issue: High Redis CPU usage

**Cause:** Too many Pub/Sub channels or frequent messages

**Solution:**
- Consider message batching for high-frequency events
- Use Redis cluster for horizontal scaling
- Monitor channel count: `redis-cli PUBSUB CHANNELS "ws:*"`

### Issue: WebSocket disconnects unexpectedly

**Cause:** Network timeout or missing heartbeat

**Solution:**
- Ensure clients send periodic pings
- Server sends pings every 120 seconds
- Check load balancer timeout settings

## Future Enhancements

1. **Message Persistence**
   - Store recent messages in Redis for replay on reconnect
   - Implement message sequence numbers

2. **Presence Tracking**
   - Track which users are connected to which sessions
   - Store in Redis for cross-instance visibility

3. **Rate Limiting**
   - Add per-user message rate limits
   - Prevent broadcast spam

4. **Message Filtering**
   - Allow clients to subscribe to specific event types
   - Reduce unnecessary message traffic

5. **Metrics and Analytics**
   - Track message delivery rates
   - Monitor broadcast latency
   - Export to Prometheus/Grafana

## References

- [Redis Pub/Sub Documentation](https://redis.io/docs/manual/pubsub/)
- [FastAPI WebSocket Documentation](https://fastapi.tiangolo.com/advanced/websockets/)
- [aioredis Documentation](https://aioredis.readthedocs.io/)
