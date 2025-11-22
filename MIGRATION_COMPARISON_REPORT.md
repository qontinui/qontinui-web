# Database Migration Comparison Report

**Generated:** 2025-11-22
**Project:** qontinui-web/backend
**Status:** ⚠️ **CRITICAL - Production Database Significantly Behind**

---

## Executive Summary

### Critical Findings

1. **Production is 25 migrations behind local codebase**
   - Production: `63e5da6dd826` (merge_migration_branches)
   - Local HEAD: `4a8b9c6d5e7f` (add_performance_indexes)

2. **Migration files have structural issues**
   - 3 migrations with missing/incorrect parents
   - 1 migration (`collaboration_001`) starts from `None` instead of branching

3. **Local database connection issue**
   - Alembic cannot connect due to asyncpg driver mismatch
   - Database is running but not queryable via Alembic

4. **New schema changes not in migrations**
   - `max_duration_seconds` field added to AutomationSession
   - `InputEventType` enum added but not enforced in database

---

## Database Status Comparison

| Aspect | Local Database | AWS Production |
|--------|---------------|----------------|
| **Current Version** | Unknown (connection issue) | `63e5da6dd826` |
| **Expected Version** | `4a8b9c6d5e7f` | `63e5da6dd826` |
| **Status** | Cannot verify | ✅ Connected |
| **Tables Count** | Unknown | 10 |
| **Migrations Behind** | 0 (assumed up to date) | ~25 |
| **Connection** | ❌ Asyncpg mismatch | ✅ Working |
| **Alembic Heads** | 1 (correct) | N/A |

---

## Migration Chain Comparison

### Production Database Current State

**Version:** `63e5da6dd826`
**Description:** merge_migration_branches
**Tables in Production (10):**
1. alembic_version
2. analytics_events
3. audit_logs
4. device_sessions
5. projects
6. session_activities
7. storage_usage
8. subscriptions
9. usage_metrics
10. users

### Local Codebase HEAD

**Version:** `4a8b9c6d5e7f`
**Description:** add_performance_indexes
**Expected Tables:** 34+ (production is missing 24+ tables)

### Missing Features in Production

The following features exist in code but NOT in production database:

#### 1. Organization & Team Management (4 tables)
- organizations
- organization_members
- organization_invitations
- project_access_control

#### 2. Workflow System (3 tables)
- workflows
- workflow_executions
- workflow_versions

#### 3. Automation Features (7 tables)
- automation_sessions
- automation_logs
- automation_screenshots
- automation_input_events
- automation_videos
- screenshot_input_associations
- runner_tokens
- runner_connections

#### 4. Screenshot Management (3 tables)
- screenshots
- annotations
- image_variants_metadata

#### 5. Collaboration (6 tables)
- collaboration_sessions
- collaboration_participants
- collaboration_changes
- version_history
- conflict_logs
- notifications

#### 6. Pattern & State Management (4 tables)
- patterns
- state_images
- snapshot_runs
- snapshot_actions
- snapshot_patterns
- snapshot_matches

---

## Migration Path Analysis

### Path from Production to HEAD

Production needs to apply these migrations in order:

```
63e5da6dd826 (current production)
  ↓
[~25 migrations to apply]
  ↓
20251121_partitioning (enable_table_partitioning)
  ↓
20251121_audit_logs (enhance_audit_logs - SOC 2 compliance)
  ↓
fe6100cf21ca (add_index_project_access_expires_at)
  ↓
4a8b9c6d5e7f (add_performance_indexes) [TARGET HEAD]
```

**Estimated Migration Time:** 2-5 minutes (depending on data volume)

---

## Critical Issues Found

### Issue 1: Production Database Significantly Behind ⚠️

**Problem:**
Production is at `63e5da6dd826` but should be at `4a8b9c6d5e7f` (~25 migrations behind)

**Impact:**
- Missing critical features (automation, workflows, organizations)
- Missing performance indexes
- Missing data integrity constraints
- Missing SOC 2 compliance fields

**Risk Level:** MEDIUM-HIGH
- ✅ Can be fixed with sequential migration
- ⚠️ Large number of migrations (25+)
- ⚠️ Includes complex migrations (table partitioning, data migrations)

**Recommendation:** Apply all pending migrations during maintenance window

---

### Issue 2: collaboration_001 Migration Has No Parent 🔴

**Problem:**
File: `create_collaboration_tables.py`
- Revision: `collaboration_001`
- Down revision: `None`
- **Should branch from existing head, not create new root**

**Impact:**
- Creates orphaned migration branch
- Will never merge with main chain
- Production cannot apply this migration (no path from current version)

**Risk Level:** HIGH
- ❌ Blocks deployment of collaboration features
- ❌ Creates divergent migration history

**Fix Required:**
```python
# File: alembic/versions/create_collaboration_tables.py
# Change line:
down_revision = None
# To:
down_revision = '4a8b9c6d5e7f'  # Or appropriate parent
```

---

### Issue 3: Local Database Connection Failure 🔴

**Problem:**
Alembic cannot connect to local database:
```
MissingGreenlet: greenlet_spawn has not been called
```

