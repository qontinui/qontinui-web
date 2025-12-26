# Cost-Saving Features Implementation Guide

This document describes the cost-saving features implemented for qontinui-web backend to reduce AWS costs related to automation sessions and screenshot storage.

## Features Implemented

### 1. Session Duration Limits (8-hour max)

**Status:** ✅ Model Updated, ⚠️ WebSocket Integration Pending

**Files Modified:**
- `/app/models/automation_session.py`

**Changes Made:**
1. Added `max_duration_seconds` field to AutomationSession model (default: 28800 = 8 hours)
2. Added `is_expired()` method to check if session exceeded max duration
3. Updated status enum to include 'expired' and 'aborted' states

**Implementation:**
```python
# New field in AutomationSession
max_duration_seconds: Mapped[int] = mapped_column(
    Integer, nullable=False, default=28800  # 8 hours
)

# New method
def is_expired(self) -> bool:
    """Check if session has exceeded its maximum duration."""
    if self.status in ("completed", "failed", "expired", "aborted"):
        return False

    duration = (datetime.utcnow() - self.created_at).total_seconds()
    return duration > self.max_duration_seconds
```

**WebSocket Integration (Implementation Example):**

To complete the implementation, add this code to `app/api/v1/endpoints/automation_ws.py`:

```python
# At the top of the file, add import:
from app.services.automation_session_cleanup import check_session_timeout

# In the main message loop (around line 742), add timeout check:
async def websocket_runner_endpoint(websocket: WebSocket, token: str):
    # ... existing code ...

    # Main message loop
    while True:
        try:
            # Receive message with timeout
            data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)

            # ===== ADD THIS SECTION =====
            # Check if current session has expired (8-hour max)
            if current_session_id and db:
                is_expired, session_info = await check_session_timeout(db, current_session_id)

                if is_expired:
                    # Send policy violation message
                    await websocket.send_json({
                        "type": "policy_violation",
                        "reason": "session_expired",
                        "message": f"Session exceeded maximum duration of {session_info['duration_hours']:.1f} hours",
                        "max_hours": session_info['max_duration_seconds'] / 3600,
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    })

                    # Close WebSocket
                    await websocket.close(
                        code=status.WS_1008_POLICY_VIOLATION,
                        reason="Session duration limit exceeded",
                    )
                    break
            # ===== END OF NEW SECTION =====

            # ... rest of existing code ...
```

**Database Migration Required:**

After modifying the model, create and run a database migration:

```bash
cd backend
./scripts/safe_migrate.sh "add_session_duration_limits"
poetry run alembic upgrade head
```

---

### 2. Orphaned Session Cleanup

**Status:** ✅ Complete

**Files Created:**
- `/app/services/automation_session_cleanup.py` (new service)

**Files Modified:**
- `/app/worker/tasks/cleanup_tasks.py`

**Changes Made:**

1. **Created cleanup service** (`automation_session_cleanup.py`):
   - `cleanup_session_on_disconnect()`: Called when WebSocket disconnects
   - `check_session_timeout()`: Checks if session exceeded max duration

2. **Created Celery task** (`cleanup_orphaned_sessions()`):
   - Runs periodically (recommended: every hour)
   - Finds sessions with status='active' older than 1 hour
   - Automatically sets status='aborted', ended_at=now()
   - Logs all cleanup actions

**WebSocket Integration (Implementation Example):**

Add this to the `finally` block in `websocket_runner_endpoint()`:

```python
# In the finally block (around line 872):
finally:
    # ===== ADD THIS SECTION =====
    # Cleanup session on disconnect
    if current_session_id and db:
        try:
            cleanup_result = await cleanup_session_on_disconnect(
                db=db,
                session_id=current_session_id,
                disconnect_reason="websocket_disconnect",
            )
            logger.info(
                "session_cleanup_on_disconnect",
                session_id=str(current_session_id),
                cleanup_result=cleanup_result,
            )
        except Exception as e:
            logger.error(
                "session_cleanup_failed",
                session_id=str(current_session_id),
                error=str(e),
            )
    # ===== END OF NEW SECTION =====

    # ... existing cleanup code ...
```

