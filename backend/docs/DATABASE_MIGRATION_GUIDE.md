# Database Migration Guide - Automation Tables

## Overview

This guide covers applying the automation tables migration to both **local (development)** and **AWS (staging/production)** databases.

---

## Local Database (Development)

### ✅ Status: COMPLETE

The migration has been successfully applied to the local Docker PostgreSQL database.

### Migration Details

**Migration File:** `f9593625b747_add_automation_tables.py`
**Applied:** 2025-11-14

**Tables Created:**
1. `automation_sessions` - 10 columns, 4 indexes, 2 foreign keys
2. `automation_logs` - 8 columns, 5 indexes (including GIN on JSONB), 1 foreign key
3. `automation_screenshots` - 10 columns, 3 indexes, 1 foreign key
4. `screenshot_input_associations` - 6 columns, 3 indexes, 2 foreign keys

### Verification

```bash
# Check migration status
alembic current

# Output should show:
# f9593625b747 (head)

# List automation tables
docker exec -i $(docker ps -q -f name=postgres) psql -U qontinui -d qontinui -c "\dt automation_*"

# Should show:
# automation_logs
# automation_screenshots
# automation_sessions

# Check screenshot associations
docker exec -i $(docker ps -q -f name=postgres) psql -U qontinui -d qontinui -c "\dt screenshot_*"

# Should show:
# screenshot_input_associations
```

---

## AWS Database (Staging/Production)

### 🔴 Status: PENDING

The migration needs to be applied to your AWS RDS PostgreSQL database.

### Prerequisites

1. **Database Access**
   - Ensure you have credentials for the AWS RDS instance
   - Database must be accessible (check security groups)
   - Have the correct connection string

2. **Environment Configuration**
   - Update `.env.staging` or `.env.production` with real database credentials
   - Test connection before running migration

### Steps to Apply Migration

#### 1. Configure Environment

Create `.env.staging.local` (or `.env.production.local`):

```bash
# Copy template
cp .env.staging .env.staging.local

# Edit with real values
nano .env.staging.local
```

Update these values:
```env
# Database - PostgreSQL (AWS RDS)
DATABASE_URL=postgresql://USERNAME:PASSWORD@RDS_ENDPOINT:5432/DATABASE_NAME

# Example:
# DATABASE_URL=postgresql://qontinui_staging:REAL_PASSWORD@qontinui-staging.abc123.us-east-1.rds.amazonaws.com:5432/qontinui_staging
```

#### 2. Test Database Connection

```bash
# Set environment
export $(cat .env.staging.local | xargs)

# Test connection (from a machine that can reach RDS)
python -c "from app.db.session import engine; print('Connection successful')"
```

#### 3. Backup Database (CRITICAL!)

Before applying any migration to production:

```bash
# Create backup using pg_dump
pg_dump $DATABASE_URL > backup_before_automation_migration_$(date +%Y%m%d_%H%M%S).sql

# Or use AWS RDS snapshot
aws rds create-db-snapshot \
  --db-instance-identifier your-db-instance \
  --db-snapshot-identifier automation-migration-backup-$(date +%Y%m%d)
```

#### 4. Apply Migration

```bash
# IMPORTANT: Use the correct environment file
export $(cat .env.staging.local | xargs)

# Check current migration version
alembic current

# Review pending migrations
alembic history --verbose

# Apply migration
alembic upgrade head

# Verify success
alembic current
# Should show: f9593625b747 (head)
```

#### 5. Verify Tables Created

Connect to AWS RDS and verify:

```bash
# Using psql (if accessible)
psql $DATABASE_URL -c "\dt automation_*"
psql $DATABASE_URL -c "\dt screenshot_*"

# Should see all 4 tables
```

#### 6. Test Application

After migration:

```bash
# Start backend with staging environment
export $(cat .env.staging.local | xargs)
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Test WebSocket endpoint (from another terminal)
# Use a tool like wscat or create a test client
```

---

## Important Notes

### Type Corrections Made

**Issue Found:** Initial migration used `UUID` for `project_id`, but `projects.id` is `INTEGER`.

**Fix Applied:**
- Updated `AutomationSession` model to use `Integer` for `project_id`
- Updated migration file to use `sa.Integer()` instead of `sa.UUID()`
- Updated WebSocket handler to parse `project_id` as integer

### Migration Dependencies

The automation tables migration depends on these existing tables:
- ✅ `users` (for `user_id` foreign key)
- ✅ `projects` (for `project_id` foreign key)

Both tables must exist before applying this migration.

### Rollback Procedure

If you need to rollback the migration:

```bash
# Rollback to previous version
alembic downgrade -1

# This will DROP all 4 automation tables
# All data will be lost!
```

The `downgrade()` function in the migration will:
1. Drop indexes
2. Drop `screenshot_input_associations` table
3. Drop `automation_screenshots` table
4. Drop `automation_logs` table
5. Drop `automation_sessions` table

