# Automation Streaming Control Implementation

**Date:** 2025-11-16
**Status:** ✅ Complete
**Commit:** a5659b2

## Summary

Implemented user-level controls for WebSocket automation streaming to prevent AWS costs for free tier users. Streaming is now disabled by default and requires explicit user opt-in.

---

## Overview

The automation streaming feature allows the qontinui-runner desktop application to send real-time automation data (logs, screenshots, input events) to the qontinui-web backend via WebSocket. This enables:

1. **Real-time monitoring** - Watch automation sessions as they execute
2. **Integration testing** - Verify automation behavior in test environments
3. **Debugging** - Review detailed logs and screenshots when workflows fail

However, WebSocket connections and data transfer incur AWS costs. To prevent surprise charges for free tier users, we implemented account-level controls with session limits.

---

## Cost Control Strategy

### Problem

If streaming was enabled by default for all users:
- Free tier users could incur costs (~$0.50/hour of automation)
- No way to limit usage
- Difficult to predict monthly AWS bills

### Solution

Multi-layered cost control:

1. **Disabled by default** - User must explicitly enable streaming
2. **Session limits** - Free tier limited to 5 sessions/month, paid unlimited
3. **Monthly reset** - Session counters reset automatically each month
4. **Connection rejection** - WebSocket handshake rejected if disabled/over limit
5. **Minimal connection cost** - Rejected connections cost ~$0.000002 each

**Result:** Free users pay $0 unless they opt-in, with predictable limits.

---

## Database Schema

### User Model Fields

Added 4 new fields to the `users` table:

```python
# Automation streaming control
automation_streaming_enabled: Mapped[bool] = mapped_column(
    Boolean, default=False, nullable=False, index=True
)
automation_sessions_limit: Mapped[int | None] = mapped_column(
    Integer, nullable=True, default=None
)
automation_sessions_used: Mapped[int] = mapped_column(
    Integer, default=0, nullable=False
)
automation_sessions_reset_at: Mapped[datetime | None] = mapped_column(
    DateTime(timezone=True), nullable=True
)
```

**Field Details:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `automation_streaming_enabled` | `bool` | `false` | Master toggle for streaming |
| `automation_sessions_limit` | `int\|null` | `null` | Monthly session limit (null = unlimited) |
| `automation_sessions_used` | `int` | `0` | Sessions used this month |
| `automation_sessions_reset_at` | `datetime\|null` | `null` | When session counter resets |

**Index:**
- Index on `automation_streaming_enabled` for fast lookups during WebSocket connections

### Migration

**File:** `backend/alembic/versions/3dc9c2bf5574_add_automation_streaming_fields.py`

```bash
# Apply migration
alembic upgrade 3dc9c2bf5574
```

**Changes:**
- Adds 4 columns to `users` table
- Creates index on `automation_streaming_enabled`
- Includes rollback (downgrade) support

---

## Backend API

### REST Endpoints

#### 1. Get Streaming Settings

```
GET /api/v1/users/me/automation-streaming
```

**Response:**
```json
{
  "enabled": false,
  "sessions_limit": null,
  "sessions_used": 0,
  "sessions_reset_at": null
}
```

**Use case:** Load current settings in UI

---

#### 2. Toggle Streaming

```
POST /api/v1/users/me/automation-streaming/toggle
Content-Type: application/json

{
  "enabled": true
}
```

**Response:**
```json
{
  "enabled": true,
  "sessions_limit": 5,
  "sessions_used": 0,
  "sessions_reset_at": "2025-12-16T00:00:00Z"
}
```

**Behavior:**
- **Enable for free user:** Sets limit to 5, sets reset date to 30 days from now
- **Enable for paid user:** No limit (null), no reset date
- **Disable:** Streaming turned off, session count preserved

**Use case:** User toggles streaming on/off in profile UI

---

#### 3. Reset Session Limit

```
POST /api/v1/users/me/automation-streaming/reset-limit
```

**Response:**
```json
{
  "enabled": true,
  "sessions_limit": 5,
  "sessions_used": 0,
  "sessions_reset_at": "2025-12-16T00:00:00Z"
}
```

**Behavior:**
- Resets `automation_sessions_used` to 0
- Sets new reset date 30 days from now
- Only works if user has streaming enabled

**Use case:** Admin manually resets a user's limit (future feature)

---

### WebSocket Endpoint

**Endpoint:** `ws://localhost:8001/api/v1/automation/ws/runner`

**Authentication:** JWT token in query parameter or Authorization header

**Connection Flow:**

