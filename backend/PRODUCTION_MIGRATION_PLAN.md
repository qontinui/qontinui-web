# Production Database Migration Plan

## Current State Analysis

**Production Database:** `qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com:5432/postgres`
**Current Migration:** `63e5da6dd826` (merge_migration_branches)
**Target Migration:** `675031faaab9` (verify_schema_sync)

### Critical Issue: Inconsistent Database State

Production database is at merge migration `63e5da6dd826` but only applied one of the two parent branches:

- ✅ **Applied:** Path A migrations (has `analytics_events` table)
- ❌ **Missing:** Path B migrations (missing `annotation_sets` table)

**Tables in Production (10 total):**
1. alembic_version
2. analytics_events ⚠️ (should have been dropped by migration d42d46b1738d)
3. audit_logs
4. device_sessions
5. projects
6. session_activities
7. storage_usage
8. subscriptions
9. usage_metrics
10. users

**Expected at migration 63e5da6dd826:**
- Should have `annotation_sets` and `annotations` tables (from Path B)
- Should NOT have `analytics_events` (dropped in Path B)

## Why Standard Migration Will Fail

Running `alembic upgrade head` will fail because:

1. **Missing annotation_sets table:**
   - Migration `a1b2c3d4e5f6` (add_organization_and_team_management) expects annotation_sets to exist
   - Will fail with FOREIGN KEY constraint errors

2. **Existing analytics_events table:**
   - Migration `675031faaab9` (verify_schema_sync) tries to CREATE TABLE analytics_events
   - Will fail with "table already exists" error

3. **Migration d42d46b1738d was never applied:**
   - This migration creates annotation_sets and drops analytics_events
   - Production skipped this entire branch

## Migration Strategy Options

### Option 1: Manual Repair (RECOMMENDED)

Manually fix the database state before running alembic upgrade.

**Steps:**

1. **Backup production database** (CRITICAL - do this first!)
   ```bash
   # From your local machine with AWS CLI configured
   eb ssh qontinui-prod-py
   # On production server:
   pg_dump -h qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com \
           -U qontinui_admin -d postgres \
           -F c -f /tmp/prod_backup_$(date +%Y%m%d_%H%M%S).dump
   ```

2. **Manually create missing tables from migration d42d46b1738d**

   Run this SQL on production (see SQL script in Option 1A below):
   - CREATE TABLE annotation_sets
   - CREATE TABLE annotations
   - Create all indexes
   - Do NOT drop analytics_events (keep it for now)

3. **Run alembic upgrade head**
   ```bash
   cd backend
   poetry run alembic upgrade head
   ```

4. **Handle analytics_events conflict in migration 675031faaab9**

   The migration will fail when trying to create analytics_events. You have two options:

   **A. Edit the migration before deploying** (PREFERRED):
   - Edit `675031faaab9_verify_schema_sync.py`
   - Wrap analytics_events creation in a conditional check:
   ```python
   # Check if table exists before creating
   conn = op.get_bind()
   inspector = sa.inspect(conn)
   if 'analytics_events' not in inspector.get_table_names():
       # Create analytics_events table
       op.create_table('analytics_events', ...)
   ```

   **B. Manually skip the failed migration**:
   - Let it fail on analytics_events
   - Manually update alembic_version to skip that part
   - Not recommended - error-prone

### Option 2: Custom Production Migration

Create a new migration that handles the inconsistent state.

**Steps:**

1. **Create repair migration:**
   ```bash
   poetry run alembic revision -m "repair_production_state_before_upgrade"
   ```

2. **Edit the migration to:**
   - Check if annotation_sets exists, create if missing
   - Check if analytics_events exists, skip if present
   - Ensure all indexes and constraints are correct

3. **Deploy and run:**
   ```bash
   git add alembic/versions/*repair_production_state*
   git commit -m "Add production state repair migration"
   eb deploy qontinui-prod-py
   # SSH to production and run:
   poetry run alembic upgrade head
   ```

### Option 3: Reset alembic_version and Re-apply (DANGEROUS)

**NOT RECOMMENDED** - High risk of data loss or state corruption.

This would involve:
1. Determining the actual schema state
2. Manually setting alembic_version to a known good state
3. Re-running migrations

Only consider if Option 1 and 2 fail.

## Recommended Approach: Option 1A - Manual Repair

### Step 1: Backup (MANDATORY)

```bash
# Connect to production
eb ssh qontinui-prod-py

# Create backup
pg_dump -h qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com \
        -U qontinui_admin -d postgres \
        -F c -f /tmp/prod_backup_$(date +%Y%m%d_%H%M%S).dump

# Verify backup was created
ls -lh /tmp/prod_backup_*
```

### Step 2: Create Missing Tables

Connect to production database and run:

```sql
-- Create annotation_sets table (from migration d42d46b1738d)
CREATE TABLE annotation_sets (
    id UUID NOT NULL,
    screenshot_name VARCHAR NOT NULL,
    screenshot_url VARCHAR NOT NULL,
    image_width INTEGER NOT NULL,
    image_height INTEGER NOT NULL,
    screenshots JSON,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    created_by_id UUID NOT NULL,
    notes TEXT,
    boundary_width INTEGER NOT NULL,
    CONSTRAINT annotation_sets_pkey PRIMARY KEY (id),
    CONSTRAINT annotation_sets_created_by_id_fkey FOREIGN KEY(created_by_id) REFERENCES users (id)
);

CREATE INDEX ix_annotation_sets_screenshot_name ON annotation_sets (screenshot_name);

-- Create annotations table (from migration d42d46b1738d)
CREATE TABLE annotations (
    id UUID NOT NULL,
    annotation_set_id UUID NOT NULL,
    screenshot_index INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    label VARCHAR,
    description TEXT,
    reason TEXT,
    extra_data JSON,
    "order" INTEGER,
    CONSTRAINT annotations_pkey PRIMARY KEY (id),
    CONSTRAINT annotations_annotation_set_id_fkey FOREIGN KEY(annotation_set_id) REFERENCES annotation_sets (id) ON DELETE CASCADE
);

CREATE INDEX ix_annotations_screenshot_index ON annotations (screenshot_index);
CREATE INDEX ix_annotations_set_screenshot ON annotations (annotation_set_id, screenshot_index);

-- Verify tables were created
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('annotation_sets', 'annotations');
```

