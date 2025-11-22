# Version History & Event Sourcing Implementation Summary

## Overview

This implementation adds comprehensive version history and event sourcing capabilities to the Qontinui project management system. It provides two complementary approaches for tracking changes:

1. **Version Snapshots** - Full state captures for easy restoration
2. **Event Sourcing** - Granular change log for detailed audit trails

## Files Created/Modified

### Models (New)
- `/app/models/project_version.py` - ProjectVersion model for snapshots
- `/app/models/edit_command.py` - EditCommand model for event sourcing

### Models (Modified)
- `/app/models/project.py` - Added relationships to versions and edit_commands
- `/app/models/user.py` - Added relationships to project_versions and edit_commands
- `/app/models/__init__.py` - Export new models

### Schemas (New)
- `/app/schemas/version.py` - All version history and command schemas:
  - ProjectVersionBase, ProjectVersionCreate, ProjectVersionResponse
  - ProjectVersionListItem (lightweight)
  - VersionComparisonResponse (for diffs)
  - EditCommandBase, EditCommandCreate, EditCommandResponse
  - EditCommandHistoryResponse
  - VersionRestoreRequest, VersionRestoreResponse

### CRUD (New)
- `/app/crud/version.py` - Complete CRUD operations:
  - Version: get_version, get_version_by_number, get_versions_by_project,
    get_latest_version, get_version_count, create_version, delete_old_versions
  - Commands: get_command, get_commands_by_project, get_command_count,
    get_next_sequence_number, create_command

### Services (New)
- `/app/services/version_history_service.py` - VersionHistoryService:
  - create_version_snapshot() - Save full project state
  - get_version_history() - List all versions
  - get_version() - Get specific version snapshot
  - restore_version() - Rollback to previous version
  - compare_versions() - Diff between two versions
  - _compute_diff() - Internal diff algorithm
  - _generate_summary() - Human-readable change summary

- `/app/services/event_sourcing_service.py` - EventSourcingService:
  - record_command() - Store edit command with auto-sequence
  - get_command_history() - Get command log
  - replay_commands() - Rebuild state from commands
  - get_entity_history() - Track specific entity changes
  - record_project_update() - Convenience method for project updates

### API Endpoints (New)
- `/app/api/v1/endpoints/versions.py` - Complete REST API:
  - GET `/api/v1/projects/{id}/versions` - List versions
  - GET `/api/v1/projects/{id}/versions/{version}` - Get version
  - POST `/api/v1/projects/{id}/versions/{version}/restore` - Restore version
  - GET `/api/v1/projects/{id}/versions/{v1}/compare/{v2}` - Compare versions
  - GET `/api/v1/projects/{id}/commands` - Get command history

### API Router (Modified)
- `/app/api/v1/api.py` - Registered versions router with prefix `/projects`

### Migrations (New)
- `/alembic/versions/20251120_add_version_history_tables.py` - Database migration:
  - Creates `project_versions` table
  - Creates `edit_commands` table
  - Creates unique constraints
  - Creates composite indexes
  - Full upgrade/downgrade support

### Documentation (New)
- `/VERSION_HISTORY_INTEGRATION.md` - Comprehensive integration guide
- `/VERSION_HISTORY_IMPLEMENTATION_SUMMARY.md` - This file

## Database Schema

### project_versions Table
```sql
CREATE TABLE project_versions (
    id UUID PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    snapshot JSON NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL,
    comment TEXT,
    CONSTRAINT uq_project_version UNIQUE (project_id, version_number)
);

CREATE INDEX ix_project_versions_project_id ON project_versions(project_id);
CREATE INDEX ix_project_versions_project_created ON project_versions(project_id, created_at);
```

### edit_commands Table
```sql
CREATE TABLE edit_commands (
    id UUID PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    command_type VARCHAR NOT NULL,
    entity_type VARCHAR NOT NULL,
    entity_id VARCHAR NOT NULL,
    payload JSON NOT NULL,
    sequence_number INTEGER NOT NULL,
    applied_at TIMESTAMP NOT NULL,
    CONSTRAINT uq_project_command_seq UNIQUE (project_id, sequence_number)
);

CREATE INDEX ix_edit_commands_project_id ON edit_commands(project_id);
CREATE INDEX ix_edit_commands_applied_at ON edit_commands(applied_at);
```

## Key Features

### 1. Version Snapshots
- **Full State Storage**: Each version stores complete project state (no diffs)
- **Easy Restoration**: Single query to restore any previous version
- **Automatic Retention**: Keeps last N versions (default 10, configurable)
- **User Comments**: Optional descriptions for each version
- **Diff Support**: Compare any two versions to see changes

