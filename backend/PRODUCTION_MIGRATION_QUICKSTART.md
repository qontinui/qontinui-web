# Production Migration - Quick Start Guide

## TL;DR - What's Wrong and How to Fix It

**Problem:** Production database is at migration `63e5da6dd826` but missing critical tables because it never applied one of the migration branches.

**Solution:** Manually create missing tables, then run alembic upgrade.

## Critical Discovery

Production database claims to be at merge migration `63e5da6dd826`, but:
- ✅ Has `analytics_events` table (from Path A)
- ❌ Missing `annotation_sets` and `annotations` tables (from Path B)

This inconsistency will cause migration failures if you run `alembic upgrade head` directly.

## Quick Fix (30 minutes)

### Step 1: Backup Production (5 min)

```bash
eb ssh qontinui-prod-py
pg_dump -h qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com \
        -U qontinui_admin -d postgres \
        -F c -f /tmp/prod_backup_$(date +%Y%m%d_%H%M%S).dump
```

### Step 2: Create Missing Tables (5 min)

Connect to production database and run:

```bash
# From production server
psql -h qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com \
     -U qontinui_admin -d postgres \
     -f /path/to/create_missing_annotation_tables.sql
```

Or manually copy and run the SQL from `create_missing_annotation_tables.sql`.

**IMPORTANT:** The script opens a transaction. After verifying output, run:
```sql
COMMIT;  -- if everything looks good
-- OR
ROLLBACK;  -- if something went wrong
```

### Step 3: Deploy Updated Code (10 min)

```bash
# From local machine
cd qontinui-web/backend

# Ensure you have the edited migration file
git add alembic/versions/675031faaab9_verify_schema_sync.py
git commit -m "Handle existing analytics_events in production migration"

# Deploy to production
eb deploy qontinui-prod-py
```

### Step 4: Run Migrations (5 min)

```bash
# SSH to production
eb ssh qontinui-prod-py

# Navigate to app
cd /var/app/current/backend

# Run migrations
poetry run alembic upgrade head

# Verify
poetry run alembic current
# Should show: 675031faaab9 (head)
```

### Step 5: Verify (5 min)

```bash
# Check application health
eb health qontinui-prod-py

# Test health endpoint
curl http://qontinui-prod-py.eba-km2u4s23.eu-central-1.elasticbeanstalk.com/health

# Check logs
eb logs qontinui-prod-py --all | tail -50
```

## What I Fixed

1. **Modified migration `675031faaab9`** to check if `analytics_events` exists before creating it
2. **Created SQL script** to manually create missing `annotation_sets` and `annotations` tables
3. **Created diagnostic script** (`check_prod_db.py`) to check production state before migrations
4. **Documented the full migration plan** in `PRODUCTION_MIGRATION_PLAN.md`

## Files Created/Modified

```
backend/
├── PRODUCTION_MIGRATION_PLAN.md         # Detailed migration plan
├── PRODUCTION_MIGRATION_QUICKSTART.md   # This file
├── create_missing_annotation_tables.sql # SQL to repair production
├── check_prod_db.py                     # Diagnostic tool
└── alembic/versions/
    └── 675031faaab9_verify_schema_sync.py  # Modified to skip existing analytics_events
```

## Rollback Plan

If anything goes wrong:

```bash
# Restore from backup
pg_restore -h qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com \
           -U qontinui_admin -d postgres \
           -c /tmp/prod_backup_TIMESTAMP.dump

# Revert code deployment
eb deploy qontinui-prod-py --version <previous-version>
```

## Why This Happened

The migration tree had two branches that were supposed to merge at `63e5da6dd826`:

```
Branch A: 8727d5cd01ba ─┐
                        ├─> 63e5da6dd826 (merge)
Branch B: d42d46b1738d ─┘
```

- **Branch A** kept `analytics_events`
- **Branch B** dropped `analytics_events` and created `annotation_sets`

Production applied Branch A but not Branch B, then set the version to the merge point.

## Prevention

To prevent this in the future:

1. **Always test migrations on staging** with a copy of production data
2. **Use the diagnostic script** before deploying:
   ```bash
   python check_prod_db.py "$PROD_DATABASE_URL"
   ```
3. **Create merge migrations immediately** when multiple heads are detected
4. **Document migration dependencies** in migration files

## Need Help?

- **Full details:** See `PRODUCTION_MIGRATION_PLAN.md`
- **Check production state:** Run `python check_prod_db.py <db_url>`
- **View migration history:** `poetry run alembic history`
- **Check current version:** `poetry run alembic current`

## Expected Final State

After successful migration:

- **Migration version:** `675031faaab9` (head)
- **Total tables:** ~36 tables
- **Key tables:**
  - ✅ users
  - ✅ projects
  - ✅ analytics_events (kept from existing state)
  - ✅ annotation_sets (newly created)
  - ✅ annotations (newly created)
  - ✅ analysis_jobs (newly created)
  - ✅ analyzer_results (newly created)
  - ✅ fused_elements (newly created)
  - ✅ detected_elements (newly created)
  - ✅ region_analysis_jobs (newly created)
  - ✅ region_analyzer_results (newly created)
  - ✅ fused_regions (newly created)
  - ✅ detected_regions (newly created)
  - ✅ automation_sessions (newly created)
  - ✅ automation_logs (newly created)
  - ✅ automation_screenshots (newly created)
  - ✅ automation_input_events (newly created)

## Downtime Estimate

- **Expected downtime:** 2-5 minutes during migration execution
- **Total maintenance window:** 30-45 minutes (including preparation and verification)
- **Best time:** Low traffic period (late night/early morning)

## Pre-Flight Checklist

- [ ] Read this guide completely
- [ ] Review `PRODUCTION_MIGRATION_PLAN.md` for full details
- [ ] Test migration on local copy of production data
- [ ] Create production backup
- [ ] Verify backup is restorable
- [ ] Schedule maintenance window
- [ ] Notify team of deployment
- [ ] Have rollback plan ready
- [ ] Monitor application metrics after migration
