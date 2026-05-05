# Database Partition Maintenance Guide
## Qontinui Web Platform - Operations Runbook

**Document Version:** 1.0
**Last Updated:** 2025-11-21
**Audience:** Operations Team, DevOps, Backend Engineers
**Related:** [PARTITIONING.md](./PARTITIONING.md), [PARTITION_MONITORING.md](./PARTITION_MONITORING.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Manual Partition Operations](#manual-partition-operations)
3. [Listing and Inspecting Partitions](#listing-and-inspecting-partitions)
4. [Creating Partitions](#creating-partitions)
5. [Dropping Partitions](#dropping-partitions)
6. [Data Archival to S3](#data-archival-to-s3)
7. [Troubleshooting](#troubleshooting)
8. [Backup and Restore](#backup-and-restore)
9. [Emergency Procedures](#emergency-procedures)

---

## Overview

This document provides step-by-step procedures for managing PostgreSQL table partitions in the Qontinui database. These operations are normally automated via ARQ tasks but may require manual intervention during:

- Initial partition setup
- Emergency situations (missed partition creation)
- Data recovery operations
- Performance troubleshooting
- Migration activities

**IMPORTANT:** Always test manual operations in staging first unless it's a production emergency.

---

## Manual Partition Operations

### Prerequisites

**Database Access:**
```bash
# Production database access
psql $DATABASE_URL

# Or via SSH tunnel
ssh -L 5433:<rds-endpoint>:5432 ec2-user@<bastion-host>
psql -h localhost -p 5433 -U qontinui_admin -d qontinui_prod
```

**Required Permissions:**
- `CREATE TABLE` privilege
- `DROP TABLE` privilege (for dropping partitions)
- `INSERT`, `SELECT` privileges for data operations

---

## Listing and Inspecting Partitions

### List All Partitions for a Table

```sql
-- List all partitions for automation_logs
SELECT
    schemaname,
    tablename AS partition_name,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'automation_logs_%'
ORDER BY tablename;
```

**Example Output:**
```
 schemaname |       partition_name        |  size
------------+-----------------------------+--------
 public     | automation_logs_2025_11     | 1852 MB
 public     | automation_logs_2025_12     | 2104 MB
 public     | automation_logs_2026_01     | 2387 MB
 public     | automation_logs_2026_02     | 312 MB
```

---

### Check Partition Definitions

```sql
-- Show partition boundaries
SELECT
    parent.relname AS parent_table,
    child.relname AS partition_name,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bounds
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'automation_logs'
ORDER BY child.relname;
```

**Example Output:**
```
 parent_table  |       partition_name        |              partition_bounds
---------------+-----------------------------+--------------------------------------------
 automation_logs | automation_logs_2025_11     | FOR VALUES FROM ('2025-11-01') TO ('2025-12-01')
 automation_logs | automation_logs_2025_12     | FOR VALUES FROM ('2025-12-01') TO ('2026-01-01')
 automation_logs | automation_logs_2026_01     | FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')
```

---

### Count Rows per Partition

```sql
-- Row counts for automation_logs partitions
SELECT
    schemaname,
    tablename AS partition_name,
    n_live_tup AS row_count,
    n_dead_tup AS dead_rows,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
WHERE tablename LIKE 'automation_logs_%'
ORDER BY tablename;
```

---

### Check Partition Coverage Gaps

```sql
-- Detect gaps in partition coverage (automation_logs monthly)
WITH partition_bounds AS (
    SELECT
        child.relname AS partition_name,
        pg_get_expr(child.relpartbound, child.oid) AS bounds_text,
        -- Extract start date from bounds
        (regexp_match(pg_get_expr(child.relpartbound, child.oid), 'FROM \(''([^'']+)'))[1]::date AS start_date,
        -- Extract end date from bounds
        (regexp_match(pg_get_expr(child.relpartbound, child.oid), 'TO \(''([^'']+)'))[1]::date AS end_date
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'automation_logs'
),
expected_partitions AS (
    SELECT
        generate_series(
            date_trunc('month', NOW() - INTERVAL '12 months'),
            date_trunc('month', NOW() + INTERVAL '3 months'),
            INTERVAL '1 month'
        )::date AS expected_start
)
SELECT
    expected_start,
    (expected_start + INTERVAL '1 month')::date AS expected_end,
    pb.partition_name,
    CASE
        WHEN pb.partition_name IS NULL THEN 'MISSING'
        ELSE 'OK'
    END AS status
FROM expected_partitions ep
LEFT JOIN partition_bounds pb ON ep.expected_start = pb.start_date
ORDER BY expected_start;
```

**Example Output:**
```
 expected_start | expected_end |       partition_name        | status
----------------+--------------+-----------------------------+--------
 2024-11-01     | 2024-12-01   | automation_logs_2024_11     | OK
 2024-12-01     | 2025-01-01   | automation_logs_2024_12     | OK
 2025-01-01     | 2025-02-01   |                             | MISSING ← ACTION REQUIRED
```

---

## Creating Partitions

### Create Monthly Partition (automation_logs, analytics_events)

```sql
-- Create partition for automation_logs (January 2026)
CREATE TABLE IF NOT EXISTS automation_logs_2026_01 PARTITION OF automation_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Verify creation
SELECT tablename FROM pg_tables WHERE tablename = 'automation_logs_2026_01';
```

---

### Create Weekly Partition (automation_input_events)

```sql
-- Create partition for automation_input_events (Week 1, 2026)
CREATE TABLE IF NOT EXISTS automation_input_events_2026_W01 PARTITION OF automation_input_events
    FOR VALUES FROM ('2026-01-01') TO ('2026-01-08');

-- Week 2
CREATE TABLE IF NOT EXISTS automation_input_events_2026_W02 PARTITION OF automation_input_events
    FOR VALUES FROM ('2026-01-08') TO ('2026-01-15');
```

**Note:** Weekly partitions use ISO week numbering. Use date calculations, not week numbers, to avoid confusion.

---

### Create Quarterly Partition (audit_logs, activity_logs)

```sql
-- Create partition for audit_logs (Q1 2026)
CREATE TABLE IF NOT EXISTS audit_logs_2026_Q1 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');

-- Q2 2026
CREATE TABLE IF NOT EXISTS audit_logs_2026_Q2 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
```

---

### Bulk Create Future Partitions

**Bash Script:** Create next 12 months of partitions

```bash
#!/bin/bash
# create_future_partitions.sh
# Usage: ./create_future_partitions.sh automation_logs 12

TABLE_NAME=${1:-automation_logs}
MONTHS=${2:-12}

for i in $(seq 0 $MONTHS); do
    START_DATE=$(date -d "+$i month" +%Y-%m-01)
    NEXT_MONTH=$(date -d "+$((i+1)) month" +%Y-%m-01)
    PARTITION_NAME="${TABLE_NAME}_$(date -d "$START_DATE" +%Y_%m)"

    echo "Creating partition: $PARTITION_NAME"

    psql $DATABASE_URL <<EOF
CREATE TABLE IF NOT EXISTS $PARTITION_NAME PARTITION OF $TABLE_NAME
    FOR VALUES FROM ('$START_DATE') TO ('$NEXT_MONTH');
EOF

    if [ $? -eq 0 ]; then
        echo "✓ Created $PARTITION_NAME"
    else
        echo "✗ Failed to create $PARTITION_NAME"
    fi
done
```

**Python Script:** Create partitions via SQLAlchemy

```python
# scripts/create_partitions.py
from datetime import datetime, timedelta
from sqlalchemy import text
from app.db.session import AsyncSessionLocal

async def create_monthly_partitions(table_name: str, months: int = 12):
    """Create next N months of partitions for a table."""
    async with AsyncSessionLocal() as db:
        for i in range(months):
            start_date = datetime.now() + timedelta(days=30*i)
            start_date = start_date.replace(day=1)
            end_date = (start_date + timedelta(days=32)).replace(day=1)

            partition_name = f"{table_name}_{start_date.strftime('%Y_%m')}"

            sql = text(f"""
            CREATE TABLE IF NOT EXISTS {partition_name} PARTITION OF {table_name}
                FOR VALUES FROM ('{start_date.date()}') TO ('{end_date.date()}');
            """)

            try:
                await db.execute(sql)
                await db.commit()
                print(f"✓ Created partition: {partition_name}")
            except Exception as e:
                print(f"✗ Failed to create {partition_name}: {e}")
                await db.rollback()

# Usage
if __name__ == "__main__":
    import asyncio
    asyncio.run(create_monthly_partitions("automation_logs", months=12))
```

---

## Dropping Partitions

### Drop Old Partition (Manual)

**CRITICAL:** Dropping a partition deletes ALL data in that partition. Always verify before dropping.

```sql
-- Step 1: Verify partition is old and should be dropped
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) AS size,
    (SELECT COUNT(*) FROM automation_logs_2024_01) AS row_count;

-- Step 2: Optional - Archive to S3 first (see section below)

-- Step 3: Drop the partition
DROP TABLE IF EXISTS automation_logs_2024_01;

-- Step 4: Verify drop was successful
SELECT tablename FROM pg_tables WHERE tablename = 'automation_logs_2024_01';
-- (should return 0 rows)
```

---

### Safe Drop with Archival

```sql
-- Step 1: Export partition data to CSV (for archival)
\copy (SELECT * FROM automation_logs_2024_01) TO '/tmp/automation_logs_2024_01.csv' WITH CSV HEADER;

-- Step 2: Compress the export
-- (Run in shell)
gzip /tmp/automation_logs_2024_01.csv

-- Step 3: Upload to S3
-- (Run in shell)
aws s3 cp /tmp/automation_logs_2024_01.csv.gz \
    s3://qontinui-archives/partitions/automation_logs/2024/automation_logs_2024_01.csv.gz \
    --storage-class GLACIER

-- Step 4: Verify upload
aws s3 ls s3://qontinui-archives/partitions/automation_logs/2024/

-- Step 5: Drop the partition
DROP TABLE automation_logs_2024_01;

-- Step 6: Log the operation
INSERT INTO partition_audit_log (operation, table_name, partition_name, status, details)
VALUES (
    'drop',
    'automation_logs',
    'automation_logs_2024_01',
    'success',
    '{"archived_to": "s3://qontinui-archives/partitions/automation_logs/2024/automation_logs_2024_01.csv.gz"}'::jsonb
);
```

---

### Bulk Drop Old Partitions

**WARNING:** This script drops ALL partitions older than retention period. Test carefully.

```python
# scripts/drop_old_partitions.py
from datetime import datetime, timedelta
from sqlalchemy import text
from app.db.session import AsyncSessionLocal

async def drop_old_partitions(table_name: str, retention_days: int):
    """Drop partitions older than retention period."""
    cutoff_date = datetime.now() - timedelta(days=retention_days)

    async with AsyncSessionLocal() as db:
        # Get all partitions with their bounds
        result = await db.execute(text(f"""
            SELECT
                child.relname AS partition_name,
                (regexp_match(pg_get_expr(child.relpartbound, child.oid),
                    'FROM \\(''([^'']+)'))[1]::date AS start_date
            FROM pg_inherits
            JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
            JOIN pg_class child ON pg_inherits.inhrelid = child.oid
            WHERE parent.relname = '{table_name}'
        """))

        partitions = result.fetchall()

        for partition_name, start_date in partitions:
            if start_date < cutoff_date.date():
                print(f"Dropping old partition: {partition_name} (start: {start_date})")

                # Optional: Archive first
                # await archive_partition_to_s3(table_name, partition_name)

                # Drop partition
                await db.execute(text(f"DROP TABLE IF EXISTS {partition_name}"))
                await db.commit()

                # Log operation
                await db.execute(text("""
                    INSERT INTO partition_audit_log
                    (operation, table_name, partition_name, status, details)
                    VALUES ('drop', :table_name, :partition_name, 'success', '{}'::jsonb)
                """), {"table_name": table_name, "partition_name": partition_name})
                await db.commit()

                print(f"✓ Dropped {partition_name}")

# Usage
if __name__ == "__main__":
    import asyncio
    asyncio.run(drop_old_partitions("automation_logs", retention_days=365))
```

---

## Data Archival to S3

### Export Partition to Parquet (Recommended)

Parquet format is more efficient than CSV for archival:

```python
# scripts/archive_partition.py
import pandas as pd
import pyarrow.parquet as pq
import boto3
from sqlalchemy import text
from app.db.session import AsyncSessionLocal

async def archive_partition_to_s3(table_name: str, partition_name: str):
    """Export partition to Parquet and upload to S3."""
    async with AsyncSessionLocal() as db:
        # Query partition data
        result = await db.execute(text(f"SELECT * FROM {partition_name}"))
        rows = result.fetchall()
        columns = result.keys()

        # Convert to DataFrame
        df = pd.DataFrame(rows, columns=columns)

        # Write to Parquet
        parquet_file = f"/tmp/{partition_name}.parquet"
        df.to_parquet(parquet_file, compression='snappy', index=False)

        # Upload to S3
        s3_client = boto3.client('s3')
        s3_key = f"partitions/{table_name}/{partition_name}.parquet"

        s3_client.upload_file(
            parquet_file,
            'qontinui-archives',
            s3_key,
            ExtraArgs={'StorageClass': 'GLACIER'}
        )

        print(f"✓ Archived {partition_name} to s3://qontinui-archives/{s3_key}")

        # Log operation
        await db.execute(text("""
            INSERT INTO partition_audit_log
            (operation, table_name, partition_name, status, details)
            VALUES ('archive', :table_name, :partition_name, 'success', :details)
        """), {
            "table_name": table_name,
            "partition_name": partition_name,
            "details": f'{{"s3_key": "{s3_key}", "rows": {len(df)}, "format": "parquet"}}'
        })
        await db.commit()

        # Clean up temp file
        import os
        os.remove(parquet_file)

# Usage
if __name__ == "__main__":
    import asyncio
    asyncio.run(archive_partition_to_s3("automation_logs", "automation_logs_2024_01"))
```

---

### Restore Partition from S3

```python
# scripts/restore_partition.py
import pandas as pd
import boto3
from sqlalchemy import text
from app.db.session import AsyncSessionLocal

async def restore_partition_from_s3(table_name: str, partition_name: str, s3_key: str):
    """Restore partition from S3 Parquet archive."""
    # Download from S3
    s3_client = boto3.client('s3')
    parquet_file = f"/tmp/{partition_name}.parquet"

    print(f"Downloading from s3://qontinui-archives/{s3_key}")
    s3_client.download_file('qontinui-archives', s3_key, parquet_file)

    # Read Parquet
    df = pd.read_parquet(parquet_file)
    print(f"Loaded {len(df)} rows from archive")

    # Recreate partition (if dropped)
    async with AsyncSessionLocal() as db:
        # Extract date range from partition name (e.g., automation_logs_2024_01)
        year_month = partition_name.split('_')[-2:]
        start_date = f"{year_month[0]}-{year_month[1]}-01"
        end_date = pd.to_datetime(start_date) + pd.DateOffset(months=1)

        # Create partition
        await db.execute(text(f"""
            CREATE TABLE IF NOT EXISTS {partition_name} PARTITION OF {table_name}
                FOR VALUES FROM ('{start_date}') TO ('{end_date.date()}');
        """))
        await db.commit()

        # Insert data (batch insert)
        batch_size = 10000
        for i in range(0, len(df), batch_size):
            batch = df.iloc[i:i+batch_size]
            batch.to_sql(partition_name, db.bind, if_exists='append', index=False)
            print(f"Inserted {i+len(batch)}/{len(df)} rows")

        print(f"✓ Restored {partition_name} from S3")

# Usage
if __name__ == "__main__":
    import asyncio
    asyncio.run(restore_partition_from_s3(
        "automation_logs",
        "automation_logs_2024_01",
        "partitions/automation_logs/automation_logs_2024_01.parquet"
    ))
```

---

## Troubleshooting

### Issue: "No partition of relation for row with given values"

**Symptom:**
```
ERROR: no partition of relation "automation_logs" found for row
DETAIL: Partition key of the failing row contains (created_at) = (2026-05-15 10:30:00).
```

**Cause:** Trying to insert data into a date range without a partition.

**Solution:**
```sql
-- 1. Check what partitions exist
SELECT tablename FROM pg_tables WHERE tablename LIKE 'automation_logs_%' ORDER BY tablename;

-- 2. Create missing partition
CREATE TABLE automation_logs_2026_05 PARTITION OF automation_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- 3. Retry the insert
```

---

### Issue: Slow Queries After Partition Migration

**Symptom:** Queries slower after moving to partitioned table.

**Diagnosis:**
```sql
-- Check if partition pruning is working
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM automation_logs
WHERE created_at > '2026-01-01';

-- Look for:
-- ✓ GOOD: "Parallel Append" with only relevant partitions
-- ✗ BAD: "Seq Scan" on all partitions
```

**Solution:**
```sql
-- Ensure indexes exist on all partitions
SELECT
    schemaname,
    tablename,
    indexname
FROM pg_indexes
WHERE tablename LIKE 'automation_logs_%'
ORDER BY tablename, indexname;

-- Recreate missing indexes
CREATE INDEX ON automation_logs_2026_01(session_id);
CREATE INDEX ON automation_logs_2026_01(created_at);
```

---

### Issue: Partition Too Large

**Symptom:** Single partition exceeds 50GB, causing slow queries.

**Diagnosis:**
```sql
-- Check partition sizes
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) AS size,
    pg_size_pretty(pg_total_relation_size(tablename::regclass) - pg_relation_size(tablename::regclass)) AS index_size
FROM pg_tables
WHERE tablename LIKE 'automation_logs_%'
ORDER BY pg_total_relation_size(tablename::regclass) DESC;
```

**Solution:** Switch to smaller partition interval

```sql
-- For automation_logs: Switch from monthly to weekly partitions
-- (Requires migration - contact backend team)
```

---

### Issue: Constraint Violation on Partition

**Symptom:**
```
ERROR: new row for relation "automation_logs_2026_01" violates check constraint
```

**Diagnosis:**
```sql
-- Check partition constraints
SELECT
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'automation_logs_2026_01'::regclass;
```

**Solution:** Fix data or adjust constraint definition.

---

### Issue: Duplicate Data Across Partitions

**Symptom:** Same row appears in multiple partitions.

**Diagnosis:**
```sql
-- Find duplicates
SELECT id, COUNT(*)
FROM automation_logs
GROUP BY id
HAVING COUNT(*) > 1;

-- Find which partitions contain the duplicate
SELECT tableoid::regclass AS partition_name, *
FROM automation_logs
WHERE id = '<duplicate-id>';
```

**Solution:**
```sql
-- Delete duplicate from wrong partition
DELETE FROM automation_logs_2026_02
WHERE id = '<duplicate-id>'
  AND created_at < '2026-02-01';
```

---

## Backup and Restore

### Backup Single Partition

```bash
# Backup automation_logs_2026_01 partition
pg_dump -h <host> -U <user> -d <database> \
    -t automation_logs_2026_01 \
    -F custom \
    -f automation_logs_2026_01.dump

# Compress
gzip automation_logs_2026_01.dump
```

---

### Restore Single Partition

```bash
# Restore partition
pg_restore -h <host> -U <user> -d <database> \
    -t automation_logs_2026_01 \
    automation_logs_2026_01.dump.gz

# Verify
psql -h <host> -U <user> -d <database> \
    -c "SELECT COUNT(*) FROM automation_logs_2026_01;"
```

---

### Backup Partition Metadata

```bash
# Backup partition configuration
pg_dump -h <host> -U <user> -d <database> \
    -t partition_config \
    -t partition_audit_log \
    --inserts \
    -f partition_metadata_backup.sql
```

---

## Emergency Procedures

### Emergency: Missing Future Partition (Production Down)

**Symptom:** Application errors, inserts failing due to missing partition.

**Immediate Action:**

```sql
-- 1. Identify missing partition from error message
-- ERROR: no partition of relation "automation_logs" found for row
-- DETAIL: Partition key of the failing row contains (created_at) = (2026-05-15).

-- 2. Create missing partition IMMEDIATELY
CREATE TABLE automation_logs_2026_05 PARTITION OF automation_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- 3. Verify application recovery
-- Check application logs for successful inserts

-- 4. Create next 3 months to prevent recurrence
CREATE TABLE automation_logs_2026_06 PARTITION OF automation_logs
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE automation_logs_2026_07 PARTITION OF automation_logs
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE automation_logs_2026_08 PARTITION OF automation_logs
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```

**Post-Incident:**
- Investigate why automated partition creation failed
- Check ARQ task logs: `docker logs arq-worker`
- Verify cron schedule: `app/worker/scheduler.py`
- Update monitoring alerts

---

### Emergency: Partition Dropped by Mistake

**Symptom:** Data missing, queries return no results for date range.

**Immediate Action:**

```bash
# 1. Stop all writes to affected table (if possible)
# 2. Check if backup exists
aws s3 ls s3://qontinui-backups/daily/automation_logs/

# 3. Restore from most recent backup
pg_restore -h <host> -U <user> -d <database> \
    --data-only \
    -t automation_logs_2026_01 \
    /path/to/backup.dump

# 4. Verify data restoration
psql -h <host> -U <user> -d <database> \
    -c "SELECT COUNT(*) FROM automation_logs_2026_01;"
```

---

### Emergency: Partition Disk Space Full

**Symptom:** Writes failing, disk space alerts.

**Immediate Action:**

```sql
-- 1. Identify largest partitions
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(tablename::regclass) DESC
LIMIT 20;

-- 2. Archive old partitions to S3 (see section above)

-- 3. Drop archived partitions to free space
-- (Only after confirming S3 upload success)

-- 4. Run VACUUM to reclaim space
VACUUM FULL automation_logs_2024_01;
```

---

## Best Practices

1. **Always create future partitions 3 months in advance**
2. **Never drop a partition without archiving to S3 first**
3. **Test partition operations in staging before production**
4. **Monitor partition sizes weekly** (see PARTITION_MONITORING.md)
5. **Verify partition coverage daily** (automated alert)
6. **Document all manual partition operations** in partition_audit_log
7. **Keep partition naming consistent** (YYYY_MM, YYYY_WW, YYYY_QQ)
8. **Use batch operations** when creating/dropping multiple partitions
9. **Compress archives** before uploading to S3 (use Parquet with snappy)
10. **Test restore procedures quarterly** to ensure backups work

---

## Related Documentation

- [PARTITIONING.md](./PARTITIONING.md) - Overall strategy and architecture
- [PARTITION_MONITORING.md](./PARTITION_MONITORING.md) - Monitoring and alerting
- [AWS_RDS_BACKUP_GUIDE.md](../AWS_RDS_BACKUP_GUIDE.md) - RDS backup procedures

---

**Document Status:** DRAFT - Pending Operations Team Review
**Next Review Date:** 2026-01-15
**Maintained By:** Backend Team

**Change Log:**
- 2025-11-21: Initial draft created
