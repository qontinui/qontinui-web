# Version History & Event Sourcing Integration Guide

This guide explains how to integrate version history and event sourcing into the project workflow.

## Overview

The version history system consists of two complementary approaches:

1. **Version Snapshots** (`ProjectVersion`) - Full state captures at specific points
2. **Event Sourcing** (`EditCommand`) - Granular change log of all edits

## Architecture

### Models

#### ProjectVersion
Stores complete project snapshots:
- `id` - UUID primary key
- `project_id` - Foreign key to projects
- `version_number` - Sequential version number per project
- `snapshot` - Full project state (JSON)
- `created_by` - User who created the version
- `created_at` - Timestamp
- `comment` - Optional description

#### EditCommand
Event sourcing log of all changes:
- `id` - UUID primary key
- `project_id` - Foreign key to projects
- `user_id` - User who made the change
- `command_type` - 'update', 'create', 'delete'
- `entity_type` - 'workflow', 'state', 'action', 'project', etc.
- `entity_id` - ID of entity being modified
- `payload` - Change details (JSON)
- `sequence_number` - Auto-incrementing per project
- `applied_at` - Timestamp

### Services

#### VersionHistoryService
Handles version snapshots:
- `create_version_snapshot()` - Save current state
- `get_version_history()` - List versions
- `get_version()` - Get specific version
- `restore_version()` - Rollback to previous version
- `compare_versions()` - Diff between versions

#### EventSourcingService
Handles event logging:
- `record_command()` - Log an edit command
- `get_command_history()` - Get command log
- `replay_commands()` - Rebuild state from events
- `get_entity_history()` - Get changes for specific entity

## Integration Patterns

### Pattern 1: Automatic Version Snapshots

Create snapshots on significant changes:

```python
from app.services.version_history_service import VersionHistoryService
from app.services.event_sourcing_service import EventSourcingService

# In your update endpoint
async def update_project_endpoint(
    db: AsyncSession,
    project_id: int,
    project_update: ProjectUpdate,
    current_user: User
):
    # Get current state for event logging
    old_project = await get_project(db, str(project_id))
    old_config = old_project.configuration.copy()

    # Perform the update
    updated_project = await update_project(db, old_project, project_update)

    # Record the change as an event
    if project_update.configuration is not None:
        await EventSourcingService.record_project_update(
            db=db,
            project_id=project_id,
            user_id=current_user.id,
            old_configuration=old_config,
            new_configuration=updated_project.configuration,
        )

    # Create version snapshot (on major changes)
    # You can add conditions here (e.g., every N edits, on demand, etc.)
    await VersionHistoryService.create_version_snapshot(
        db=db,
        project_id=project_id,
        user_id=current_user.id,
        comment="Auto-saved version",
    )

    return updated_project
```

### Pattern 2: Manual Version Snapshots

Let users create named versions:

```python
# User-triggered version creation
@router.post("/{project_id}/save-version")
async def save_project_version(
    project_id: int,
    comment: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    version = await VersionHistoryService.create_version_snapshot(
        db=db,
        project_id=project_id,
        user_id=current_user.id,
        comment=comment,  # User provides description
    )
    return {"version_number": version.version_number}
```

### Pattern 3: Granular Command Logging

Log individual entity changes:

```python
# When user updates a workflow
await EventSourcingService.record_command(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    command_type="update",
    entity_type="workflow",
    entity_id=workflow_id,
    payload={
        "field": "name",
        "old_value": "Old Workflow",
        "new_value": "New Workflow",
    }
)

# When user creates an action
await EventSourcingService.record_command(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    command_type="create",
    entity_type="action",
    entity_id=action_id,
    payload={
        "action_type": "click",
        "target": {"x": 100, "y": 200},
    }
)

# When user deletes a state
await EventSourcingService.record_command(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    command_type="delete",
    entity_type="state",
    entity_id=state_id,
    payload={
        "deleted_state": state_data,
    }
)
```

### Pattern 4: Version Retention

Configure how many versions to keep:

```python
# In VersionHistoryService
DEFAULT_VERSION_RETENTION = 10  # Keep last 10 versions

# Custom retention per project (could be added to Project model)
# For now, it's globally configured in the service
```

### Pattern 5: Combining Both Approaches

Use snapshots for easy restore, events for detailed audit:

```python
# Every project update:
# 1. Record granular edit command (for audit trail)
await EventSourcingService.record_command(...)

# 2. Create snapshot every N commands or on major milestones
if should_create_snapshot:
    await VersionHistoryService.create_version_snapshot(...)
```

## API Endpoints

### Version History

```
GET    /api/v1/projects/{project_id}/versions
       List all versions (lightweight, no snapshots)

GET    /api/v1/projects/{project_id}/versions/{version_number}
       Get specific version with full snapshot

POST   /api/v1/projects/{project_id}/versions/{version_number}/restore
       Restore project to this version

GET    /api/v1/projects/{project_id}/versions/{v1}/compare/{v2}
       Compare two versions (diff)
```

### Command History

```
GET    /api/v1/projects/{project_id}/commands
       Get command history (event log)
```

## Usage Examples

### Frontend: List Versions