### 2. Event Sourcing
- **Granular Logging**: Every edit recorded as an event
- **Sequential Ordering**: Auto-incrementing sequence numbers prevent gaps
- **Audit Trail**: Complete history of who changed what and when
- **Entity Tracking**: Filter history by specific entities
- **Replay Support**: Can rebuild state from events (future enhancement)

### 3. Permission Integration
- **Full Permission Checks**: All endpoints respect project access controls
- **VIEW Permission**: Required for viewing versions/history
- **EDIT Permission**: Required for restoring versions
- **User Attribution**: Tracks which user made each change

### 4. Performance Optimizations
- **Lightweight Listing**: Version list excludes full snapshots
- **Indexed Queries**: Composite indexes for fast filtering/sorting
- **Pagination Support**: Skip/limit for large histories
- **Lazy Loading**: Full snapshots only loaded when needed

## API Usage Examples

### Create Version Snapshot
```python
version = await VersionHistoryService.create_version_snapshot(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    comment="Saved before major refactor"
)
```

### List Versions
```bash
GET /api/v1/projects/123/versions?skip=0&limit=20
```

Response:
```json
[
  {
    "id": "uuid",
    "project_id": 123,
    "version_number": 5,
    "created_by": "user-uuid",
    "created_at": "2025-11-20T10:00:00Z",
    "comment": "Saved before major refactor"
  }
]
```

### Restore Version
```bash
POST /api/v1/projects/123/versions/3/restore
Content-Type: application/json

{
  "comment": "Reverting to stable version"
}
```

Response:
```json
{
  "success": true,
  "new_version_number": 6,
  "restored_from_version": 3,
  "message": "Successfully restored project to version 3"
}
```

### Compare Versions
```bash
GET /api/v1/projects/123/versions/3/compare/5
```

Response:
```json
{
  "version_from": 3,
  "version_to": 5,
  "created_at_from": "2025-11-20T09:00:00Z",
  "created_at_to": "2025-11-20T10:00:00Z",
  "changes": {
    "added": {"new_field": "value"},
    "removed": {"old_field": "value"},
    "modified": {
      "name": {"from": "Old Name", "to": "New Name"}
    }
  },
  "summary": "1 field(s) added, 1 field(s) removed, 1 field(s) modified"
}
```

### Record Edit Command
```python
command = await EventSourcingService.record_command(
    db=db,
    project_id=project_id,
    user_id=current_user.id,
    command_type="update",
    entity_type="workflow",
    entity_id="workflow-123",
    payload={
        "field": "name",
        "old_value": "Old Workflow",
        "new_value": "New Workflow"
    }
)
```

### View Command History
```bash
GET /api/v1/projects/123/commands?skip=0&limit=50
```

Response:
```json
{
  "commands": [
    {
      "id": "uuid",
      "project_id": 123,
      "user_id": "user-uuid",
      "command_type": "update",
      "entity_type": "workflow",
      "entity_id": "workflow-123",
      "payload": {"field": "name", "old_value": "Old", "new_value": "New"},
      "sequence_number": 42,
      "applied_at": "2025-11-20T10:30:00Z"
    }
  ],
  "total_count": 100,
  "project_id": 123
}
```

## Integration Points

### Automatic Version Creation
To automatically create versions on project updates, modify the update endpoint:

```python
# In /app/api/v1/endpoints/projects.py
@router.put("/{project_id}")
async def update_existing_project(
    project_id: int,
    project_update: ProjectUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    # ... permission checks ...

    # Get old state
    old_config = project.configuration.copy()

    # Update project
    project = await update_project(db, project, project_update)

    # Record command (always)
    if project_update.configuration is not None:
        await EventSourcingService.record_project_update(
            db, project_id, current_user.id,
            old_config, project.configuration
        )

    # Create version snapshot (conditionally)
    # Option 1: Every update
    await VersionHistoryService.create_version_snapshot(
        db, project_id, current_user.id, "Auto-save"
    )

    # Option 2: Only on significant changes
    if is_significant_change(old_config, project.configuration):
        await VersionHistoryService.create_version_snapshot(
            db, project_id, current_user.id, "Auto-save"
        )

    return project
```

### Manual Version Creation
Add endpoint for user-triggered version saves:

```python
@router.post("/{project_id}/save-version")
async def save_version(
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

## Configuration

### Version Retention
Modify in `/app/services/version_history_service.py`:

```python
class VersionHistoryService:
    DEFAULT_VERSION_RETENTION = 10  # Change this value