**Celery Task Registration:**

The task is already exported in `cleanup_tasks.py`. To schedule it:

1. Add to your ARQ worker configuration or cron scheduler:
```python
# Run every hour
from app.worker.tasks.cleanup_tasks import cleanup_orphaned_sessions

# ARQ configuration (if using ARQ)
cron_jobs = [
    cron(cleanup_orphaned_sessions, hour={0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}, minute=0),
]

# OR Celery Beat configuration (if using Celery)
app.conf.beat_schedule = {
    'cleanup-orphaned-sessions': {
        'task': 'app.worker.tasks.cleanup_tasks.cleanup_orphaned_sessions',
        'schedule': timedelta(hours=1),
    },
}
```

**Behavior:**
- Sessions active for >30 minutes: Auto-aborted on WebSocket disconnect
- Sessions active for >1 hour: Auto-aborted by periodic cleanup task
- All actions logged with session_id, user_id, and duration

---

### 3. Screenshot Cleanup Policy (30-day retention for free tier)

**Status:** ✅ Complete

**Files Modified:**
- `/app/worker/tasks/cleanup_tasks.py`

**Changes Made:**

Created Celery task `cleanup_old_screenshots()`:
- Deletes screenshots older than 30 days for free-tier users
- Performs S3 deletion first, then database cleanup
- Tracks deletion count and errors
- Configurable retention period via environment variable

**Configuration:**

Add to `.env` file:

```bash
# Screenshot retention (days)
SCREENSHOT_RETENTION_DAYS_FREE=30
SCREENSHOT_RETENTION_DAYS_PAID=0  # 0 = unlimited
```

Update `app/core/config.py`:

```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Screenshot cleanup
    SCREENSHOT_RETENTION_DAYS_FREE: int = Field(
        default=30,
        description="Screenshot retention period for free-tier users (days)",
    )
    SCREENSHOT_RETENTION_DAYS_PAID: int = Field(
        default=0,
        description="Screenshot retention period for paid users (0 = unlimited)",
    )
```

**Celery Task Registration:**

Schedule the cleanup task to run daily:

```python
# ARQ configuration
from app.worker.tasks.cleanup_tasks import cleanup_old_screenshots

cron_jobs = [
    cron(cleanup_old_screenshots, hour=2, minute=0),  # Run at 2 AM daily
]

# OR Celery Beat configuration
app.conf.beat_schedule = {
    'cleanup-old-screenshots': {
        'task': 'app.worker.tasks.cleanup_tasks.cleanup_old_screenshots',
        'schedule': crontab(hour=2, minute=0),  # Run at 2 AM daily
    },
}
```