```typescript
const response = await fetch(
  `/api/v1/projects/${projectId}/versions`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);
const versions = await response.json();

// Display in UI:
versions.forEach(v => {
  console.log(`Version ${v.version_number} - ${v.created_at} - ${v.comment}`);
});
```

### Frontend: Restore Version

```typescript
const response = await fetch(
  `/api/v1/projects/${projectId}/versions/${versionNumber}/restore`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comment: "Reverting to previous version"
    })
  }
);
const result = await response.json();
console.log(`Restored to version ${result.restored_from_version}`);
```

### Frontend: Compare Versions

```typescript
const response = await fetch(
  `/api/v1/projects/${projectId}/versions/${v1}/compare/${v2}`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);
const comparison = await response.json();

// Display diff:
console.log(comparison.summary);
console.log('Added:', comparison.changes.added);
console.log('Modified:', comparison.changes.modified);
console.log('Removed:', comparison.changes.removed);
```

### Frontend: View Command History

```typescript
const response = await fetch(
  `/api/v1/projects/${projectId}/commands?limit=50`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);
const history = await response.json();

// Display audit log:
history.commands.forEach(cmd => {
  console.log(
    `[${cmd.sequence_number}] ${cmd.command_type} ${cmd.entity_type} ` +
    `${cmd.entity_id} by ${cmd.user_id} at ${cmd.applied_at}`
  );
});
```

## Best Practices

### 1. Snapshot Frequency
- Create snapshots on **major changes** (e.g., workflow restructure)
- Create snapshots on **user request** (save button, named versions)
- Create snapshots on **time intervals** (optional: every hour if changed)
- **Don't** create snapshots on every single edit (too much data)

### 2. Command Logging
- Log **every** configuration change
- Include **enough context** in payload to understand the change
- Use consistent `entity_type` and `entity_id` naming

### 3. Version Retention
- Keep last 10 versions by default (configurable)
- Consider tier-based retention:
  - Free: 5 versions
  - Pro: 20 versions
  - Enterprise: 100 versions or unlimited

### 4. Performance
- Version listing returns lightweight data (no full snapshots)
- Full snapshots only loaded when specifically requested
- Use pagination for command history
- Consider archiving old versions to cold storage

### 5. User Experience
- Show version history in project settings
- Add "Restore" button next to each version
- Show diff/comparison when hovering over versions
- Display command log as activity feed

## Database Considerations

### Indexes
Already included in migration:
- `ix_project_versions_project_id` - Fast version lookup
- `ix_project_versions_project_created` - Composite for sorting
- `ix_edit_commands_project_id` - Fast command lookup
- `ix_edit_commands_applied_at` - Time-based queries

### Constraints
- `uq_project_version` - No duplicate version numbers per project
- `uq_project_command_seq` - No gaps in sequence numbers

### Cascading Deletes
- Deleting a project deletes all its versions and commands
- Deleting a user sets `created_by` and `user_id` to NULL (preserves history)

## Testing

### Test Version Creation
```python
# Create a version
version = await VersionHistoryService.create_version_snapshot(
    db, project_id=1, user_id=user_id, comment="Test version"
)
assert version.version_number == 1

# Create another
version2 = await VersionHistoryService.create_version_snapshot(
    db, project_id=1, user_id=user_id, comment="Second version"
)
assert version2.version_number == 2
```

### Test Version Restore
```python
# Update project
await update_project(db, project, ProjectUpdate(name="Updated"))

# Restore to version 1
restored_project, new_version = await VersionHistoryService.restore_version(
    db, project_id=1, version_number=1, user_id=user_id
)
assert restored_project.name == "Original Name"
assert new_version.version_number == 3  # New version created
```

### Test Command Logging
```python
# Record command
cmd = await EventSourcingService.record_command(
    db, project_id=1, user_id=user_id,
    command_type="update", entity_type="workflow", entity_id="wf1",
    payload={"field": "name", "value": "New Name"}
)
assert cmd.sequence_number == 1

# Record another
cmd2 = await EventSourcingService.record_command(
    db, project_id=1, user_id=user_id,
    command_type="create", entity_type="state", entity_id="s1",
    payload={"name": "State 1"}
)
assert cmd2.sequence_number == 2  # Auto-incremented
```

## Future Enhancements

1. **Undo/Redo** - Use command log for granular undo/redo
2. **Branching** - Create branches from specific versions
3. **Merging** - Merge changes from different branches
4. **Conflict Detection** - Detect concurrent edits
5. **Compression** - Compress old snapshots to save space
6. **Export** - Export version history as JSON/ZIP
7. **Diff Viewer** - Rich UI for viewing changes between versions

## Migration

To apply the database changes:

```bash
cd backend
alembic upgrade head
```

This will create:
- `project_versions` table
- `edit_commands` table
- All necessary indexes and constraints

## Troubleshooting

### Version Numbers Not Sequential
- Check for database constraints
- Ensure no concurrent inserts without proper locking

### Sequence Numbers Have Gaps
- This shouldn't happen due to `get_next_sequence_number()`
- If it does, check for transaction rollbacks

### Too Many Versions
- Adjust `DEFAULT_VERSION_RETENTION` in `VersionHistoryService`
- Run cleanup manually: `delete_old_versions(db, project_id, keep_count=10)`

### Performance Issues
- Add more indexes if needed
- Consider partitioning large tables by project_id
- Archive old data to separate table