### Step 3: Edit Migration 675031faaab9

Before deploying, edit the migration to handle existing analytics_events:

```python
# In alembic/versions/675031faaab9_verify_schema_sync.py

def upgrade() -> None:
    # Get existing tables
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Only create analytics_events if it doesn't exist
    if 'analytics_events' not in existing_tables:
        op.create_table('analytics_events',
            sa.Column('id', sa.UUID(), nullable=False),
            # ... rest of the table definition
        )
        # ... create indexes
    else:
        print("⚠️  analytics_events already exists, skipping creation")

    # Continue with rest of migration...
```

### Step 4: Deploy and Migrate

```bash
# From your local machine
cd qontinui-web/backend

# Commit the migration edit
git add alembic/versions/675031faaab9_verify_schema_sync.py
git commit -m "Handle existing analytics_events in production migration"

# Deploy to production
eb deploy qontinui-prod-py

# SSH to production
eb ssh qontinui-prod-py

# Navigate to app directory
cd /var/app/current/backend

# Run migrations
poetry run alembic upgrade head

# Verify success
poetry run alembic current
# Should show: 675031faaab9 (head)

# Check tables were created
poetry run python -c "
from sqlalchemy import create_engine, inspect
import os
engine = create_engine(os.getenv('DATABASE_URL'))
inspector = inspect(engine)
tables = sorted(inspector.get_table_names())
print(f'Total tables: {len(tables)}')
for t in tables:
    print(f'  - {t}')
"
```

### Step 5: Verify Application Health

```bash
# Check application logs
eb logs qontinui-prod-py --all

# Check health status
eb health qontinui-prod-py

# Test critical endpoints
curl http://qontinui-prod-py.eba-km2u4s23.eu-central-1.elasticbeanstalk.com/health
```

## Rollback Plan

If migration fails:

1. **Restore from backup:**
   ```bash
   # On production server
   pg_restore -h qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com \
              -U qontinui_admin -d postgres \
              -c /tmp/prod_backup_TIMESTAMP.dump
   ```

2. **Revert code deployment:**
   ```bash
   # From local machine
   eb deploy qontinui-prod-py --version <previous-version-label>
   ```

3. **Verify application:**
   ```bash
   eb health qontinui-prod-py
   curl http://qontinui-prod-py.eba-km2u4s23.eu-central-1.elasticbeanstalk.com/health
   ```

## Pre-Deployment Checklist

- [ ] Read and understand this entire document
- [ ] Review all migration files between 63e5da6dd826 and 675031faaab9
- [ ] Test migration path on a copy of production data locally
- [ ] Create production database backup
- [ ] Verify backup is valid and restorable
- [ ] Edit migration 675031faaab9 to handle existing analytics_events
- [ ] Schedule maintenance window (low-traffic period)
- [ ] Notify team of deployment
- [ ] Have rollback plan ready

## Post-Migration Verification

```bash
# Check migration version
poetry run alembic current

# Verify all expected tables exist
poetry run python check_prod_db.py "$DATABASE_URL"

# Run application tests
poetry run pytest tests/integration/

# Check application logs for errors
eb logs qontinui-prod-py --all | grep -i error

# Monitor application metrics
# - Response times
# - Error rates
# - Database connection pool
```

## Expected Final State

After successful migration, production should have:

**Migration Version:** `675031faaab9`

**Total Tables:** ~36 tables including:
- ✅ users
- ✅ projects
- ✅ annotation_sets
- ✅ annotations
- ✅ analytics_events (kept from original state)
- ✅ analysis_jobs
- ✅ analyzer_results
- ✅ fused_elements
- ✅ detected_elements
- ✅ region_analysis_jobs
- ✅ region_analyzer_results
- ✅ fused_regions
- ✅ detected_regions
- ✅ automation_sessions
- ✅ automation_logs
- ✅ automation_screenshots
- ✅ automation_input_events
- ... and all other tables from the complete schema

## Questions and Concerns

### Why did this happen?

Most likely someone ran `alembic upgrade head` when there were multiple heads, and alembic:
1. Chose one path to follow (Path A with analytics_events)
2. Skipped the other path (Path B with annotation_sets)
3. Applied the merge migration which just sets the version

### Will this happen again?

Not if we:
1. Always create merge migrations for multiple heads
2. Test migration paths on staging before production
3. Use the diagnostic script before deploying: `python check_prod_db.py`

### Is production data at risk?

No, if you follow the backup procedure. The migrations are additive (creating new tables and columns), not destructive.

### How long will migration take?

- Estimated downtime: 2-5 minutes
- Most tables are small (10 rows or less based on diagnostic)
- analytics_events might have more rows, but we're not modifying it

## Contact

If you encounter any issues during migration:
1. DO NOT PANIC
2. Take screenshots of errors
3. Check application logs: `eb logs qontinui-prod-py --all`
4. Restore from backup if needed
5. Review this document for troubleshooting steps