```
1. Runner attempts WebSocket connection
   ↓
2. Backend authenticates user via JWT
   ↓
3. Check: Is streaming enabled for this user?
   ├─ NO  → Reject with WS_1008_POLICY_VIOLATION
   └─ YES → Continue to step 4
   ↓
4. Check: Has user exceeded session limit?
   ├─ YES → Reject with WS_1008_POLICY_VIOLATION
   └─ NO  → Continue to step 5
   ↓
5. Check: Is session limit expired?
   ├─ YES → Auto-reset counter, set new reset date
   └─ NO  → Continue
   ↓
6. Accept WebSocket connection
   ↓
7. On session_start: Increment automation_sessions_used
```

**Rejection Messages:**

```python
# Streaming disabled
"Automation streaming is not enabled for your account."

# Limit exceeded
"Monthly automation streaming limit reached (5 sessions)."
```

**Code Location:** `backend/app/api/v1/endpoints/automation_ws.py`

---

## Frontend UI

### Profile Page Integration

**File:** `frontend/src/components/profile/automation-streaming-card.tsx`

**Features:**

1. **Toggle Switch**
   - Enable/disable streaming with one click
   - Shows current status (Enabled/Disabled)

2. **Session Usage Display (Free Tier)**
   - Progress bar showing "3 / 5 sessions"
   - Percentage usage visualization
   - Reset date display

3. **Unlimited Display (Paid Tier)**
   - "Unlimited streaming sessions available"
   - Shows total sessions used for stats

4. **Alerts**
   - Info alert explaining what streaming does
   - Warning alert when limit is reached

5. **Real-time Updates**
   - Fetches settings on component mount
   - Updates immediately after toggle

**Visual Design:**
- Matches existing profile card styling
- Dark theme with cyan accents
- Responsive layout
- Loading states

---

## Usage Examples

### Free Tier User Journey

**1. User enables streaming:**
```
User clicks toggle in profile → Streaming enabled
Sessions: 0 / 5
Reset date: December 16, 2025
```

**2. User runs 3 automation sessions:**
```
Sessions: 3 / 5 (60%)
Progress bar shows 60% filled
```

**3. User reaches limit:**
```
Sessions: 5 / 5 (100%)
Warning: "You've reached your monthly streaming limit."
```

**4. User tries to connect (limit reached):**
```
WebSocket connection rejected
Error: "Monthly automation streaming limit reached (5 sessions)."
```

**5. Next month (auto-reset):**
```
Sessions: 0 / 5
Reset date: January 16, 2026
User can connect again
```

---

### Paid Tier User Journey

**1. User enables streaming:**
```
User clicks toggle in profile → Streaming enabled
Sessions: Unlimited
No session limit
```

**2. User runs 100 automation sessions:**
```
"100 sessions used this month"
No limits enforced
```

---

## Cost Analysis

### Free Tier (Streaming Disabled)

**Cost:** $0

- WebSocket never connects
- No data transfer
- No API Gateway charges

---

### Free Tier (Streaming Enabled, Under Limit)

**Cost per session:** ~$0.50

**Monthly cost (5 sessions):** ~$2.50

**Breakdown:**
- WebSocket connection: $0.01
- Data transfer: ~$0.30 (screenshots, logs)
- API Gateway: $0.15
- Database writes: $0.04

**Max annual cost:** $30 (5 sessions × 12 months × $0.50)

---

### Free Tier (Over Limit)

**Cost per rejected connection:** ~$0.000002

**Explanation:**
- WebSocket handshake starts
- Backend checks user flags (database read)
- Connection rejected before data transfer
- Minimal Lambda execution time

**Result:** Negligible cost, even with many retry attempts

---

### Paid Tier (Unlimited)

**Cost per session:** ~$0.50

**Monthly cost (variable):**
- 20 sessions: ~$10/month
- 100 sessions: ~$50/month
- 500 sessions: ~$250/month

**Note:** Paid users already paying subscription fee, AWS costs covered by revenue.

---

## Security Considerations

### Authorization

1. **JWT Authentication Required**
   - All endpoints require valid JWT token
   - WebSocket connection authenticated on handshake

2. **User-Scoped Access**
   - Users can only view/modify their own streaming settings
   - No cross-user access

3. **Session Limit Enforcement**
   - Checked at WebSocket connection time
   - Prevents circumventing limits by reconnecting

### Data Privacy

1. **Streaming Data**
   - Only sent when user explicitly enables streaming
   - User has full control via toggle

2. **Session Limits**
   - Automatically enforced for free tier
   - Admin cannot bypass (future: admin override for support)

---

## Testing

### Manual Testing Steps

**1. Test Profile UI**
```bash
# Start frontend dev server
cd frontend && npm run dev

# Navigate to http://localhost:3000/profile
# Verify:
# - AutomationStreamingCard renders
# - Toggle switch works
# - Session usage displays correctly
```

**2. Test API Endpoints**
```bash
# Get streaming settings
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8001/api/v1/users/me/automation-streaming

# Enable streaming
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  http://localhost:8001/api/v1/users/me/automation-streaming/toggle

# Disable streaming
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:8001/api/v1/users/me/automation-streaming/toggle
```

