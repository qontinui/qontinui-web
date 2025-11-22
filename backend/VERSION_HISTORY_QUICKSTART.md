# Version History & Event Sourcing - Quick Start Guide

## Setup (One Time)

### 1. Apply Database Migration

```bash
cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend
alembic upgrade head
```

This creates:
- `project_versions` table
- `edit_commands` table
- All necessary indexes and constraints

### 2. Verify Installation

Check that the tables were created:

```bash
# Connect to your database and run:
\dt project_versions
\dt edit_commands
```

## Basic Usage

### Scenario 1: Manual Version Snapshots

When a user clicks "Save Version":

```python
from app.services.version_history_service import VersionHistoryService

# Create a version snapshot
version = await VersionHistoryService.create_version_snapshot(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    comment="User clicked save version"
)

print(f"Created version {version.version_number}")
```

### Scenario 2: Automatic Version Snapshots

In your project update endpoint:

```python
from app.services.version_history_service import VersionHistoryService
from app.services.event_sourcing_service import EventSourcingService

@router.put("/{project_id}")
async def update_project(
    project_id: int,
    project_update: ProjectUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    # ... existing permission checks ...

    # Get old state for comparison
    old_config = project.configuration.copy()

    # Update the project (existing code)
    updated_project = await update_project(db, project, project_update)

    # NEW: Record the change as an event
    if project_update.configuration is not None:
        await EventSourcingService.record_project_update(
            db=db,
            project_id=project_id,
            user_id=current_user.id,
            old_configuration=old_config,
            new_configuration=updated_project.configuration,
        )

    # NEW: Create version snapshot (optional: add conditions)
    await VersionHistoryService.create_version_snapshot(
        db=db,
        project_id=project_id,
        user_id=current_user.id,
        comment="Auto-saved",
    )

    return updated_project
```

### Scenario 3: Log Individual Changes

When user edits a specific entity:

```python
from app.services.event_sourcing_service import EventSourcingService

# User renames a workflow
await EventSourcingService.record_command(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    command_type="update",
    entity_type="workflow",
    entity_id="workflow-123",
    payload={
        "field": "name",
        "old_value": "Old Workflow Name",
        "new_value": "New Workflow Name",
    }
)

# User creates a new action
await EventSourcingService.record_command(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    command_type="create",
    entity_type="action",
    entity_id="action-456",
    payload={
        "action_type": "click",
        "target": {"x": 100, "y": 200},
        "description": "Click login button",
    }
)

# User deletes a state
await EventSourcingService.record_command(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    command_type="delete",
    entity_type="state",
    entity_id="state-789",
    payload={
        "deleted_state_name": "Login Screen",
    }
)
```

## Frontend Integration

### Display Version History

```typescript
// Fetch versions
const response = await fetch(
  `/api/v1/projects/${projectId}/versions`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);
const versions = await response.json();

// Display in UI
{versions.map(v => (
  <div key={v.id}>
    <h3>Version {v.version_number}</h3>
    <p>{v.comment}</p>
    <small>{new Date(v.created_at).toLocaleString()}</small>
    <button onClick={() => restoreVersion(v.version_number)}>
      Restore
    </button>
  </div>
))}
```

### Restore a Version

```typescript
async function restoreVersion(versionNumber: number) {
  const response = await fetch(
    `/api/v1/projects/${projectId}/versions/${versionNumber}/restore`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: `Restored to version ${versionNumber}`
      })
    }
  );

  if (response.ok) {
    const result = await response.json();
    alert(`Restored to version ${result.restored_from_version}`);
    // Reload project
    loadProject();
  }
}
```

### Compare Versions

```typescript
async function compareVersions(v1: number, v2: number) {
  const response = await fetch(
    `/api/v1/projects/${projectId}/versions/${v1}/compare/${v2}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  const comparison = await response.json();

  // Display diff
  console.log('Summary:', comparison.summary);
  console.log('Added:', comparison.changes.added);
  console.log('Modified:', comparison.changes.modified);
  console.log('Removed:', comparison.changes.removed);
}
```

### View Activity Log

```typescript
// Fetch command history
const response = await fetch(
  `/api/v1/projects/${projectId}/commands?limit=50`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);
const history = await response.json();

// Display as activity feed
{history.commands.map(cmd => (
  <div key={cmd.id}>
    <span>{cmd.command_type}</span>
    <span>{cmd.entity_type}</span>
    <span>{cmd.entity_id}</span>
    <small>{new Date(cmd.applied_at).toLocaleString()}</small>
  </div>
))}
```

## API Endpoints Reference

```
GET    /api/v1/projects/{id}/versions
       List all versions (lightweight)
       Query params: skip, limit
       Returns: List of version metadata (no snapshots)

GET    /api/v1/projects/{id}/versions/{version}
       Get specific version with full snapshot
       Returns: Complete version data including snapshot

POST   /api/v1/projects/{id}/versions/{version}/restore
       Restore project to this version
       Body: { "comment": "Optional comment" }
       Returns: { success, new_version_number, restored_from_version, message }

GET    /api/v1/projects/{id}/versions/{v1}/compare/{v2}
       Compare two versions
       Returns: { changes: { added, modified, removed }, summary }

