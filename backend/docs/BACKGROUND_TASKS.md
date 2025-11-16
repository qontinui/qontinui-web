# Background Tasks

This document describes the background tasks available in the qontinui-web backend using ARQ (Async Redis Queue).

## Overview

Background tasks are implemented using ARQ for async job processing. Tasks are queued and processed by a worker process that runs separately from the main API.

**Current Status**: Tasks are defined but Redis/Worker is not yet deployed. See [ADDING_REDIS_ELASTICACHE.md](./ADDING_REDIS_ELASTICACHE.md) for deployment instructions.

## Available Tasks

### 1. Email Tasks

#### `send_email_task`
Generic email sending task.

**Parameters:**
- `to_email` (str): Recipient email address
- `subject` (str): Email subject
- `html_content` (str): HTML email body
- `text_content` (str, optional): Plain text email body

**Usage:**
```python
from app.core.redis_client import arq_redis_pool

await arq_redis_pool.enqueue_job(
    "send_email_task",
    to_email="user@example.com",
    subject="Welcome",
    html_content="<h1>Welcome!</h1>",
    text_content="Welcome!"
)
```

#### `send_verification_email_task`
Sends email verification link to new users.

**Parameters:**
- `to_email` (str): User's email address
- `username` (str): User's username
- `verification_token` (str): Email verification token

**Triggered by:** User registration via `/api/v1/auth/register`

#### `send_password_reset_email_task`
Sends password reset link to users.

**Parameters:**
- `to_email` (str): User's email address
- `username` (str): User's username
- `reset_token` (str): Password reset token

**Triggered by:** Password reset request via `/api/v1/auth/forgot-password`

### 2. Cleanup Task

#### `cleanup_old_data_task`
Cleans up old audit logs and usage metrics to manage database size.

**Parameters:**
- `days_to_keep` (int, default=90): Number of days to retain data

**What it cleans:**
- Audit logs older than 90 days
- Detailed usage metrics older than 90 days

**Returns:**
```python
{
    "status": "success",
    "audit_logs_deleted": 1234,
    "metrics_deleted": 5678,
    "cutoff_date": "2024-07-15T00:00:00"
}
```

**Scheduling:**
Should run daily at 2 AM UTC. Uncomment in `app/worker/settings.py`:
```python
cron_jobs = [
    {
        "function": cleanup_old_data_task,
        "hour": 2,
        "minute": 0,
        "keep_result_forever": True,
    },
]
```

### 3. Analytics Report Task

#### `send_analytics_report_task`
Generates and emails comprehensive analytics report to admin users.

**Parameters:**
- `user_id` (int): Admin user ID to send report to
- `report_type` (str, default="weekly"): Type of report (daily/weekly/monthly)

**Requirements:**
- User must be admin (`is_superuser=True`)
- Valid email address

**Report includes:**
- API calls count
- Projects created
- States created
- Images uploaded
- Total projects
- Storage usage
- Average response time

**Scheduling:**
Should run weekly on Monday at 9 AM UTC. Uncomment in `app/worker/settings.py`:
```python
cron_jobs = [
    {
        "function": send_analytics_report_task,
        "kwargs": {"user_id": 1, "report_type": "weekly"},
        "weekday": 1,  # Monday
        "hour": 9,
        "minute": 0,
    },
]
```

**Manual trigger** (requires Redis):
```python
from app.core.redis_client import arq_redis_pool

# Send weekly report to admin (user_id=1)
await arq_redis_pool.enqueue_job(
    "send_analytics_report_task",
    user_id=1,
    report_type="weekly"
)
```

## Task Management

### Viewing Task Status

When Redis is deployed, you can check task status:

```python
from app.core.redis_client import arq_redis_pool

# Get job info
job = await arq_redis_pool.enqueue_job("send_email_task", ...)
result = await job.result(timeout=30)
```

### Error Handling

All tasks log errors and return error status:

```python
{
    "status": "error",
    "error": "Error message here",
    "user_id": 123  # context specific fields
}
```

### Monitoring

ARQ worker logs all task execution:
- **Success**: `INFO` level with execution details
- **Errors**: `ERROR` level with full traceback

View logs:
```bash
# On EB with docker-compose
eb ssh
docker logs $(docker ps -q --filter name=worker) --tail 100

# On local development
python run_worker.py
```

## Deployment Status

### Current Setup
- ✅ Tasks defined and implemented
- ✅ Worker configuration complete
- ❌ Redis not deployed yet
- ❌ Worker not running in production

### When to Deploy

Deploy Redis and worker when:
1. Traffic exceeds 100 requests/minute
2. Email sending feels slow to users
3. Need automated cleanup or reports
4. Ready to spend ~$15/month for ElastiCache

See [ADDING_REDIS_ELASTICACHE.md](./ADDING_REDIS_ELASTICACHE.md) for deployment instructions.

## Testing Tasks Locally

### 1. Install and Run Redis Locally

```bash
# Install Redis (Ubuntu/WSL)
sudo apt update
sudo apt install redis-server

# Start Redis
redis-server

# Verify
redis-cli ping  # Should return "PONG"
```

### 2. Run Worker

```bash
cd backend
python run_worker.py
```

### 3. Test Tasks

```python
import asyncio
from app.core.redis_client import get_arq_pool

async def test_email():
    pool = await get_arq_pool()

    job = await pool.enqueue_job(
        "send_email_task",
        to_email="test@example.com",
        subject="Test",
        html_content="<p>Test email</p>",
        text_content="Test email"
    )

    # Wait for result
    result = await job.result(timeout=30)
    print(result)

asyncio.run(test_email())
```

## Removed Tasks

### `process_image_task` (REMOVED)
Image processing (background removal) is now handled by the qontinui library and called directly via the `/api/v1/background-removal` endpoint. No background task needed since:

1. Background removal is fast (~100-500ms per image)
2. Frontend expects immediate response
3. Processing is done by qontinui library, not backend
4. Users upload images synchronously anyway

## Future Tasks

Potential tasks to add when needed:

1. **Batch image processing**: Process multiple images from S3
2. **Data export**: Generate large export files
3. **Scheduled reports**: More complex reporting needs
4. **Data aggregation**: Roll up metrics into summaries
5. **External API calls**: Call slow third-party APIs
6. **Backup tasks**: Database or file backups

## Additional Resources

- [ARQ Documentation](https://arq-docs.helpmanual.io/)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Background Job Patterns](https://docs.celeryproject.org/en/stable/userguide/tasks.html)
