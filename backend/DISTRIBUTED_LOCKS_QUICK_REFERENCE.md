# Distributed Locks - Quick Reference Guide

## Usage Patterns

### Basic Lock Acquisition

```python
from app.services.collaboration_service import collaboration_service

# Acquire lock
lock_info = await collaboration_service.acquire_resource_lock(
    db=db,
    user_id=user.id,
    project_id=project_id,
    resource_type="workflow",  # or "state", "project", etc.
    resource_id="workflow-123",
    duration_minutes=5,
    metadata={"component": "visual-editor"}
)

if lock_info:
    # Lock acquired successfully
    lock_id = lock_info["lock_id"]
    expires_at = lock_info["expires_at"]
    backend = lock_info["backend"]  # "redis" or "postgresql"
else:
    # Resource is locked by another user
    # Handle conflict...
```

### Release Lock

```python
success = await collaboration_service.release_resource_lock(
    db=db,
    lock_id=lock_id,
    user_id=user.id,
    project_id=project_id,
    resource_type="workflow",
    resource_id="workflow-123",
)
```

### Refresh Lock (Heartbeat)

```python
# Call this every 4 minutes for 5-minute locks
success = await collaboration_service.refresh_resource_lock(
    db=db,
    lock_id=lock_id,
    user_id=user.id,
    project_id=project_id,
    resource_type="workflow",
    resource_id="workflow-123",
    duration_minutes=5,
)
```

### Check if Resource is Locked

```python
from app.utils.lock_utils import check_resource_lock, get_lock_info

can_modify, lock = await check_resource_lock(
    db=db,
    user_id=user.id,
    project_id=project_id,
    resource_type="project",
    resource_id=str(project_id),
)

if not can_modify and lock:
    # Resource is locked by another user
    lock_info = await get_lock_info(lock, db)
    raise HTTPException(
        status_code=status.HTTP_423_LOCKED,
        detail={
            "message": "Resource is locked by another user",
            "lock_info": lock_info,
        },
    )
```

## Resource Types

Available resource types (from `app.models.collaboration.ResourceType`):
- `"workflow"` - Entire workflow
- `"state"` - Individual state/node
- `"image"` - Image resource
- `"transition"` - Workflow transition
- `"action"` - Action configuration
- `"project"` - Entire project

## Lock Info Structure

```python
{
    "lock_id": "uuid-string",
    "user_id": "uuid-string",
    "project_id": 123,
    "resource_type": "workflow",
    "resource_id": "workflow-123",
    "expires_at": "2025-11-20T12:00:00",  # ISO format
    "backend": "redis"  # or "postgresql"
}
```

## HTTP Status Codes

- `201 Created` - Lock acquired successfully
- `409 Conflict` - Resource already locked by another user (old endpoints)
- `423 Locked` - Resource is locked by another user (new endpoints)
- `404 Not Found` - Lock not found or unauthorized release
- `204 No Content` - Lock released successfully

## Frontend Integration

### Lock Lifecycle

```typescript
class LockManager {
  private lockId: string | null = null;
  private heartbeatInterval: NodeJS.Timer | null = null;

  async acquireLock(projectId: number, resourceType: string, resourceId: string) {
    try {
      const response = await api.post(`/api/v1/collaboration/${projectId}/locks`, {
        resource_type: resourceType,
        resource_id: resourceId,
        duration_minutes: 5,
      });

      this.lockId = response.data.id;
      this.startHeartbeat(projectId);
      return true;
    } catch (error) {
      if (error.response.status === 409 || error.response.status === 423) {
        // Resource locked by another user
        return false;
      }
      throw error;
    }
  }

  startHeartbeat(projectId: number) {
    this.heartbeatInterval = setInterval(async () => {
      if (this.lockId) {
        try {
          await api.post(
            `/api/v1/collaboration/${projectId}/locks/${this.lockId}/refresh`,
            { duration_minutes: 5 }
          );
        } catch (error) {
          console.error('Lock refresh failed', error);
          // Show warning to user
        }
      }
    }, 4 * 60 * 1000); // Every 4 minutes
  }

  async releaseLock(projectId: number) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.lockId) {
      try {
        await api.delete(`/api/v1/collaboration/${projectId}/locks/${this.lockId}`);
      } catch (error) {
        console.error('Lock release failed', error);
      } finally {
        this.lockId = null;
      }
    }
  }
}
```

