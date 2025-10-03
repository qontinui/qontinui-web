# Usage Metrics & Audit Logging Integration Guide

This guide shows how to use the newly implemented usage metrics and audit logging system in the Qontinui-Web backend.

## Overview

The system consists of:
1. **Usage Metrics** - Track API calls, events, and user activity automatically
2. **Audit Logging** - Log important security and business events
3. **Analytics Endpoints** - Query usage metrics and analytics data

## Database Models

### UsageMetric (`app/models/usage_metric.py`)
Tracks quantitative metrics about user activity:
- `user_id`: User performing the action
- `metric_type`: Type of metric (api_call, project_created, state_created, image_uploaded)
- `value`: Numeric value of the metric
- `timestamp`: When the metric was recorded
- `metric_metadata`: JSON metadata (endpoint, method, response_time, status_code, etc.)

### AuditLog (`app/models/audit_log.py`)
Logs important user actions for security and compliance:
- `user_id`: User performing the action
- `action`: Action type (login, project_created, project_deleted, settings_changed)
- `resource_type`: Type of resource affected (project, user, state)
- `resource_id`: ID of the affected resource
- `ip_address`: IP address of the user
- `log_metadata`: JSON metadata with additional context
- `created_at`: When the log was created

### StorageUsage (`app/models/storage_usage.py`)
Tracks file storage per user:
- `user_id`: Owner of the file
- `file_type`: Type of file (image, json, etc.)
- `file_size`: Size in bytes
- `file_path`: Path to the file
- `project_id`: Associated project (optional)

## Automatic API Call Tracking

The `MetricsMiddleware` automatically tracks all API calls for authenticated users:
- Endpoint path
- HTTP method
- Response time
- Status code
- Query parameters
- User agent

**No code changes needed** - this is already integrated in `app/main.py`.

### Excluded Endpoints
The following endpoints are excluded from automatic tracking:
- `/health`
- `/docs`
- `/redoc`
- `/openapi.json`
- `/` (root)

## Manual Event Tracking

### Tracking Custom Events

Use `metrics_service` to track custom events like project creation, state creation, or image uploads:

```python
from app.services.metrics_service import metrics_service

# Track project creation
metrics_service.track_event(
    db=db,
    user_id=current_user.id,
    event_type="project_created",
    value=1,
    metadata={"project_id": project.id, "project_name": project.name}
)

# Track state creation
metrics_service.track_event(
    db=db,
    user_id=current_user.id,
    event_type="state_created",
    value=1,
    metadata={"project_id": project.id, "state_name": state.name}
)

# Track image upload
metrics_service.track_event(
    db=db,
    user_id=current_user.id,
    event_type="image_uploaded",
    value=file_size,  # Size in bytes
    metadata={"file_name": filename, "file_type": content_type}
)
```

### Example: Enhanced Project Creation Endpoint

Here's how to add metrics and audit logging to the project creation endpoint:

```python
from fastapi import APIRouter, Depends, Request
from app.services.metrics_service import metrics_service
from app.services.audit_service import audit_service

@router.post("/", response_model=Project)
def create_new_project(
    *,
    request: Request,  # Add request to get IP address
    db: Session = Depends(get_db),
    project_in: ProjectCreate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    # Create the project
    project = create_project(db, project_in, owner_id=current_user.id)

    # Track the event in metrics
    metrics_service.track_event(
        db=db,
        user_id=current_user.id,
        event_type="project_created",
        value=1,
        metadata={
            "project_id": project.id,
            "project_name": project.name
        }
    )

    # Log to audit log
    audit_service.log_project_created(
        db=db,
        user_id=current_user.id,
        project_id=project.id,
        project_name=project.name,
        ip_address=request.client.host
    )

    return project
```

### Example: Enhanced Project Deletion Endpoint

