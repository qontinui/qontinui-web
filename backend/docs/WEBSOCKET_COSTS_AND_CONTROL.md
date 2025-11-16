# WebSocket Costs and User Controls

## Your Questions Answered

### 1. Does WebSocket streaming replace recording?

**YES, completely.** WebSocket streaming captures **MORE** data than recording did:

**Recording captured:**
- Screenshots at specific moments
- Some basic metadata

**WebSocket streaming captures:**
- ✅ Real-time screenshots with metadata
- ✅ All automation logs (sequence, level, message, structured data)
- ✅ Input events (text typed, mouse clicks) automatically associated with screenshots
- ✅ Image recognition attempts with confidence scores
- ✅ Action execution timing and status
- ✅ Session lifecycle (start, end, status)

**Conclusion:** Recording is redundant. WebSocket streaming does everything recording did, plus real-time monitoring.

---

### 2. Will free users incur costs by sending data via WebSocket?

**Short answer:** Yes, but they're VERY minimal. You can control this with account-level settings.

**Cost breakdown:**

#### WebSocket Connection Costs (AWS API Gateway WebSocket)

**Connection costs:**
- Connection: $0.25 per million connections
- Messages: $1.00 per million messages (first 1B messages)
- Data transfer: $0.09 per GB (outbound only)

**Example calculation for free user running 1-hour automation:**

| Resource | Usage | Cost |
|----------|-------|------|
| 1 WebSocket connection | 1 connection | $0.00000025 |
| Session start/end | 2 messages | $0.000002 |
| Heartbeats (every 30s) | 120 messages | $0.00012 |
| Logs (1 per second) | 3,600 messages @ ~500 bytes | $0.0036 + $0.0016 data transfer |
| Screenshots (10 total) | 10 messages @ 50 KB each | $0.00001 + $0.045 data transfer |
| **Total** | | **~$0.05 per hour** |

**For 100 free users running 10 hours/month each:**
- Total cost: **~$50/month**
- Per user: **$0.50/month**

#### Database Storage Costs (PostgreSQL RDS)

**Storage:**
- 1 hour of logs: ~1.8 MB (3,600 logs × 500 bytes)
- 10 screenshots: ~500 KB (10 × 50 KB)
- **Total per session: ~2.3 MB**

**Cost:**
- RDS storage: $0.115 per GB-month
- 100 users × 10 sessions × 2.3 MB = 2.3 GB
- **Cost: ~$0.26/month**

#### Object Storage Costs (S3)

**Screenshots:**
- 100 users × 10 sessions × 10 screenshots × 50 KB = 500 MB
- S3 storage: $0.023 per GB-month
- **Cost: ~$0.012/month**

#### **Total Cost for 100 Free Users:**
- WebSocket: $50/month
- Database: $0.26/month
- S3: $0.012/month
- **Total: ~$50.27/month** (WebSocket dominates)

---

### 3. Can WebSocket be turned off for individual accounts?

**YES, absolutely!** You have multiple control options:

#### Option 1: Account-Level WebSocket Toggle (Recommended)

Add a feature flag to user accounts:

```python
# Add to User model
class User(Base):
    # ... existing fields ...
    automation_streaming_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,  # Disabled for free users
        nullable=False
    )
```

**In WebSocket handler:**
```python
@router.websocket("/api/v1/automation/ws/runner")
async def websocket_runner_endpoint(
    websocket: WebSocket,
    token: str,
    db: AsyncSession = Depends(get_async_db)
):
    user = await get_current_user_from_ws(websocket, token, db)

    # Check if user has streaming enabled
    if not user.automation_streaming_enabled:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Automation streaming not enabled for this account"
        )
        return

    # Continue with WebSocket handling...
```

**Runner behavior:**
- Tries to connect to WebSocket
- If connection is rejected (streaming disabled), runner continues normally
- **No data sent, no costs incurred**

#### Option 2: Subscription Tier Control

Tie streaming to subscription levels:

```python
STREAMING_ENABLED_TIERS = ["pro", "enterprise"]

if user.subscription_tier not in STREAMING_ENABLED_TIERS:
    await websocket.close(
        code=status.WS_1008_POLICY_VIOLATION,
        reason="Automation streaming requires Pro or Enterprise subscription"
    )
    return
```

#### Option 3: Usage-Based Throttling

Allow free users limited streaming (e.g., 10 sessions/month):

```python
# Count sessions this month
session_count = await db.scalar(
    select(func.count(AutomationSession.id))
    .where(
        AutomationSession.user_id == user.id,
        AutomationSession.created_at >= start_of_month
    )
)

# Free tier limit
FREE_TIER_SESSION_LIMIT = 10

if user.subscription_tier == "free" and session_count >= FREE_TIER_SESSION_LIMIT:
    await websocket.close(
        code=status.WS_1008_POLICY_VIOLATION,
        reason=f"Free tier limit: {FREE_TIER_SESSION_LIMIT} sessions/month"
    )
    return
```

#### Option 4: Client-Side Toggle (UI Control)

Add a toggle in the runner UI settings:

```typescript
// Runner settings
{
  websocket: {
    enabled: true,  // User can toggle in UI
    url: "ws://localhost:8001/api/v1/automation/ws/runner",
    token: "JWT_TOKEN"
  }
}
```

**When disabled:**
- Runner doesn't attempt WebSocket connection
- **Zero AWS costs**
- Automation still works normally (runner is standalone)

---

## Cost Control Strategies