### Handle 423 Locked Responses

```typescript
async function saveProject(projectId: number, data: any) {
  try {
    await api.put(`/api/v1/projects/${projectId}`, data);
    toast.success('Project saved');
  } catch (error) {
    if (error.response.status === 423) {
      const lockInfo = error.response.data.lock_info;
      toast.error(
        `Project is being edited by ${lockInfo.locked_by}. ` +
        `Lock expires at ${new Date(lockInfo.expires_at).toLocaleTimeString()}.`
      );
    } else {
      toast.error('Failed to save project');
    }
  }
}
```

## Configuration

### Environment Variables

```bash
# Enable/disable Redis (falls back to PostgreSQL if disabled)
REDIS_ENABLED=True

# Redis connection
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
```

### Default Settings

- **Lock Duration:** 5 minutes (default), max 30 minutes
- **Heartbeat Interval:** Every 4 minutes (for 5-minute locks)
- **Auto-expiration:** Automatic with Redis, background job with PostgreSQL
- **Max Concurrent Locks:** Unlimited (resource-based locking)

## Redis Key Format

Distributed locks use the following Redis key format:

```
lock:{project_id}:{resource_type}:{resource_id}
```

Examples:
- `lock:123:workflow:workflow-456`
- `lock:123:state:state-789`
- `lock:123:project:123`

## Troubleshooting

### Lock Not Acquired

**Problem:** `acquire_resource_lock()` returns `None`

**Causes:**
1. Resource is locked by another user
2. Redis/PostgreSQL connection issue

**Solution:**
```python
lock_info = await collaboration_service.acquire_resource_lock(...)
if not lock_info:
    # Get current lock info
    existing_lock = await collaboration_service.get_resource_lock(
        db, project_id, resource_type, resource_id
    )
    if existing_lock:
        # Show lock holder info to user
        logger.info("Resource locked by", user_id=existing_lock.user_id)
```

### Redis Connection Failed

**Problem:** Logs show "redis_unavailable_falling_back_to_db"

**Causes:**
1. Redis is not running
2. Wrong Redis host/port configuration
3. Network connectivity issue

**Solution:**
- Check Redis status: `docker ps | grep redis`
- Verify configuration in `.env`
- System automatically falls back to PostgreSQL (no action needed)

### Lock Expired During Editing

**Problem:** User lost lock while actively editing

**Causes:**
1. Heartbeat not working (frontend issue)
2. Lock duration too short
3. Network connectivity issues

**Solution:**
- Implement lock heartbeat in frontend (call refresh every 4 minutes)
- Increase lock duration if needed
- Add UI indicator showing lock status and expiration

### Orphaned Locks

**Problem:** Lock remains after user disconnected

**Redis:** Locks auto-expire based on TTL (no orphans)

**PostgreSQL:** Background cleanup job runs periodically
```python
# Cleanup expired locks
expired_count = await collaboration_service.release_expired_locks(db)
```

## Performance Benchmarks

### Lock Acquisition Time

- **Redis:** 1-5ms (SETNX operation)
- **PostgreSQL:** 10-50ms (SELECT FOR UPDATE + INSERT)

### Lock Release Time

- **Redis:** 1-3ms (DELETE operation)
- **PostgreSQL:** 5-20ms (SELECT + DELETE + COMMIT)

### Concurrent Requests

- **Redis:** Handles 1000+ concurrent lock requests/second
- **PostgreSQL:** Handles 100-200 concurrent lock requests/second