```

To implement tier-based retention:

```python
def get_retention_count(subscription_tier: str) -> int:
    retention = {
        "free": 5,
        "pro": 20,
        "enterprise": 100,
    }
    return retention.get(subscription_tier, 10)
```

## Testing

### Running Migrations
```bash
cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend
alembic upgrade head
```

### Testing Endpoints
```bash
# Start backend
python run.py

# Test version listing
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/projects/1/versions

# Test version restore
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment":"Restore test"}' \
  http://localhost:8000/api/v1/projects/1/versions/1/restore

# Test command history
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/projects/1/commands
```

### Unit Tests
```python
# Test version creation
async def test_create_version():
    version = await VersionHistoryService.create_version_snapshot(
        db, project_id=1, user_id=user_id, comment="Test"
    )
    assert version.version_number == 1

# Test version restore
async def test_restore_version():
    # Create initial version
    v1 = await VersionHistoryService.create_version_snapshot(
        db, project_id=1, user_id=user_id
    )

    # Update project
    await update_project(db, project, ProjectUpdate(name="Updated"))

    # Restore
    restored, new_v = await VersionHistoryService.restore_version(
        db, project_id=1, version_number=1, user_id=user_id
    )
    assert restored.name == original_name

# Test command sequence
async def test_command_sequence():
    cmd1 = await EventSourcingService.record_command(...)
    cmd2 = await EventSourcingService.record_command(...)
    assert cmd1.sequence_number == 1
    assert cmd2.sequence_number == 2
```

## Performance Considerations

1. **Snapshot Size**: JSON snapshots can be large. Consider:
   - Compression for old versions
   - Archiving to S3 after N days
   - Configurable retention per tier

2. **Query Performance**: Indexed properly, but consider:
   - Pagination for large histories
   - Caching frequent queries
   - Materialized views for analytics

3. **Storage Growth**: Monitor disk usage:
   - Average snapshot size: ~10-100KB
   - 100 projects × 10 versions = ~10MB
   - Scale accordingly

## Security

- ✅ **Permission Checks**: All endpoints verify project access
- ✅ **User Attribution**: Tracks who made changes
- ✅ **Cascade Deletes**: Properly handled with foreign keys
- ✅ **SQL Injection**: Protected by SQLAlchemy ORM
- ✅ **Access Control**: Respects organization membership

## Future Enhancements

1. **Branching & Merging**: Create branches from versions
2. **Granular Undo/Redo**: Use command log for undo/redo
3. **Conflict Resolution**: Detect concurrent edits
4. **Visual Diff Viewer**: Rich UI for viewing changes
5. **Export/Import**: Export version history as JSON/ZIP
6. **Compression**: Compress old snapshots to save space
7. **Notifications**: Alert users when versions are created/restored
8. **Scheduled Snapshots**: Auto-create versions on schedule
9. **Version Tags**: Tag specific versions (e.g., "Production")
10. **Rollback Limits**: Restrict rollback to N versions back

## Migration Details

The migration `20251120_add_version_history_tables.py` includes:

- **Creates Tables**: project_versions, edit_commands
- **Creates Constraints**: Unique constraints on version numbers and sequence numbers
- **Creates Indexes**: Composite indexes for performance
- **Handles Cascades**: Foreign keys with proper ON DELETE behavior
- **Fully Reversible**: Complete downgrade() implementation

## Support & Troubleshooting

### Common Issues

**Q: Version numbers are not sequential**
A: Check database constraints. Ensure no race conditions in version creation.

**Q: Sequence numbers have gaps**
A: This shouldn't happen due to auto-increment logic. Check for transaction rollbacks.

**Q: Too many versions consuming storage**
A: Adjust DEFAULT_VERSION_RETENTION or implement cleanup job.

**Q: Slow version listing**
A: Ensure indexes exist. Use pagination. Consider caching.

### Contact

For questions or issues, contact the development team or refer to:
- Main documentation: `/VERSION_HISTORY_INTEGRATION.md`
- API documentation: Auto-generated at `/docs` endpoint
- Source code: `/app/services/version_history_service.py`

## Summary

This implementation provides a production-ready version history and event sourcing system with:
- ✅ Full state snapshots for easy restoration
- ✅ Granular event logging for audit trails
- ✅ Complete REST API with permission checks
- ✅ Performance optimizations (indexes, pagination)
- ✅ Automatic version retention
- ✅ Diff/comparison capabilities
- ✅ Database migrations
- ✅ Comprehensive documentation

The system is ready for integration into the project update workflow and can be extended with additional features as needed.