```python
@router.delete("/{project_id}")
def delete_existing_project(
    *,
    request: Request,
    db: Session = Depends(get_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    project = get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )

    # Save project name before deletion
    project_name = project.name

    # Delete the project
    success = delete_project(db, project_id=project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete project",
        )

    # Track deletion event
    metrics_service.track_event(
        db=db,
        user_id=current_user.id,
        event_type="project_deleted",
        value=1,
        metadata={"project_id": project_id, "project_name": project_name}
    )

    # Log to audit log
    audit_service.log_project_deleted(
        db=db,
        user_id=current_user.id,
        project_id=project_id,
        project_name=project_name,
        ip_address=request.client.host
    )

    return {"message": "Project deleted successfully"}
```

## Audit Logging

### Built-in Audit Methods

The `audit_service` provides convenient methods for common actions:

```python
from app.services.audit_service import audit_service

# Login
audit_service.log_login(db, user_id, ip_address)

# Logout
audit_service.log_logout(db, user_id, ip_address)

# Project created
audit_service.log_project_created(db, user_id, project_id, project_name, ip_address)

# Project deleted
audit_service.log_project_deleted(db, user_id, project_id, project_name, ip_address)

# Settings changed
audit_service.log_settings_changed(db, user_id, ["email", "full_name"], ip_address)

# Password changed
audit_service.log_password_changed(db, user_id, ip_address)
```

### Custom Audit Logs

For custom actions, use the generic `log_action` method:

```python
audit_service.log_action(
    db=db,
    user_id=current_user.id,
    action="state_exported",
    resource_type="state",
    resource_id=state.id,
    metadata={"format": "json", "include_images": True},
    ip_address=request.client.host
)
```

## Analytics Endpoints

### GET /api/v1/analytics/usage

Get current user's usage summary:

**Response:**
```json
{
  "api_calls_today": 145,
  "projects_count": 5,
  "storage_used": 12345678,
  "last_active": "2025-10-01T20:00:00Z"
}
```

### GET /api/v1/analytics/metrics

Get detailed metrics with filtering:

**Query Parameters:**
- `metric_type` (optional): Filter by type (api_call, project_created, etc.)
- `days` (default: 7): Number of days to look back

**Response:**
```json
{
  "metrics": [
    {
      "id": 123,
      "metric_type": "project_created",
      "value": 1.0,
      "timestamp": "2025-10-01T20:00:00Z",
      "metadata": {
        "project_id": 42,
        "project_name": "My Project"
      }
    }
  ],
  "count": 50
}
```

### GET /api/v1/analytics/summary

Get comprehensive analytics summary:

**Query Parameters:**
- `days` (default: 30): Number of days to look back

**Response:**
```json
{
  "period_days": 30,
  "period_start": "2025-09-01T00:00:00Z",
  "period_end": "2025-10-01T20:00:00Z",
  "api_calls": 1245,
  "projects_created": 8,
  "states_created": 45,
  "images_uploaded": 120,
  "total_projects": 12,
  "total_storage_bytes": 45678901,
  "avg_response_time_seconds": 0.234,
  "last_active": "2025-10-01T20:00:00Z"
}
```

## Batching and Performance

### Automatic Batching

The `metrics_service` uses batching to optimize database writes:
- **Batch Size**: 10 metrics
- **Flush Interval**: 30 seconds
- **Auto-flush**: On shutdown

Metrics are buffered in memory and flushed when either:
1. The batch reaches 10 items, or
2. 30 seconds have passed since the last flush

### Manual Flush

To force flush pending metrics (e.g., before shutdown):

```python
from app.services.metrics_service import metrics_service

metrics_service.force_flush(db)
```

This is already integrated in the shutdown event handler in `app/main.py`.

## Querying Metrics Programmatically

### Get User Metrics

