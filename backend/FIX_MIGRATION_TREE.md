# Fixing the Migration Tree for Production Deployment

## Current Problem

You have 6 heads with overlapping dependencies that prevent `alembic upgrade head` from working.

## Root Cause

The migration tree has this structure:

```
63e5da6dd826 (merge_migration_branches)
    ├─── a1b2c3d4e5f6 (organizations)
    │    ├─── 08e4e8448e57
    │    │    └─── b1c2d3e4f5g6
    │    │         └─── d703626068d7 (HEAD 3)
    │    └─── e1f2g3h4i5j6 (HEAD 4)
    │
    ├─── z9fc6936875 (HEAD 6 - organizations duplicate)
    │
    └─── 67c33a12bedb (automation_tables_and_input_events) [BRANCHPOINT]
         ├─── e45f9b2c3d1a (snapshots)
         │    └─── collaboration_001 [BRANCHPOINT]
         │         ├─── f9593625b747 (HEAD 2)
         │         └─── 3dc9c2bf5574 (HEAD 1)
         │
         └─── 4e5f6a7b8c9d (automation_videos)
              └─── (leads to d703626068d7 and e1f2g3h4i5j6)

Also:
93687f70383c
    └─── d42d46b1738d (HEAD 5 - annotations)
```

**The Overlap:** `67c33a12bedb` is both:
- An ancestor of `f9593625b747` (through e45f9b2c3d1a → collaboration_001)
- A branchpoint to other heads (through 4e5f6a7b8c9d)

This creates circular dependencies that Alembic can't resolve.

---

## Solution Options

### Option A: Create Proper Final Merge (Recommended for Production)

This will create a single migration that merges all 6 heads properly.

#### Step 1: Manually Create the Final Merge Migration

Instead of using `alembic merge heads` (which fails due to overlap), create it manually:

```bash
cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend

# Create a new migration file
poetry run alembic revision -m "final_merge_all_branches"
```

This will create a new file like: `alembic/versions/XXXXXX_final_merge_all_branches.py`

#### Step 2: Edit the Migration File

Open the newly created file and modify it to merge ALL 6 heads:

```python
"""final_merge_all_branches

Revision ID: <generated_id>
Revises: 3dc9c2bf5574, d42d46b1738d, d703626068d7, e1f2g3h4i5j6, f9593625b747, z9fc6936875
Create Date: <timestamp>

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '<generated_id>'  # Don't change this
down_revision: Union[str, Sequence[str], None] = (
    '3dc9c2bf5574',  # HEAD 1: add_automation_streaming_fields
    'd42d46b1738d',  # HEAD 5: add_annotation_tables
    'd703626068d7',  # HEAD 3: merge_migrations
    'e1f2g3h4i5j6',  # HEAD 4: merge_automation_and_recording
    'f9593625b747',  # HEAD 2: Add automation tables
    'z9fc6936875'   # HEAD 6: add_organization_and_team_management
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge all branches - no schema changes needed."""
    pass


def downgrade() -> None:
    """Cannot downgrade a merge."""
    pass
```

#### Step 3: Test Locally

```bash
# Clear your local database
docker-compose.exe -f backend/docker-compose.dev.yml down -v
docker-compose.exe -f backend/docker-compose.dev.yml up -d
sleep 5

# Run migrations
poetry run alembic upgrade head

# Verify single head
poetry run alembic heads  # Should show ONLY your new merge migration
```

#### Step 4: Deploy to Production

Once tested locally:

```bash
# On production server:
# 1. Backup database
pg_dump production_db > backup_before_migration_$(date +%Y%m%d_%H%M%S).sql

# 2. Note current version
alembic current

# 3. Run migration
alembic upgrade head

# 4. Verify
alembic heads  # Should show 1 head
alembic current  # Should show your merge migration
```

---

### Option B: Squash Migrations (Clean Slate for Future)

If you haven't deployed to production yet, or can recreate production database, this is cleaner:

#### Step 1: Backup Current Schema

```bash
# Export current schema from working database
docker-compose.exe -f backend/docker-compose.dev.yml exec -T postgres \
  pg_dump -U qontinui_user --schema-only qontinui_db > current_schema.sql
```

#### Step 2: Delete All Migrations Except Initial

```bash
cd alembic/versions
# Keep only the initial migration
git rm $(ls *.py | grep -v "c1464319e0e2_initial_schema_with_uuid.py")
# Or manually delete all except c1464319e0e2_initial_schema_with_uuid.py
```

#### Step 3: Create New Comprehensive Migration

```bash
# Make sure your models represent the current schema
poetry run alembic revision --autogenerate -m "complete_schema_update"
```

This creates ONE migration from initial → current state.

#### Step 4: Test

```bash
# Fresh database
docker-compose.exe -f backend/docker-compose.dev.yml down -v
docker-compose.exe -f backend/docker-compose.dev.yml up -d

# Should now have only 2 migrations
poetry run alembic upgrade head

# Verify
poetry run alembic heads  # Should show 1 head
```

#### Step 5: Deploy

This becomes your new baseline. Going forward, all new migrations build on this.

---

### Option C: Import Schema Directly (Quick Fix)

For immediate local development:

1. Import the schema from your working computer
2. Mark all migrations as applied

```bash
# On this computer:
# 1. Import database
docker-compose.exe -f backend/docker-compose.dev.yml exec -T postgres \
  psql -U qontinui_user -d qontinui_db < backup_from_other_computer.sql

# 2. Check what migrations are recorded as applied
docker-compose.exe -f backend/docker-compose.dev.yml exec -T postgres \
  psql -U qontinui_user -d qontinui_db -c "SELECT * FROM alembic_version;"
```

This will show which migrations are recorded. Your database is now in the same state as the other computer.

**But this doesn't fix the migration tree** - it just makes your local dev work. You still need Option A or B for production.

---

## Recommended Approach

### For Immediate Local Development
→ **Option C** (import database)

### For Production Deployment
→ **Option A** (create proper merge migration)

### For Long-Term Clean History
→ **Option B** (squash migrations) after production is stable

---

## After Fixing: Prevent Future Issues

### 1. Pre-Push Checklist

Before pushing any code with migrations:

```bash
git pull origin main
poetry run alembic heads  # MUST show 1 head
# If > 1 head, create merge migration BEFORE continuing
```

### 2. Workflow

Use **Option 1 from MIGRATION_WORKFLOW_GUIDE.md**:
- Code in feature branches
- Migrations ONLY on main (after merging code)

### 3. Production Deployment Checklist

```bash
# Before every production deployment:
□ alembic heads shows 1 head
□ Tested on staging database
□ Production database backed up
□ Rollback plan documented
□ Team notified of deployment
```

---

## Commands Summary

### Check Current State
```bash
poetry run alembic heads      # How many heads?
poetry run alembic current    # What version is DB at?
poetry run alembic history    # Show full tree
```

### Create Merge Migration (if multiple heads)
```bash
# If alembic merge heads fails:
poetry run alembic revision -m "merge_branches"
# Then manually edit the file to list all heads
```

### Deploy to Production
```bash
# 1. Backup
pg_dump production_db > backup.sql

# 2. Deploy
git pull origin main
alembic upgrade head

# 3. Verify
alembic current
alembic heads  # Should be 1
```

---

## Next Steps

1. **Choose your approach:**
   - Option A for production (proper merge)
   - Option B if you can squash (cleaner)
   - Option C for immediate local dev

2. **Test thoroughly locally**

3. **Deploy to production** with backups

4. **Establish workflow** to prevent future issues

Would you like me to help you implement any of these options?