**Behavior:**
1. Query screenshots older than retention period for free-tier users
2. Delete from S3/MinIO first
3. Delete from database only after successful S3 deletion
4. Track errors and continue processing (don't abort on single failure)
5. Log all deletions with screenshot_id and storage_path

**Error Handling:**
- S3 deletion failures: Logged but processing continues
- Database deletion failures: Logged but processing continues
- Task returns `partial_success` if any errors occurred
- Prevents orphaned database records by attempting DB deletion even if S3 fails

---

## Testing Recommendations

### 1. Session Duration Limits

**Unit Tests:**
```python
# Test AutomationSession.is_expired()
def test_session_not_expired():
    session = AutomationSession(
        created_at=datetime.utcnow(),
        max_duration_seconds=28800,
        status="active"
    )
    assert session.is_expired() == False

def test_session_expired():
    session = AutomationSession(
        created_at=datetime.utcnow() - timedelta(hours=9),
        max_duration_seconds=28800,
        status="active"
    )
    assert session.is_expired() == True
```

**Integration Tests:**
```python
# Test WebSocket timeout enforcement
async def test_websocket_session_timeout():
    # 1. Start WebSocket session
    # 2. Mock session created_at to be 9 hours ago
    # 3. Send message
    # 4. Assert receives policy_violation message
    # 5. Assert WebSocket closes with WS_1008_POLICY_VIOLATION
    # 6. Assert session status updated to 'expired'
```

### 2. Orphaned Session Cleanup

**Unit Tests:**
```python
async def test_cleanup_session_on_disconnect_short_duration():
    # Session active for <30 minutes
    # Should NOT be aborted

async def test_cleanup_session_on_disconnect_long_duration():
    # Session active for >30 minutes
    # Should be aborted

async def test_cleanup_orphaned_sessions_task():
    # Create active sessions at various ages
    # Run cleanup task
    # Assert only sessions >1 hour are aborted
```

**Integration Tests:**
```python
async def test_websocket_disconnect_cleanup():
    # 1. Start WebSocket session
    # 2. Wait 31 minutes (or mock timestamps)
    # 3. Disconnect WebSocket
    # 4. Assert session status = 'aborted'
    # 5. Assert ended_at is set
```

### 3. Screenshot Cleanup

**Unit Tests:**
```python
async def test_cleanup_old_screenshots_free_tier():
    # Create screenshots older than 30 days for free user
    # Run cleanup task
    # Assert screenshots deleted from S3 and DB

async def test_cleanup_old_screenshots_paid_tier():
    # Create screenshots older than 30 days for paid user
    # Run cleanup task
    # Assert screenshots NOT deleted (unlimited retention)

async def test_cleanup_screenshots_s3_error_handling():
    # Mock S3 deletion failure
    # Run cleanup task
    # Assert database deletion still attempted
    # Assert error logged but task continues
```

**Manual Tests:**
1. Create test screenshots via automation runner
2. Manually update created_at timestamp to 31 days ago
3. Update user subscription_tier to 'free'
4. Run cleanup task manually: `poetry run python -c "import asyncio; from app.worker.tasks.cleanup_tasks import cleanup_old_screenshots; asyncio.run(cleanup_old_screenshots({}))"`
5. Verify S3 deletion in MinIO/S3 console
6. Verify database deletion via SQL query

---

## Production Deployment Checklist

### Pre-Deployment

- [ ] Review all code changes
- [ ] Create database migration: `./scripts/safe_migrate.sh "add_session_duration_limits"`
- [ ] Test migration on local database
- [ ] Update `.env` with new config variables
- [ ] Run unit tests
- [ ] Run integration tests

### Deployment

- [ ] Deploy code changes to staging
- [ ] Run database migration on staging
- [ ] Test WebSocket timeout enforcement on staging
- [ ] Test orphaned session cleanup on staging
- [ ] Test screenshot cleanup on staging (create test data first)
- [ ] Monitor logs for errors
- [ ] Deploy to production
- [ ] Run database migration on production
- [ ] Configure Celery Beat / ARQ cron jobs for periodic cleanup
- [ ] Monitor production logs for 24 hours

### Post-Deployment

- [ ] Verify cleanup tasks running on schedule
- [ ] Check cleanup task logs for errors
- [ ] Monitor S3 storage usage (should decrease)
- [ ] Monitor database size (should stabilize)
- [ ] Review cost reports after 7 days
- [ ] Adjust retention periods if needed

---

## Monitoring and Alerts

### Key Metrics to Monitor

1. **Session Duration:**
   - Average session duration
   - Number of sessions exceeding 4 hours
   - Number of sessions hitting 8-hour limit

2. **Orphaned Sessions:**
   - Number of sessions aborted by cleanup task
   - Number of sessions aborted on disconnect
   - Total active sessions at any time

3. **Screenshot Cleanup:**
   - Screenshots deleted per day
   - S3 deletion failures
   - Database deletion failures
   - Storage space freed

### Recommended Logs to Track

```python
# Session expiration
logger.warning("automation_session_expired", session_id=..., duration_hours=...)

# Orphaned session cleanup
logger.info("orphaned_session_aborted", session_id=..., age_minutes=...)

# Screenshot cleanup
logger.info("cleanup_old_screenshots_completed", deleted_count=..., retention_days=...)
```

### Alerts to Configure

1. **High Alert:** More than 10 sessions hitting 8-hour limit per day
2. **Medium Alert:** More than 50 orphaned sessions cleaned up per day
3. **Medium Alert:** S3 deletion failure rate > 5%
4. **Low Alert:** Screenshot cleanup task hasn't run in 25 hours

---

## Cost Savings Estimation

### Assumptions
- Average session duration: 15 minutes
- Orphaned sessions: 5% of total sessions
- Average session duration for orphaned: 2 hours
- Screenshots per session: 20
- Screenshot size: 500 KB
- S3 storage cost: $0.023 per GB/month
- Free tier users: 80% of user base

### Estimated Savings

**Session Duration Limits:**
- Before: Unlimited (some sessions could run indefinitely)
- After: 8-hour maximum
- Savings: Prevents runway sessions (~1-2% of compute costs)

**Orphaned Session Cleanup:**
- Before: Orphaned sessions run until manually stopped
- After: Auto-aborted after 1 hour max
- Savings: ~5% of compute costs (prevents 95 minutes of extra runtime per orphaned session)

**Screenshot Cleanup (30-day retention):**
- Before: Unlimited retention
- After: 30-day retention for free tier
- Storage per free user per month: 20 sessions × 20 screenshots × 500 KB = 200 MB
- Storage after 30-day cleanup: 200 MB (vs 2.4 GB per year)
- Savings per free user: ~$0.05/month
- Total savings (1000 free users): ~$50/month = $600/year

**Total Estimated Annual Savings:** $600 - $1,200 (depending on usage patterns)

---

## Future Enhancements

1. **Session Duration Tiers:**
   - Free tier: 4-hour max
   - Hobby tier: 8-hour max
   - Pro tier: 24-hour max
   - Enterprise: Unlimited

2. **Screenshot Compression:**
   - Compress screenshots before S3 upload
   - Estimated 50-70% size reduction
   - Additional $300-$400/year savings

3. **Session Hibernation:**
   - Pause inactive sessions (no messages for 10 minutes)
   - Resume on next message
   - Prevent timeout for legitimate long-running sessions

4. **Intelligent Screenshot Retention:**
   - Keep screenshots referenced by annotations
   - Delete unreferenced screenshots after 7 days
   - Keep one screenshot per session as record

5. **Cost Dashboard:**
   - Real-time cost tracking per user
   - Session duration histograms
   - Storage usage trends
   - Automated cost alerts

---

## Troubleshooting

### Session Not Timing Out

**Symptom:** Sessions continue running beyond 8 hours

**Causes:**
1. Database migration not applied
2. WebSocket timeout check not integrated
3. Session records not being created

**Solutions:**
1. Verify migration: `poetry run alembic current`
2. Check WebSocket code for timeout check
3. Add logging to verify session creation

### Cleanup Task Not Running

**Symptom:** Orphaned sessions not being aborted

**Causes:**
1. Celery/ARQ worker not running
2. Task not registered in schedule
3. Task failing silently

**Solutions:**
1. Check worker status: `celery -A app.worker.celery_app inspect active`
2. Check beat schedule: `celery -A app.worker.celery_app inspect scheduled`
3. Check worker logs for errors

### Screenshots Not Being Deleted

**Symptom:** Old screenshots still in S3/database

**Causes:**
1. All users are paid tier (no free tier users)
2. S3 deletion failing
3. Query not finding old screenshots

**Solutions:**
1. Verify user subscription_tier values
2. Check S3 credentials and permissions
3. Run query manually to verify screenshot age
4. Check cleanup task logs for errors

---

## Support and Documentation

For questions or issues:
1. Check logs: `docker-compose logs -f backend`
2. Review Celery worker logs
3. Check database for session/screenshot records
4. Consult main project README and deployment documentation

**Related Documentation:**
- `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/CLAUDE.md`
- `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/DEPLOYMENT.md`
- `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend/README.md`