**Root Cause:**
- `.env` uses `postgresql+asyncpg://` (async driver)
- Alembic runs synchronously
- Cannot use asyncpg for synchronous connections

**Impact:**
- Cannot verify local database state with Alembic
- Cannot run `alembic current` or `alembic check`
- Can still run `alembic heads` and `alembic history` (offline commands)

**Risk Level:** MEDIUM
- ⚠️ Prevents local migration verification
- ✅ Doesn't block migration creation
- ✅ Production connection works fine

**Fix Required:**
Create separate sync DATABASE_URL for Alembic:

```python
# alembic/env.py
import os

# Use sync driver for Alembic
database_url = os.getenv("DATABASE_URL")
if database_url:
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
```

---

### Issue 4: New Schema Changes Not in Migrations ⚠️

**Problem:**
Recent code changes not yet in migration files:

1. **AutomationSession.max_duration_seconds**
   - Model field added (default: 28800)
   - No migration created

2. **InputEventType enum**
   - Enum defined in code
   - Column still uses `String(50)` without enum constraint

**Impact:**
- Schema drift between code and database
- New instances will fail to create sessions with duration limit
- Input event validation won't work properly

**Risk Level:** MEDIUM
- ⚠️ Causes runtime errors for new features
- ✅ Doesn't break existing functionality

**Fix Required:**
Create new migration with `./scripts/safe_migrate.sh`

---

## Verification Status

| Check | Local | Production | Status |
|-------|-------|------------|--------|
| Database running | ✅ Yes (Docker) | ✅ Yes (RDS) | PASS |
| Alembic connection | ❌ Asyncpg issue | ✅ Connected | WARN |
| Migration heads | ✅ 1 head | N/A | PASS |
| Current version | ❓ Unknown | `63e5da6dd826` | WARN |
| At HEAD | ❓ Cannot verify | ❌ No (25 behind) | FAIL |
| Schema drift | ❌ Yes (2 fields) | ❌ Yes (major) | FAIL |

**Overall Status:** ⚠️ **REQUIRES ACTION**

---

## Action Plan

### Phase 1: Fix Migration Structure Issues (LOCAL)

**Priority:** CRITICAL
**Time:** 30 minutes

1. **Fix collaboration_001 parent:**
   ```bash
   cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend

   # Edit file
   nano alembic/versions/create_collaboration_tables.py

   # Change:
   # down_revision = None
   # To:
   # down_revision = '4a8b9c6d5e7f'  # Current head
   ```

2. **Fix local Alembic connection:**
   ```bash
   # Edit alembic/env.py
   # Add after line 20:
   database_url = config.get_main_option("sqlalchemy.url")
   if database_url and "asyncpg" in database_url:
       database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
       config.set_main_option("sqlalchemy.url", database_url)
   ```

3. **Verify fixes:**
   ```bash
   poetry run alembic heads
   # Should show 1 head

   poetry run alembic current
   # Should show current version (no asyncpg error)
   ```

---

### Phase 2: Update Production Database (AWS)

**Priority:** HIGH
**Time:** 10-15 minutes
**Requires:** Maintenance window, RDS snapshot

#### Pre-Migration Checklist

- [ ] Schedule maintenance window
- [ ] Create RDS snapshot
   ```bash
   aws rds create-db-snapshot \
     --db-instance-identifier qontinui-db \
     --db-snapshot-identifier qontinui-db-pre-migration-$(date +%Y%m%d-%H%M%S) \
     --region eu-central-1
   ```
- [ ] Notify users of downtime
- [ ] Stop application servers (Elastic Beanstalk)
- [ ] Backup current production DATABASE_URL

#### Migration Steps

1. **Export production DATABASE_URL:**
   ```bash
   export DATABASE_URL="postgresql://qontinui_admin:****2345@qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com:5432/postgres?sslmode=require"
   ```

2. **Verify current production version:**
   ```bash
   poetry run alembic current
   # Expected: 63e5da6dd826 (merge_migration_branches)
   ```

3. **Apply all pending migrations:**
   ```bash
   poetry run alembic upgrade head
   # Will apply ~25 migrations
   # Expected time: 2-5 minutes
   ```

4. **Verify migration success:**
   ```bash
   poetry run alembic current
   # Expected: 4a8b9c6d5e7f (add_performance_indexes)
   ```

5. **Check database tables:**
   ```bash
   psql "$DATABASE_URL" -c "\dt" | wc -l
   # Expected: 34+ tables (up from 10)
   ```

#### Post-Migration Verification

- [ ] Verify alembic_version table shows `4a8b9c6d5e7f`
- [ ] Verify all new tables created (run SQL check script)
- [ ] Start application servers
- [ ] Test critical user flows:
  - [ ] User registration and login
  - [ ] Project creation
  - [ ] Screenshot upload
  - [ ] Workflow creation (if applicable)
  - [ ] Automation session start (if applicable)
- [ ] Monitor error logs for migration-related issues
- [ ] Check application performance

#### Rollback Procedure (if needed)

