# Partition Management Quick Reference

## Quick Commands

### Run the Migration
```bash
cd qontinui-web/backend
alembic upgrade head
```

### Rollback the Migration
```bash
alembic downgrade -1
```

### Check Current Partitions (SQL)
```sql
-- List all partitions for a table
SELECT tablename FROM pg_tables
WHERE tablename LIKE 'automation_logs_y%'
ORDER BY tablename;

-- Check partition sizes
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'automation_logs_y%'
ORDER BY tablename;
```

## Python API

### Create Monthly Partition
```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import create_monthly_partition

async with AsyncSessionLocal() as db:
    result = await create_monthly_partition(db, "automation_logs", 2025, 12)
```

### Create Weekly Partition
```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import create_weekly_partition
from datetime import datetime

async with AsyncSessionLocal() as db:
    result = await create_weekly_partition(
        db, "automation_input_events", datetime(2025, 12, 15)
    )
```

### List Partitions
```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import list_partitions

async with AsyncSessionLocal() as db:
    partitions = await list_partitions(db, "automation_logs")
    for p in partitions:
        print(f"{p['partition_name']}: {p['row_count']} rows, {p['size_mb']} MB")
```

### Drop Old Partitions (Dry Run)
```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import drop_old_partitions

# Preview only
async with AsyncSessionLocal() as db:
    result = await drop_old_partitions(db, "automation_logs", dry_run=True)
    print(f"Would delete: {result['partitions_to_delete']}")
```

### Drop Old Partitions (Execute)
```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import drop_old_partitions

# Actually delete
async with AsyncSessionLocal() as db:
    result = await drop_old_partitions(db, "automation_logs", dry_run=False)
    print(f"Deleted: {result['partitions_deleted']}")
```

## ARQ Background Tasks

### Manually Trigger Auto-Creation
```python
from app.worker.arq_pool import arq_pool

job = await arq_pool.enqueue_job("auto_create_partitions")
result = await job.result()
print(f"Created {result['total_created']} partitions")
```

### Manually Trigger Cleanup
```python
from app.worker.arq_pool import arq_pool

job = await arq_pool.enqueue_job("cleanup_old_partitions")
result = await job.result()
print(f"Deleted {result['total_partitions_deleted']} partitions")
```

### Get Partition Statistics
```python
from app.worker.arq_pool import arq_pool

job = await arq_pool.enqueue_job("get_partition_statistics")
result = await job.result()
for table_name, stats in result['tables'].items():
    print(f"{table_name}: {stats['total_partitions']} partitions")
```

## Configuration

### Partition Config (app/db/partition_manager.py)
```python
PARTITION_CONFIG = {
    "automation_logs": {
        "granularity": "monthly",
        "partition_key": "created_at",
        "retention_months": 12,
    },
    "analytics_events": {
        "granularity": "monthly",
        "partition_key": "timestamp",
        "retention_months": 6,
    },
    "automation_input_events": {
        "granularity": "weekly",
        "partition_key": "timestamp",
        "retention_months": 3,
    },
}
```

### Environment Variable (.env)
```bash
PARTITION_ENABLED=True  # Optional, defaults to True
```

## Automated Schedule

Background tasks run weekly on Sundays via ARQ:
- **1 AM UTC**: Auto-create future partitions
- **3 AM UTC**: Cleanup old partitions

## Partition Naming

### Monthly Partitions
- Format: `{table}_y{year}_m{month}`
- Example: `automation_logs_y2025_m11`

### Weekly Partitions
- Format: `{table}_y{year}_w{week}`
- Example: `automation_input_events_y2025_w47`
- Uses ISO week number (1-53)

## Retention Policies

| Table | Granularity | Retention |
|-------|-------------|-----------|
| automation_logs | Monthly | 12 months |
| analytics_events | Monthly | 6 months |
| automation_input_events | Weekly | 3 months |

## Common SQL Queries

### Query with Partition Pruning
```sql
-- PostgreSQL automatically routes to correct partition
SELECT * FROM automation_logs
WHERE created_at >= '2025-11-01'
AND created_at < '2025-12-01';
```

### Query Specific Partition
```sql
SELECT COUNT(*) FROM automation_logs_y2025_m11;
```

### View Partition Boundaries
```sql
SELECT
    c.relname AS partition_name,
    pg_get_expr(c.relpartbound, c.oid) AS partition_expression
FROM pg_class c
JOIN pg_inherits i ON i.inhrelid = c.oid
JOIN pg_class parent ON i.inhparent = parent.oid
WHERE parent.relname = 'automation_logs'
ORDER BY c.relname;
```

### Check Query Plan (Verify Partition Pruning)
```sql
EXPLAIN ANALYZE
SELECT * FROM automation_logs
WHERE created_at >= '2025-11-01'
AND created_at < '2025-12-01';
-- Should show scan on specific partition, not all partitions
```

## Monitoring

### Check Worker Logs
```bash
tail -f logs/worker.log | grep partition
```

### Check Specific Events
```bash
grep "auto_create_partitions_completed" logs/worker.log
grep "cleanup_old_partitions_completed" logs/worker.log
grep "partition_created" logs/worker.log
grep "partition_dropped" logs/worker.log
```

## Troubleshooting

### Error: "no partition of relation found for row"
**Solution**: Create missing partition
```python
# For monthly partition
await create_monthly_partition(db, "automation_logs", 2025, 12)

# For weekly partition
await create_weekly_partition(db, "automation_input_events", datetime(2025, 12, 15))
```

### Error: "table already exists"
**Solution**: Partition already exists, safe to ignore

### Slow Queries After Migration
**Solution**: Ensure partition pruning is working
```sql
EXPLAIN SELECT * FROM automation_logs
WHERE created_at >= '2025-11-01';
-- Should show "Seq Scan on automation_logs_y2025_m11"
-- NOT "Seq Scan on automation_logs"
```

### Missing Partitions
**Solution**: Run auto-creation task
```python
from app.worker.arq_pool import arq_pool
job = await arq_pool.enqueue_job("auto_create_partitions")
result = await job.result()
```

## Files Reference

- **Core Module**: `/app/db/partition_manager.py`
- **Background Tasks**: `/app/worker/tasks/partition_tasks.py`
- **Migration**: `/alembic/versions/20251121_enable_table_partitioning.py`
- **Worker Config**: `/app/worker/settings.py`
- **Full Guide**: `/PARTITION_MANAGEMENT_GUIDE.md`
- **Implementation Summary**: `/PARTITION_IMPLEMENTATION_SUMMARY.md`

## Support Resources

- PostgreSQL Docs: https://www.postgresql.org/docs/current/ddl-partitioning.html
- ARQ Docs: https://arq-docs.helpmanual.io/
- SQLAlchemy Async: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
