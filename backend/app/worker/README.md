# Background Task Queue (ARQ)

This directory contains the background task queue implementation using ARQ (Async Redis Queue).

## Overview

The task queue allows you to offload time-consuming operations (like sending emails, processing images, generating reports) to background workers, preventing them from blocking API requests.

## Architecture

```
app/worker/
├── __init__.py           # Package initialization
├── settings.py           # ARQ worker configuration
├── tasks.py              # Task function definitions
├── arq_pool.py           # Redis connection pool management
├── queue.py              # Convenient task enqueue wrappers
└── README.md             # This file
```

## Starting the Worker

```bash
# Start a single worker
python run_worker.py

# Start with arq CLI (alternative)
arq app.worker.settings.WorkerSettings
```

## Available Tasks

### 1. Email Sending
```python
from app.worker.queue import task_queue

# Enqueue an email
job_id = await task_queue.send_email(
    to_email="user@example.com",
    subject="Welcome!",
    html_content="<h1>Welcome to our platform</h1>",
    text_content="Welcome to our platform"
)
```

### 2. Image Processing
```python
# Process an image (e.g., background removal)
job_id = await task_queue.process_image(
    image_path="/path/to/image.png",
    operation="remove_background"
)
```

### 3. Analytics Reports
```python
# Generate and send analytics report
job_id = await task_queue.send_analytics_report(
    user_id=123,
    report_type="monthly"
)
```

## Adding New Tasks

1. Define the task function in `tasks.py`:
```python
async def my_new_task(ctx: dict[str, Any], arg1: str, arg2: int) -> dict[str, Any]:
    """My new background task."""
    try:
        # Do work here
        return {"status": "success", "result": "..."}
    except Exception as e:
        return {"status": "error", "error": str(e)}
```

2. Add it to `WorkerSettings.functions` in `settings.py`:
```python
from app.worker.tasks import my_new_task

functions = [
    # ... existing tasks ...
    my_new_task,
]
```

3. Add a convenience wrapper in `queue.py`:
```python
class TaskQueue:
    @staticmethod
    async def my_new_operation(arg1: str, arg2: int) -> str | None:
        return await enqueue_task("my_new_task", arg1=arg1, arg2=arg2)
```

## Monitoring

### Check Job Status
```python
from app.worker.arq_pool import get_job_result

result = await get_job_result(job_id)
```

### Health Check
The worker includes automatic health checks every 60 seconds (configurable in `settings.py`).

## Configuration

Edit `app/worker/settings.py` to configure:

- `max_jobs`: Maximum concurrent jobs (default: 10)
- `job_timeout`: Timeout per job in seconds (default: 300)
- `keep_result`: How long to keep job results in seconds (default: 3600)
- `health_check_interval`: Health check interval in seconds (default: 60)

## Scheduled Tasks (Cron Jobs)

Add scheduled tasks in `settings.py`:

```python
cron_jobs = [
    ("cleanup_old_data_task", cleanup_old_data_task, hour=2, minute=0),  # Daily at 2 AM
]
```

## Production Deployment

### Systemd Service (Linux)

Create `/etc/systemd/system/qontinui-worker.service`:

```ini
[Unit]
Description=Qontinui ARQ Worker
After=network.target redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/backend
Environment="PATH=/path/to/venv/bin"
ExecStart=/path/to/venv/bin/python run_worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable qontinui-worker
sudo systemctl start qontinui-worker
sudo systemctl status qontinui-worker
```

### Docker Compose

Add to `docker-compose.yml`:

```yaml
worker:
  build: .
  command: python run_worker.py
  depends_on:
    - redis
    - db
  environment:
    - REDIS_HOST=redis
    - DATABASE_URL=postgresql://...
```

### Multiple Workers

For high load, run multiple worker instances:

```bash
# Terminal 1
python run_worker.py

# Terminal 2
python run_worker.py

# Terminal 3
python run_worker.py
```

## Troubleshooting

### Worker not processing tasks
- Check Redis is running: `redis-cli ping`
- Check worker logs for errors
- Verify `REDIS_HOST` and `REDIS_PORT` in settings

### Tasks failing silently
- Check worker logs
- Verify task function doesn't raise unhandled exceptions
- Check job timeout settings

### Memory issues
- Reduce `max_jobs` in settings
- Add memory limits in systemd service
- Monitor with `htop` or similar

## Best Practices

1. **Keep tasks idempotent** - Tasks should be safe to retry
2. **Add timeouts** - Don't let tasks run forever
3. **Log everything** - Use structured logging
4. **Handle failures gracefully** - Return error status, don't crash
5. **Monitor queue length** - Alert if backlog grows
6. **Test tasks independently** - Write unit tests for task functions