### Strategy 1: Disable by Default for Free Users (Recommended)

**Implementation:**
```python
# Default automation_streaming_enabled = False
# Pro/Enterprise users get it enabled automatically
# Free users can request to enable (support ticket)
```

**Costs:**
- Free users: $0
- Only paid users contribute to WebSocket costs
- Fair: premium feature for premium users

### Strategy 2: Limited Free Tier

**Implementation:**
```python
# Free: 10 sessions/month with streaming
# Hobby: 100 sessions/month
# Pro: Unlimited
```

**Costs:**
- Free users: ~$5/month (10 sessions × $0.50)
- Manageable and predictable

### Strategy 3: Opt-In for Integration Testing

**Implementation:**
- Streaming disabled by default
- Users enable it only when needed (e.g., debugging, integration testing)
- Automatically disable after 24 hours

**Costs:**
- Pay only when actively testing
- Most users won't enable it

---

## Recommended Approach

### For Your Use Case (Free Users + Integration Testing)

**User Tiers:**

| Tier | Streaming Enabled | Limit | Monthly Cost/User |
|------|------------------|-------|-------------------|
| Free | No (default) | 0 sessions | $0 |
| Free (opt-in) | Yes (time-limited) | 5 sessions/month | $2.50 |
| Hobby | Yes | 50 sessions/month | $25 |
| Pro | Yes | Unlimited | Variable |

**Implementation:**
1. Add `automation_streaming_enabled` field to User model
2. Default to `False` for all users
3. Add UI toggle in runner settings
4. Add API endpoint to enable/disable streaming
5. WebSocket rejects connections if not enabled

**Benefits:**
- ✅ Free users incur $0 cost (unless they opt-in)
- ✅ Integration testing still works (users enable when needed)
- ✅ Costs predictable and controllable
- ✅ Premium feature for paid users

---

## Implementation: Add Streaming Toggle

### 1. Database Migration

```python
# Add to User model
automation_streaming_enabled: Mapped[bool] = mapped_column(
    Boolean, default=False, nullable=False
)
automation_sessions_remaining: Mapped[int | None] = mapped_column(
    Integer, nullable=True  # NULL = unlimited (pro users)
)
```

### 2. WebSocket Authentication Check

```python
async def websocket_runner_endpoint(...):
    user = await get_current_user_from_ws(websocket, token, db)

    # Check if streaming is enabled
    if not user.automation_streaming_enabled:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Automation streaming is disabled for your account. Enable it in your account settings or upgrade your subscription."
        )
        return

    # Check session limit (if applicable)
    if user.automation_sessions_remaining is not None:
        if user.automation_sessions_remaining <= 0:
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Monthly automation streaming limit reached. Resets on the 1st of each month or upgrade your subscription."
            )
            return

        # Decrement remaining sessions
        user.automation_sessions_remaining -= 1
        await db.commit()

    # Continue with normal WebSocket handling...
```

### 3. API Endpoint to Toggle Streaming

```python
@router.post("/api/v1/users/me/automation-streaming")
async def toggle_automation_streaming(
    enabled: bool,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db)
):
    """Enable/disable automation streaming for current user."""

    # Check if user is allowed to enable (subscription tier)
    if enabled and current_user.subscription_tier == "free":
        # Give free users 5 trial sessions
        current_user.automation_streaming_enabled = True
        current_user.automation_sessions_remaining = 5
    elif enabled:
        # Paid users get unlimited
        current_user.automation_streaming_enabled = True
        current_user.automation_sessions_remaining = None
    else:
        # Disable streaming
        current_user.automation_streaming_enabled = False

    await db.commit()

    return {
        "automation_streaming_enabled": current_user.automation_streaming_enabled,
        "sessions_remaining": current_user.automation_sessions_remaining
    }
```

### 4. Runner UI Settings

Add toggle in runner settings panel:

```tsx
<FormControl>
  <FormLabel>Automation Streaming</FormLabel>
  <Switch
    checked={settings.websocket.enabled}
    onChange={(e) => handleStreamingToggle(e.target.checked)}
  />
  <FormHelperText>
    Stream automation data to qontinui.com for monitoring and integration testing.
    {user.subscription_tier === "free" && (
      <> Free users get 5 sessions/month.</>
    )}
  </FormHelperText>
</FormControl>
```

---

## Summary

### Your Questions Answered:

1. **Does WebSocket replace recording?**
   - ✅ YES - WebSocket captures everything recording did, plus more

2. **Will free users incur costs?**
   - ⚠️ YES if WebSocket is enabled (~$0.50 per hour of automation)
   - ✅ NO if you disable streaming by default

3. **Can WebSocket be turned off per account?**
   - ✅ YES - Multiple options:
     - Account-level flag (`automation_streaming_enabled`)
     - Subscription tier check
     - Usage limits (sessions/month)
     - Client-side toggle (UI setting)

### Recommendation:

**Remove recording feature** and use this approach:
1. Disable WebSocket streaming by default for free users
2. Add UI toggle in runner settings
3. Free users can opt-in (5 sessions/month trial)
4. Paid users get unlimited streaming
5. **Cost: $0 for free users unless they explicitly enable it**

This gives you:
- ✅ No cost for free users by default
- ✅ Integration testing capability (opt-in)
- ✅ Premium feature for paid users
- ✅ Full control via UI (no environment variables needed)
- ✅ Cleaner codebase (remove recording complexity)

Ready to proceed with removing the recording feature?