GET    /api/v1/projects/{id}/commands
       Get command history
       Query params: skip, limit
       Returns: { commands, total_count, project_id }
```

## Configuration

### Adjust Version Retention

Edit `/app/services/version_history_service.py`:

```python
class VersionHistoryService:
    DEFAULT_VERSION_RETENTION = 20  # Keep last 20 versions
```

### Conditional Snapshot Creation

Only create snapshots on significant changes:

```python
def is_significant_change(old_config, new_config):
    # Define what counts as "significant"
    # e.g., workflow structure changed, not just labels
    return old_config.get('workflows') != new_config.get('workflows')

# In update endpoint:
if is_significant_change(old_config, project.configuration):
    await VersionHistoryService.create_version_snapshot(...)
```

### Per-Tier Retention

```python
def get_retention_count(subscription_tier: str) -> int:
    return {
        "free": 5,
        "pro": 20,
        "enterprise": 100,
    }.get(subscription_tier, 10)

# Use in create_version_snapshot:
retention = get_retention_count(current_user.subscription_tier)
await delete_old_versions(db, project_id, keep_count=retention)
```

## Testing

### Test Version Creation

```python
import pytest
from app.services.version_history_service import VersionHistoryService

@pytest.mark.asyncio
async def test_create_version(db, project, user):
    version = await VersionHistoryService.create_version_snapshot(
        db=db,
        project_id=project.id,
        user_id=user.id,
        comment="Test version"
    )
    assert version.version_number == 1
    assert version.comment == "Test version"
```

### Test Version Restore

```python
@pytest.mark.asyncio
async def test_restore_version(db, project, user):
    # Create initial version
    v1 = await VersionHistoryService.create_version_snapshot(
        db, project.id, user.id, "Initial"
    )

    # Update project
    project.name = "Updated Name"
    await db.commit()

    # Create second version
    v2 = await VersionHistoryService.create_version_snapshot(
        db, project.id, user.id, "After update"
    )

    # Restore to v1
    restored, new_v = await VersionHistoryService.restore_version(
        db, project.id, v1.version_number, user.id
    )

    assert restored.name == v1.snapshot['name']
    assert new_v.version_number == 3  # New version created
```

### Test Command Logging

```python
@pytest.mark.asyncio
async def test_command_sequence(db, project, user):
    # Record first command
    cmd1 = await EventSourcingService.record_command(
        db, project.id, user.id,
        "update", "workflow", "wf1",
        {"field": "name", "value": "New Name"}
    )

    # Record second command
    cmd2 = await EventSourcingService.record_command(
        db, project.id, user.id,
        "create", "action", "a1",
        {"type": "click"}
    )

    assert cmd1.sequence_number == 1
    assert cmd2.sequence_number == 2
```

## Common Patterns

### Pattern: Version on Save Button

```python
@router.post("/{project_id}/save")
async def save_project_version(
    project_id: int,
    comment: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    version = await VersionHistoryService.create_version_snapshot(
        db, project_id, current_user.id, comment
    )
    return {"version_number": version.version_number}
```

### Pattern: Auto-save Every N Minutes

```python
from datetime import datetime, timedelta

# In background task or periodic job
async def auto_save_versions():
    # Get projects modified in last 5 minutes
    recent_projects = await get_recently_modified_projects(db)

    for project in recent_projects:
        # Create snapshot if not already saved recently
        latest = await get_latest_version(db, project.id)
        if not latest or latest.created_at < datetime.utcnow() - timedelta(minutes=5):
            await VersionHistoryService.create_version_snapshot(
                db, project.id, None, "Auto-save"
            )
```

### Pattern: Named Versions (Tags)

```python
# Add to version creation
version = await VersionHistoryService.create_version_snapshot(
    db, project_id, user_id,
    comment="Production Release v1.0"  # User can name it
)
```

## Troubleshooting

### Issue: Migration Fails

```bash
# Check current revision
alembic current

# Check migration history
alembic history

# If needed, downgrade and re-upgrade
alembic downgrade -1
alembic upgrade head
```

### Issue: Version Numbers Not Sequential

This shouldn't happen due to constraints. If it does:
1. Check for database connection issues
2. Check for transaction rollbacks
3. Verify unique constraint exists

### Issue: Too Many Versions

```python
# Manually clean up old versions
from app.crud.version import delete_old_versions

deleted = await delete_old_versions(db, project_id, keep_count=10)
print(f"Deleted {deleted} old versions")
```

## Next Steps

1. **Add to Project Update Flow**: Integrate into existing update endpoint
2. **Create UI Components**: Build version history viewer in frontend
3. **Add Notifications**: Alert users when versions are created/restored
4. **Implement Scheduled Snapshots**: Auto-save every N minutes
5. **Add Version Tags**: Let users tag important versions
6. **Build Diff Viewer**: Visual comparison of versions

## Documentation

- **Full Integration Guide**: `VERSION_HISTORY_INTEGRATION.md`
- **Implementation Summary**: `VERSION_HISTORY_IMPLEMENTATION_SUMMARY.md`
- **API Docs**: http://localhost:8000/docs (when backend is running)

## Support

For questions or issues:
- Check the main integration guide
- Review implementation summary
- Examine service code: `app/services/version_history_service.py`
- Check API endpoints: `app/api/v1/endpoints/versions.py`
