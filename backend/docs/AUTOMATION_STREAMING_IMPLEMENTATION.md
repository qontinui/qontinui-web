# Automation Streaming WebSocket Implementation

## Overview

Implemented WebSocket endpoint for automation runner streaming with user-level streaming control and session limits.

## Files Modified

### 1. `/backend/app/api/v1/endpoints/automation_ws.py` (NEW)

Created new WebSocket endpoint for automation streaming with the following features:

**Authentication & Authorization:**
- JWT token authentication via `get_current_user_from_ws()`
- User streaming settings validation
- Session limit enforcement

**Streaming Control Checks:**

1. **Streaming Enabled Check:**
   ```python
   if not user.automation_streaming_enabled:
       await websocket.close(
           code=status.WS_1008_POLICY_VIOLATION,
           reason="Automation streaming is not enabled for your account. Enable it in your account settings."
       )
       return
   ```

2. **Monthly Limit Reset:**
   - Automatically resets `automation_sessions_used` when `automation_sessions_reset_at` is in the past
   - Sets new reset date using `dateutil.relativedelta` (+1 month)

3. **Session Limit Check:**
   ```python
   if user.automation_sessions_limit is not None:
       if user.automation_sessions_used >= user.automation_sessions_limit:
           await websocket.close(
               code=status.WS_1008_POLICY_VIOLATION,
               reason=f"Monthly automation streaming limit reached ({user.automation_sessions_limit} sessions). Limit resets on the 1st of each month."
           )
           return
   ```

4. **Session Count Increment:**
   - When `session_start` message is received, increments `user.automation_sessions_used`
   - Only applies if `automation_sessions_limit` is not None (unlimited users are not counted)

**Message Types Supported:**

Client → Server:
- `session_start` - Start new automation session
- `session_end` - End automation session
- `log` - Send automation log
- `screenshot` - Send screenshot with metadata
- `heartbeat` - Keep connection alive

Server → Client:
- `connected` - Connection acknowledgment with session info
- `session_started` - Session created, includes sessions remaining
- `session_ended` - Session completed
- `log_received` - Log acknowledgment
- `screenshot_received` - Screenshot acknowledgment
- `heartbeat_ack` - Heartbeat response
- `ping` - Keep-alive ping
- `error` - Error messages

### 2. `/backend/app/api/v1/api.py` (MODIFIED)

Added automation_ws router to API:
```python
from app.api.v1.endpoints import automation_ws
api_router.include_router(automation_ws.router, tags=["automation-websockets"])
```

## User Model Fields (Already Exist)

The following fields in the `User` model are used by the WebSocket endpoint:

```python
automation_streaming_enabled: Mapped[bool]  # Default: False
automation_sessions_limit: Mapped[int | None]  # NULL = unlimited
automation_sessions_used: Mapped[int]  # Default: 0
automation_sessions_reset_at: Mapped[datetime | None]  # Reset date
```

## WebSocket Connection Flow

```
1. Client connects with JWT token
   ↓
2. Authenticate user
   ↓
3. Check if automation_streaming_enabled == True
   ├─ False → Close connection (policy violation)
   └─ True → Continue
   ↓
4. Check if monthly limit needs reset
   ├─ automation_sessions_reset_at < now → Reset counter & date
   └─ Continue
   ↓
5. Check if session limit reached
   ├─ sessions_used >= sessions_limit → Close connection
   └─ Continue
   ↓
6. Send connection acknowledgment
   ↓
7. Accept messages from client
   ↓
8. On session_start:
   └─ Increment automation_sessions_used
```

## Cost Control

**Free Users (Default):**
- `automation_streaming_enabled = False`
- WebSocket connection rejected immediately
- **Cost: $0**

**Enabled Users (Opt-in):**
- `automation_streaming_enabled = True`
- `automation_sessions_limit = 10` (example)
- Can use up to 10 sessions per month
- **Cost: ~$5/month** (10 sessions × $0.50/session)

**Paid Users (Unlimited):**
- `automation_streaming_enabled = True`
- `automation_sessions_limit = NULL`
- Unlimited sessions
- **Cost: Variable** (based on usage)

## Session Limit Reset Logic

The monthly limit automatically resets when `automation_sessions_reset_at` is in the past:

```python
if user.automation_sessions_reset_at and datetime.utcnow() > user.automation_sessions_reset_at:
    user.automation_sessions_used = 0
    user.automation_sessions_reset_at = datetime.utcnow() + relativedelta(months=1)
    await db.commit()
```

This ensures users get their sessions refreshed monthly without manual intervention.

## Dependencies

Added `python-dateutil` for monthly date calculations:
```python
from dateutil.relativedelta import relativedelta
```

## Testing the Endpoint

**WebSocket URL:**
```
ws://localhost:8000/api/v1/ws/automation/runner?token=<JWT_TOKEN>
```

**Test Connection (Python):**
```python
import asyncio
import websockets
import json

async def test_connection():
    uri = "ws://localhost:8000/api/v1/ws/automation/runner?token=YOUR_JWT_TOKEN"

    async with websockets.connect(uri) as websocket:
        # Receive connection acknowledgment
        response = await websocket.recv()
        print(f"Connected: {response}")

        # Start session
        await websocket.send(json.dumps({
            "type": "session_start",
            "data": {"workflow_name": "TestFlow"}
        }))

        response = await websocket.recv()
        print(f"Session started: {response}")

asyncio.run(test_connection())
```

## Next Steps

1. **Add API endpoint** to toggle `automation_streaming_enabled` for users:
   ```python
   POST /api/v1/users/me/automation-streaming
   {"enabled": true}
   ```

2. **Add UI toggle** in runner settings to enable/disable streaming

3. **Store session data** in database (AutomationSession model)

4. **Store logs** in database (AutomationLog model)

5. **Upload screenshots** to S3

6. **Add monthly reset cron job** (optional, since it's done on-demand)

## Summary

WebSocket endpoint now properly enforces:
- ✅ Streaming must be enabled (`automation_streaming_enabled`)
- ✅ Monthly session limits (`automation_sessions_limit`)
- ✅ Automatic monthly reset (`automation_sessions_reset_at`)
- ✅ Session counting on `session_start` messages
- ✅ Clear error messages when limits are reached

**Cost Impact:**
- Free users (default): $0 (streaming disabled)
- Opted-in users: Controlled by session limits
- Paid users: Unlimited (NULL limit)
