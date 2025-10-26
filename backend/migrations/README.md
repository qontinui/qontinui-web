# Database Migrations

This directory contains database migration scripts for the qontinui-web backend.

## Running Migrations

### Prerequisites

1. Ensure your virtual environment is activated:
   ```bash
   cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend
   source venv/bin/activate
   ```

2. Set your DATABASE_URL environment variable:
   ```bash
   # Load from .env file (recommended)
   export DATABASE_URL=$(grep DATABASE_URL .env | cut -d '=' -f2-)

   # Or set manually
   export DATABASE_URL='postgresql://user:password@localhost/dbname'
   ```

## Available Migrations

### 001: Transition Workflow Reference Migration

**File:** `001_transition_workflow_ref_migration.py`

**Purpose:** Converts transition workflows from string arrays to WorkflowReference objects.

**Changes:**
- **Before:** `workflows: ["workflow-123", "workflow-456"]`
- **After:** `workflows: [{ type: "reference", workflowId: "workflow-123" }, { type: "reference", workflowId: "workflow-456" }]`

**Run:**
```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend
python migrations/001_transition_workflow_ref_migration.py
```

**Output:**
```
Found 5 projects in database
✅ Project 1 (My Project): Migrated 3 transition(s)
⏭️  Project 2 (Demo): No migration needed
...
============================================================
✅ Migration complete!
   Projects migrated: 3/5
   Transitions migrated: 12
============================================================
```

**Safety:**
- ✅ Safe to run multiple times (idempotent)
- ✅ Automatically skips already-migrated transitions
- ✅ Rolls back on error
- ✅ Does not delete any data

**Verify Migration:**

After running, you can verify the migration by checking your project in the UI:
1. Open the State Machine canvas
2. Click on an outgoing transition
3. In the Transition Properties panel, workflows should be listed
4. Export the project - workflows should now appear in the transitions section

## Troubleshooting

### "DATABASE_URL environment variable not set"
Make sure you've exported the DATABASE_URL:
```bash
export DATABASE_URL=$(grep DATABASE_URL .env | cut -d '=' -f2-)
```

### "No module named 'app'"
Run the migration from the backend directory:
```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend
python migrations/001_transition_workflow_ref_migration.py
```

### Migration fails with database error
1. Check your database is running
2. Verify DATABASE_URL is correct
3. Ensure you have write permissions on the database

## Development Notes

For development, the frontend code now expects all transition workflows to be in WorkflowReference format. The migration script ensures backward compatibility is not needed.

When creating new migrations:
1. Create a new file: `00X_migration_name.py`
2. Include clear documentation
3. Make it idempotent (safe to run multiple times)
4. Add rollback logic if needed
5. Update this README