```python
from datetime import datetime, timedelta
from app.services.metrics_service import metrics_service

# Get all metrics for a user
metrics = metrics_service.get_user_metrics(
    db=db,
    user_id=user_id,
    start_date=datetime.utcnow() - timedelta(days=7),
    end_date=datetime.utcnow(),
    metric_type="api_call"  # Optional filter
)

# Get API calls count
api_calls = metrics_service.get_api_calls_count(
    db=db,
    user_id=user_id,
    start_date=datetime.utcnow() - timedelta(days=1)
)

# Get event count
projects_created = metrics_service.get_event_count(
    db=db,
    user_id=user_id,
    event_type="project_created",
    start_date=datetime.utcnow() - timedelta(days=30)
)

# Get average response time
avg_response = metrics_service.get_average_response_time(
    db=db,
    user_id=user_id,
    endpoint="/api/v1/projects"  # Optional filter
)

# Get last activity
last_active = metrics_service.get_last_activity(db=db, user_id=user_id)
```

### Get Audit Logs

```python
from app.services.audit_service import audit_service

# Get user's audit logs
logs = audit_service.get_user_audit_logs(
    db=db,
    user_id=user_id,
    action="login",  # Optional filter
    limit=100
)

# Get audit logs for a specific resource
project_logs = audit_service.get_resource_audit_logs(
    db=db,
    resource_type="project",
    resource_id=project_id,
    limit=50
)
```

## Sample Metrics Being Tracked

### Automatic Tracking (via Middleware)
- **api_call**: Every API endpoint hit (excluding health checks)
  - Metadata: endpoint, method, response_time, status_code, query_params, user_agent

### Manual Tracking (to be integrated)
- **project_created**: When a project is created
  - Metadata: project_id, project_name
- **project_deleted**: When a project is deleted
  - Metadata: project_id, project_name
- **state_created**: When a state is created
  - Metadata: project_id, state_name
- **image_uploaded**: When an image is uploaded
  - Value: file size in bytes
  - Metadata: file_name, file_type

### Audit Logs (to be integrated)
- **login**: User login
- **logout**: User logout
- **project_created**: Project creation
- **project_deleted**: Project deletion
- **settings_changed**: User settings modification
- **password_changed**: Password change

## Database Migration

The database tables are already created by the migration:
- `alembic/versions/8720b6a82cc1_add_phase1_analytics_features.py`

To apply the migration (if not already applied):

```bash
cd backend
alembic upgrade head
```

## Next Steps for Integration

1. **Add event tracking to project endpoints** (`app/api/v1/endpoints/projects.py`)
   - Track project_created in POST endpoint
   - Track project_deleted in DELETE endpoint

2. **Add event tracking to state management**
   - Track state_created when states are added
   - Track state_deleted when states are removed

3. **Add event tracking to image uploads**
   - Track image_uploaded with file size as value

4. **Add audit logging to auth endpoints** (`app/api/v1/endpoints/auth.py`)
   - Log login events
   - Log logout events
   - Log password changes

5. **Add audit logging to user management** (`app/api/v1/endpoints/users.py`)
   - Log settings changes
   - Log profile updates

## Storage Usage Tracking

To track storage when uploading files:

```python
from app.models.storage_usage import StorageUsage

# After saving a file
storage_entry = StorageUsage(
    user_id=current_user.id,
    file_type=content_type,
    file_size=file_size,
    file_path=file_path,
    project_id=project_id  # Optional
)
db.add(storage_entry)
db.commit()

# Also track the upload as a metric
metrics_service.track_event(
    db=db,
    user_id=current_user.id,
    event_type="image_uploaded",
    value=file_size,
    metadata={"file_name": filename, "file_type": content_type}
)
```

## Testing the Implementation

1. Start the backend server
2. Make authenticated API calls
3. Check metrics: `GET /api/v1/analytics/usage`
4. View detailed metrics: `GET /api/v1/analytics/metrics?days=7`
5. View summary: `GET /api/v1/analytics/summary?days=30`

The middleware will automatically track all API calls, and you can verify the data is being collected through the analytics endpoints.