## Best Practices

1. **Always Release Locks**
   ```python
   try:
       # Acquire lock and do work
       lock_info = await collaboration_service.acquire_resource_lock(...)
       # ... do work ...
   finally:
       # Always release, even on error
       if lock_info:
           await collaboration_service.release_resource_lock(...)
   ```

2. **Use Resource-Specific Locks**
   - Lock individual workflows, not entire projects
   - Lock specific states, not entire workflows
   - Minimize lock scope for better concurrency

3. **Implement Lock Heartbeat**
   - Call refresh every 4 minutes for 5-minute locks
   - Stop heartbeat when user leaves page
   - Show lock expiration countdown to user

4. **Handle Lock Conflicts Gracefully**
   - Show who holds the lock
   - Show lock expiration time
   - Provide option to notify lock holder
   - Allow read-only access while locked

5. **Monitor Lock Usage**
   - Log lock acquisitions and releases
   - Track lock contention
   - Monitor average lock duration
   - Alert on orphaned locks (PostgreSQL only)

## Testing

### Unit Test Example

```python
import pytest
from app.services.collaboration_service import collaboration_service

@pytest.mark.asyncio
async def test_lock_acquisition(db_session, test_user, test_project):
    """Test basic lock acquisition."""
    # Acquire lock
    lock_info = await collaboration_service.acquire_resource_lock(
        db=db_session,
        user_id=test_user.id,
        project_id=test_project.id,
        resource_type="workflow",
        resource_id="test-workflow",
        duration_minutes=5,
    )

    assert lock_info is not None
    assert lock_info["user_id"] == str(test_user.id)
    assert lock_info["backend"] in ["redis", "postgresql"]

    # Try to acquire same lock (should extend existing)
    lock_info2 = await collaboration_service.acquire_resource_lock(
        db=db_session,
        user_id=test_user.id,
        project_id=test_project.id,
        resource_type="workflow",
        resource_id="test-workflow",
        duration_minutes=5,
    )

    assert lock_info2 is not None
    assert lock_info2["lock_id"] == lock_info["lock_id"]

    # Release lock
    success = await collaboration_service.release_resource_lock(
        db=db_session,
        lock_id=lock_info["lock_id"],
        user_id=test_user.id,
        project_id=test_project.id,
        resource_type="workflow",
        resource_id="test-workflow",
    )

    assert success is True

@pytest.mark.asyncio
async def test_lock_conflict(db_session, test_user, test_user2, test_project):
    """Test lock conflict between two users."""
    # User 1 acquires lock
    lock_info = await collaboration_service.acquire_resource_lock(
        db=db_session,
        user_id=test_user.id,
        project_id=test_project.id,
        resource_type="workflow",
        resource_id="test-workflow",
        duration_minutes=5,
    )

    assert lock_info is not None

    # User 2 tries to acquire same lock (should fail)
    lock_info2 = await collaboration_service.acquire_resource_lock(
        db=db_session,
        user_id=test_user2.id,
        project_id=test_project.id,
        resource_type="workflow",
        resource_id="test-workflow",
        duration_minutes=5,
    )

    assert lock_info2 is None  # Lock acquisition failed
```

## Migration Guide

### From Old Lock Methods

**Old Code:**
```python
lock = await collaboration_service.acquire_project_lock(
    db, user_id, project_id, resource_type, resource_id
)
if lock:
    # Got lock (ProjectLock model)
    lock_id = lock.id
```

**New Code:**
```python
lock_info = await collaboration_service.acquire_resource_lock(
    db, user_id, project_id, resource_type, resource_id
)
if lock_info:
    # Got lock (dict)
    lock_id = lock_info["lock_id"]
    backend = lock_info["backend"]
```

**Benefits of New Methods:**
- Faster with Redis
- Automatic expiration
- Distributed support
- Consistent API across backends