```bash
# Restore from RDS snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier qontinui-db \
  --db-snapshot-identifier qontinui-db-pre-migration-YYYYMMDD-HHMMSS \
  --region eu-central-1

# Wait for restore to complete (10-15 minutes)
aws rds wait db-instance-available \
  --db-instance-identifier qontinui-db \
  --region eu-central-1
```

---

### Phase 3: Create Migration for New Features (LOCAL)

**Priority:** MEDIUM
**Time:** 15 minutes

After fixing structure issues and updating production:

1. **Create migration for new schema changes:**
   ```bash
   cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend

   # Use safe migration script
   ./scripts/safe_migrate.sh "add_max_duration_and_input_event_enum"
   ```

2. **Verify migration file:**
   ```bash
   # Should include:
   # - Add max_duration_seconds column to automation_sessions
   # - Create InputEventType enum
   # - Alter automation_input_events.event_type to use enum
   ```

3. **Test migration locally:**
   ```bash
   poetry run alembic upgrade head
   # Apply to local database

   poetry run python run.py
   # Test application still works
   ```

4. **Commit migration:**
   ```bash
   git add alembic/versions/*max_duration*
   git commit -m "Add session duration limit and input event type enum"
   git push
   ```

---

### Phase 4: Deploy New Migration to Production

**Priority:** MEDIUM
**Time:** 5 minutes

1. **Deploy code with new migration:**
   ```bash
   cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend
   eb deploy qontinui-prod-py
   ```

2. **SSH into production and apply migration:**
   ```bash
   eb ssh qontinui-prod-py

   # Once connected:
   cd /var/app/current
   source venv/bin/activate
   alembic upgrade head
   ```

3. **Verify:**
   ```bash
   alembic current
   # Should show new migration version
   ```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Production migration fails | LOW | HIGH | RDS snapshot + rollback plan |
| Application breaks after migration | LOW | HIGH | Test on staging first |
| Data loss during migration | VERY LOW | CRITICAL | Automatic RDS snapshot |
| Downtime exceeds window | LOW | MEDIUM | Test migration time on staging |
| Migration creates performance issues | MEDIUM | MEDIUM | Performance indexes included |
| Rollback required | LOW | HIGH | RDS snapshot + tested procedure |

**Overall Risk:** MEDIUM
**Recommendation:** Proceed with caution, test on staging if available

---

## Timeline Estimate

| Phase | Time | Can Run in Parallel |
|-------|------|---------------------|
| Phase 1: Fix migration structure | 30 min | No |
| Phase 2: Update production DB | 10-15 min | No |
| Phase 3: Create new migration | 15 min | Yes (after Phase 1) |
| Phase 4: Deploy new migration | 5 min | No (after Phase 3) |
| **Total Sequential Time** | **60-65 minutes** | |
| **Total with Parallelization** | **50-55 minutes** | |

**Recommended Schedule:**
- Phase 1: Immediately (can do anytime)
- Phase 2: During next maintenance window
- Phase 3: After Phase 1, before Phase 2 deployment
- Phase 4: Same maintenance window as Phase 2 or next window

---

## Success Criteria

### Phase 1 Complete ✓
- [ ] collaboration_001 has correct parent
- [ ] Alembic can connect to local database
- [ ] `alembic heads` shows exactly 1 head
- [ ] `alembic current` shows current version (no error)

### Phase 2 Complete ✓
- [ ] Production at version `4a8b9c6d5e7f`
- [ ] All 34+ tables exist in production
- [ ] Application starts successfully
- [ ] Critical user flows work
- [ ] No error logs related to missing tables

### Phase 3 Complete ✓
- [ ] New migration file created
- [ ] Migration includes max_duration_seconds column
- [ ] Migration includes InputEventType enum
- [ ] Local database upgraded successfully
- [ ] Application works with new schema

### Phase 4 Complete ✓
- [ ] Code deployed to production
- [ ] Migration applied to production
- [ ] New features work correctly
- [ ] No regression in existing features

---

## Next Steps

**Immediate (Today):**
1. Review this report with team
2. Fix migration structure issues (Phase 1)
3. Test fixes on local database

**This Week:**
1. Schedule maintenance window for production update
2. Create RDS snapshot
3. Test migration on staging environment (if available)
4. Update production database (Phase 2)

**Next Week:**
1. Create and test new migration (Phase 3)
2. Deploy new migration to production (Phase 4)
3. Monitor application for any issues

---

## Contact & Resources

**Documentation:**
- Full migration analysis: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/MIGRATION_STATUS_SUMMARY.md`
- Production check script: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/check_prod_migrations.py`
- Safe migration script: `/backend/scripts/safe_migrate.sh`
- Migration quick reference: `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/MIGRATION_QUICK_REFERENCE.md`

**AWS Resources:**
- RDS Instance: `qontinui-db`
- Region: `eu-central-1`
- Elastic Beanstalk: `qontinui-prod-py`

**Emergency Contacts:**
- Database issues: Check RDS logs in CloudWatch
- Application issues: Check Elastic Beanstalk logs
- Rollback: Use RDS snapshot restore procedure above

---

**Report Generated By:** Claude Code Multi-Agent System
**Report Version:** 1.0
**Last Updated:** 2025-11-22