---

## Migration File Details

**File:** `/alembic/versions/f9593625b747_add_automation_tables.py`

**Revision:** `f9593625b747`
**Revises:** `e45f9b2c3d1a`
**Created:** 2025-11-14

### Tables Created

#### automation_sessions
- **Primary Key:** id (UUID)
- **Foreign Keys:**
  - project_id → projects.id (SET NULL on delete)
  - user_id → users.id (CASCADE on delete)
- **Indexes:**
  - project_id, user_id, status
- **Special Columns:**
  - configuration_snapshot (JSONB)
  - status (default: 'active')

#### automation_logs
- **Primary Key:** id (UUID)
- **Foreign Key:** session_id → automation_sessions.id (CASCADE)
- **Indexes:**
  - session_id, level, timestamp
  - Composite: (session_id, sequence_number)
  - GIN: log_data (for JSONB queries)
- **Special Columns:**
  - log_data (JSONB) - Stores structured event data

#### automation_screenshots
- **Primary Key:** id (UUID)
- **Foreign Key:** session_id → automation_sessions.id (CASCADE)
- **Indexes:**
  - session_id, name, timestamp
- **Special Columns:**
  - automation_metadata (JSONB)
  - presigned_url (nullable)

#### screenshot_input_associations
- **Primary Key:** id (UUID)
- **Foreign Keys:**
  - screenshot_id → automation_screenshots.id (CASCADE)
  - log_id → automation_logs.id (CASCADE)
- **Indexes:**
  - screenshot_id, log_id, input_type
- **Special Columns:**
  - input_data (JSONB)
  - timestamp_diff_ms (Integer)

---

## Testing After Migration

### 1. Database Queries

Test basic queries:

```sql
-- Count sessions
SELECT COUNT(*) FROM automation_sessions;

-- Should return 0 (no data yet)

-- Verify foreign key constraints
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name LIKE 'automation_%'
   OR tc.table_name LIKE 'screenshot_%'
ORDER BY tc.table_name;
```

### 2. API Endpoints

Test REST endpoints:

```bash
# List sessions (should return empty array)
curl http://localhost:8001/api/v1/automation/sessions

# Should return:
# {"sessions": [], "total": 0}
```

### 3. WebSocket Connection

Test runner WebSocket:

```javascript
const ws = new WebSocket('ws://localhost:8001/api/v1/automation/ws/runner?token=YOUR_JWT_TOKEN');

ws.onopen = () => {
  console.log('Connected');

  // Send session_start
  ws.send(JSON.stringify({
    type: 'session_start',
    project_id: 1,  // Use existing project ID
    runner_version: '0.1.0',
    runner_os: 'Linux 5.15.0',
    runner_hostname: 'test-runner',
    configuration_snapshot: {}
  }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('Response:', response);

  // Should receive session_id
  // {type: 'response', success: true, data: {session_id: 'uuid...'}}
};
```

---

## Troubleshooting

### Migration Fails with "relation does not exist"

**Cause:** Required tables (users, projects) don't exist.

**Solution:**
```bash
# Check which tables exist
psql $DATABASE_URL -c "\dt"

# Apply all pending migrations
alembic upgrade head
```

### Migration Fails with Type Mismatch

**Cause:** Attempting to create foreign key with incompatible types.

**Solution:** This should be fixed in the current migration (project_id is Integer, not UUID).

### Cannot Connect to AWS RDS

**Cause:** Security group not configured, or connecting from wrong IP.

**Solution:**
1. Check RDS security group inbound rules
2. Add your IP address
3. Ensure RDS is publicly accessible (if needed)
4. Verify VPC and subnet configuration

### Migration Applied but Tables Not Visible

**Cause:** Connected to wrong database or schema.

**Solution:**
```bash
# Verify database name
psql $DATABASE_URL -c "SELECT current_database();"

# Verify schema
psql $DATABASE_URL -c "SELECT current_schema();"

# List all tables in public schema
psql $DATABASE_URL -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
```

---

## Summary

### Local Database ✅
- Migration applied successfully
- All 4 tables created with proper indexes and foreign keys
- Ready for development and testing

### AWS Database ⏳
- Migration file ready
- Follow steps above to apply to staging/production
- **ALWAYS backup before applying to production!**

### Next Steps
1. Apply migration to AWS RDS (staging environment first)
2. Test with qontinui-runner in staging
3. Verify all WebSocket and REST endpoints work
4. Monitor for any issues
5. Apply to production when staging is stable

---

**Migration Status:**
- Local: ✅ Complete
- Staging: ⏳ Pending
- Production: ⏳ Pending

**Documentation:**
- Implementation Summary: `AUTOMATION_WEBSOCKET_IMPLEMENTATION_SUMMARY.md`
- Quick Start: `AUTOMATION_QUICK_START.md`
- This Guide: `DATABASE_MIGRATION_GUIDE.md`