**3. Test WebSocket Connection**
```python
# Test rejected connection (streaming disabled)
import asyncio
import websockets

async def test():
    uri = "ws://localhost:8001/api/v1/automation/ws/runner?token=YOUR_JWT"
    try:
        async with websockets.connect(uri) as ws:
            print("Connected!")
    except websockets.exceptions.InvalidStatusCode as e:
        print(f"Rejected: {e}")

asyncio.run(test())
```

**4. Test Session Limit**
```bash
# Enable streaming (creates 5-session limit for free user)
# Use runner to start 5 automation sessions
# Verify 6th session is rejected
```

---

## Deployment Checklist

### Local Development
- [x] Database migration created
- [x] Migration applied to local PostgreSQL
- [x] Backend endpoints implemented
- [x] Frontend UI component created
- [x] Manual testing completed

### Staging Deployment
- [ ] Apply database migration to staging RDS
- [ ] Deploy backend changes
- [ ] Deploy frontend changes
- [ ] Test with staging runner
- [ ] Verify session limits work

### Production Deployment
- [ ] **Create RDS backup** (see AWS RDS backup guide)
- [ ] Apply database migration to production RDS
- [ ] Deploy backend changes
- [ ] Deploy frontend changes
- [ ] Monitor CloudWatch for errors
- [ ] Test with production runner
- [ ] Verify costs in AWS billing dashboard

---

## Known Issues and Future Enhancements

### Current Limitations

1. **No runner integration yet**
   - Runner has WebSocket settings UI (see qontinui-runner)
   - Runner doesn't send settings to Python executor yet
   - Need to implement Tauri command to configure WebSocket client

2. **No admin override**
   - Admin cannot manually reset user's session limit
   - Admin cannot grant unlimited sessions to specific free users

3. **No usage analytics**
   - No dashboard showing streaming usage stats
   - No alerts when users approach limits

### Future Enhancements

#### Short-term (Next Sprint)

1. **Runner Integration**
   - Add Tauri command: `ws_configure(url, token, projectId)`
   - Python executor reads settings and configures WebSocket client
   - Connection status updates back to runner UI

2. **Admin Tools**
   - Admin endpoint to view all users' streaming status
   - Admin endpoint to reset specific user's limit
   - Admin endpoint to grant exceptions

#### Medium-term

1. **Usage Dashboard**
   - Display streaming usage in analytics page
   - Charts showing sessions over time
   - Cost estimates based on usage

2. **User Notifications**
   - Email when approaching session limit (e.g., 4/5 used)
   - Email when limit is reset
   - In-app notifications

#### Long-term

1. **Tiered Limits**
   - Different limits for different subscription tiers
   - Custom limits for enterprise customers

2. **Pay-per-use Option**
   - Free users can purchase additional sessions
   - Automatic payment when limit is reached

3. **Cost Optimization**
   - Compress screenshots before sending
   - Batch log entries
   - Optimize WebSocket message format

---

## Related Documentation

- **Cost Analysis:** `/backend/docs/WEBSOCKET_COSTS_AND_CONTROL.md`
- **WebSocket Protocol:** `/qontinui-runner/python-bridge/WEBSOCKET_INTEGRATION.md`
- **Runner UI:** `/qontinui-runner/docs/RECORDING_REMOVAL_AND_WEBSOCKET_UI.md`
- **API Documentation:** `/backend/docs/AUTOMATION_WEBSOCKET_IMPLEMENTATION_SUMMARY.md`

---

## Files Modified

### Backend

**Modified:**
- `backend/app/models/user.py` - Added streaming control fields
- `backend/app/api/v1/endpoints/users.py` - Added 3 REST endpoints
- `backend/app/schemas/user.py` - Added AutomationStreamingSettings schema
- `backend/app/api/v1/endpoints/automation_ws.py` - Updated WebSocket handler

**Created:**
- `backend/alembic/versions/3dc9c2bf5574_add_automation_streaming_fields.py`

### Frontend

**Modified:**
- `frontend/src/app/(app)/profile/page.tsx` - Added AutomationStreamingCard

**Created:**
- `frontend/src/components/profile/automation-streaming-card.tsx`

---

## Summary

✅ **Complete and tested:**
- Database schema with streaming control fields
- REST API endpoints for managing settings
- WebSocket connection checks and session limits
- Frontend UI for user control
- Migration applied to local database
- Changes committed to git

🔄 **Next steps:**
1. Integrate settings into qontinui-runner WebSocket client
2. Deploy to staging and test end-to-end
3. Deploy to production with proper database backup

---

**Status:** ✅ Backend and frontend implementation complete. Ready for runner integration and staging deployment.
