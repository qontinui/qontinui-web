# Time-Series Partition Management System

## Overview

The qontinui-web backend now includes a comprehensive partition management system for high-volume PostgreSQL tables. This system automatically manages table partitions to optimize query performance and storage for tables that will reach 500M+ rows/year.

## Architecture

### Partitioned Tables

| Table | Partition Strategy | Retention Period | Key Column |
|-------|-------------------|------------------|------------|
| `automation_logs` | Monthly | 12 months | `created_at` |
| `analytics_events` | Monthly | 6 months | `timestamp` |
| `automation_input_events` | Weekly | 3 months | `timestamp` |

### Key Components

1. **Partition Manager** (`app/db/partition_manager.py`)
   - Core partition operations (create, list, drop)
   - Boundary calculations for monthly/weekly partitions
   - Configuration management

2. **Partition Tasks** (`app/worker/tasks/partition_tasks.py`)
   - ARQ background tasks for automation
   - Auto-creation of future partitions
   - Cleanup of old partitions
   - Statistics gathering

3. **Alembic Migration** (`alembic/versions/20251121_enable_table_partitioning.py`)
   - Converts existing tables to partitioned tables
   - Creates initial partitions
   - Preserves all data and indexes

## Installation

### Step 1: Run the Migration

```bash
cd /mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/backend
alembic upgrade head
```

The migration will:
- Convert tables to partitioned tables using PostgreSQL native partitioning
- Create initial partitions for current month + next 2 months
- Migrate all existing data
- Recreate all indexes and constraints

### Step 2: Restart ARQ Worker

The partition tasks are automatically registered with the ARQ worker. Simply restart it:

```bash
python run_worker.py
```

The worker will now run partition maintenance tasks weekly on Sundays:
- 1 AM UTC: Auto-create future partitions
- 3 AM UTC: Cleanup old partitions

## Usage Examples

### Manual Partition Management

#### Create Partitions Programmatically

```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import (
    create_monthly_partition,
    create_weekly_partition
)
from datetime import datetime

# Create a monthly partition for automation_logs
async with AsyncSessionLocal() as db:
    result = await create_monthly_partition(
        db,
        "automation_logs",
        year=2025,
        month=12
    )
    print(result)
    # {
    #     "status": "created",
    #     "partition_name": "automation_logs_y2025_m12",
    #     "table_name": "automation_logs",
    #     "start_date": "2025-12-01T00:00:00",
    #     "end_date": "2026-01-01T00:00:00"
    # }

# Create a weekly partition for automation_input_events
async with AsyncSessionLocal() as db:
    result = await create_weekly_partition(
        db,
        "automation_input_events",
        reference_date=datetime(2025, 12, 15)
    )
    print(result)
    # {
    #     "status": "created",
    #     "partition_name": "automation_input_events_y2025_w50",
    #     "table_name": "automation_input_events",
    #     "start_date": "2025-12-15T00:00:00",
    #     "end_date": "2025-12-22T00:00:00"
    # }
```

#### List Existing Partitions

```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import list_partitions

async with AsyncSessionLocal() as db:
    partitions = await list_partitions(db, "automation_logs")

    for partition in partitions:
        print(f"{partition['partition_name']}: "
              f"{partition['row_count']} rows, "
              f"{partition['size_mb']} MB")
    # automation_logs_y2025_m11: 15000 rows, 1.5 MB
    # automation_logs_y2025_m12: 8500 rows, 0.8 MB
```

#### Drop Old Partitions (with Dry Run)

```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import drop_old_partitions

# Dry run (preview only)
async with AsyncSessionLocal() as db:
    result = await drop_old_partitions(
        db,
        "automation_logs",
        dry_run=True
    )
    print(f"Would delete {len(result['partitions_to_delete'])} partitions")
    print(f"Total rows: {result['total_rows_to_delete']}")

# Actually delete (use with caution!)
async with AsyncSessionLocal() as db:
    result = await drop_old_partitions(
        db,
        "automation_logs",
        dry_run=False
    )
    print(f"Deleted {len(result['partitions_deleted'])} partitions")
```

### Running Background Tasks Manually

You can trigger partition tasks manually using ARQ:

```python
from app.worker.arq_pool import arq_pool

# Auto-create future partitions
job = await arq_pool.enqueue_job("auto_create_partitions")
result = await job.result()
print(f"Created {result['total_created']} partitions")

# Cleanup old partitions
job = await arq_pool.enqueue_job("cleanup_old_partitions")
result = await job.result()
print(f"Deleted {result['total_partitions_deleted']} partitions")

# Get partition statistics
job = await arq_pool.enqueue_job("get_partition_statistics")
result = await job.result()
for table_name, stats in result['tables'].items():
    print(f"{table_name}: {stats['total_partitions']} partitions, "
          f"{stats['total_rows']} rows, {stats['total_size_mb']} MB")
```

### SQL Direct Access

Since we use PostgreSQL native partitioning, you can query partitions directly:

```sql
-- Query all data (partition routing is automatic)
SELECT COUNT(*) FROM automation_logs
WHERE created_at >= '2025-11-01';

-- Query specific partition
SELECT COUNT(*) FROM automation_logs_y2025_m11;

-- List all partitions
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'automation_logs_y%'
ORDER BY tablename;

-- View partition boundaries
SELECT
    c.relname AS partition_name,
    pg_get_expr(c.relpartbound, c.oid) AS partition_expression
FROM pg_class c
JOIN pg_inherits i ON i.inhrelid = c.oid
JOIN pg_class parent ON i.inhparent = parent.oid
WHERE parent.relname = 'automation_logs'
ORDER BY c.relname;
```

## Configuration

### Partition Settings

Partition configuration is defined in `app/db/partition_manager.py`:

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

### Environment Variables

Add to your `.env` file:

```bash
# Partition management (optional, defaults to True)
PARTITION_ENABLED=True
```

### Modifying Retention Policies

To change retention periods, edit `PARTITION_CONFIG` in `partition_manager.py` and restart the ARQ worker.

## Monitoring

### Check Partition Health

```python
from app.db.session import AsyncSessionLocal
from app.db.partition_manager import list_partitions

async def check_partition_health():
    """Check if partitions exist for the next 3 months."""
    async with AsyncSessionLocal() as db:
        for table_name in ["automation_logs", "analytics_events"]:
            partitions = await list_partitions(db, table_name)
            print(f"\n{table_name}:")
            print(f"  Total partitions: {len(partitions)}")

            if partitions:
                latest = partitions[-1]['partition_name']
                print(f"  Latest partition: {latest}")
```

### ARQ Job Monitoring

Check ARQ job results in Redis or via logs:

```bash
# Check worker logs
tail -f logs/worker.log | grep partition

# Monitor with structlog
grep "auto_create_partitions_completed" logs/worker.log
grep "cleanup_old_partitions_completed" logs/worker.log
```

## Performance Benefits

### Before Partitioning (Single Table)

- **Query Performance**: Full table scans for date-range queries
- **Index Size**: Massive B-tree indexes (GBs)
- **Maintenance**: Slow VACUUM, ANALYZE operations
- **Deletion**: Expensive DELETE operations

### After Partitioning

- **Query Performance**: 10-100x faster for date-range queries (partition pruning)
- **Index Size**: Smaller indexes per partition
- **Maintenance**: Parallel VACUUM per partition
- **Deletion**: Instant partition drops (DROP TABLE vs DELETE)

### Example Query Performance

```sql
-- Without partitioning
EXPLAIN ANALYZE
SELECT * FROM automation_logs
WHERE created_at >= '2025-11-01'
AND created_at < '2025-12-01';
-- Seq Scan on automation_logs (cost=0.00..500000.00 rows=100000)
-- Planning Time: 2.5 ms
-- Execution Time: 1250.3 ms

-- With partitioning (only scans relevant partition)
EXPLAIN ANALYZE
SELECT * FROM automation_logs
WHERE created_at >= '2025-11-01'
AND created_at < '2025-12-01';
-- Seq Scan on automation_logs_y2025_m11 (cost=0.00..5000.00 rows=100000)
-- Planning Time: 0.8 ms
-- Execution Time: 125.1 ms  ← 10x faster!
```

## Troubleshooting

### Migration Issues

**Error: "table already exists"**
- The migration checks for existing tables and skips them
- If you see this error, the table may have been partially migrated
- Check existing tables: `SELECT tablename FROM pg_tables WHERE tablename LIKE '%_new';`
- Clean up manually if needed: `DROP TABLE IF EXISTS automation_logs_new CASCADE;`

**Error: "partition constraint violated"**
- Data exists outside the current partition range
- Create missing partitions manually before migration
- Or temporarily adjust partition creation logic

### Runtime Issues

**Error: "no partition of relation found for row"**
- Data doesn't fit in any existing partition
- Run `auto_create_partitions` to create missing partitions
- Or create specific partition manually

**Slow Partition Creation**
- Large tables may take time to migrate
- Monitor with: `SELECT COUNT(*) FROM automation_logs_new;`
- Consider creating partitions in batches

### ARQ Task Failures

Check ARQ job results:

```python
from app.worker.arq_pool import arq_pool

# List recent jobs
jobs = await arq_pool.redis.keys("arq:job:*")
for job_key in jobs:
    job_info = await arq_pool.redis.hgetall(job_key)
    print(job_info)
```

## Best Practices

1. **Always Use Dry Run First**
   ```python
   # Preview deletions before executing
   result = await drop_old_partitions(db, table_name, dry_run=True)
   ```

2. **Monitor Partition Growth**
   - Set up alerts for partition count
   - Monitor partition sizes
   - Adjust retention policies as needed

3. **Create Partitions in Advance**
   - Auto-creation runs weekly
   - Manually create partitions before high-traffic events

4. **Backup Before Major Operations**
   ```bash
   # Backup before running partition migration
   pg_dump -h localhost -U qontinui_user qontinui_db > backup_before_partitioning.sql
   ```

5. **Test in Staging First**
   - Run migration on staging database
   - Verify query performance
   - Check application compatibility

## Rollback

If you need to revert partitioning:

```bash
# Downgrade the migration
alembic downgrade -1
```

This will:
1. Create regular tables
2. Copy all data from partitioned tables
3. Recreate indexes
4. Drop partitioned tables

**Note**: Downgrade preserves all data but may take significant time for large tables.

## Support

For issues or questions:
1. Check logs: `logs/worker.log`, `logs/app.log`
2. Review partition statistics: Run `get_partition_statistics` task
3. Consult PostgreSQL documentation: https://www.postgresql.org/docs/current/ddl-partitioning.html

## Future Enhancements

Potential improvements for future versions:

1. **Partition Archival**: Archive old partitions to S3 before deletion
2. **Compression**: Enable partition-level compression
3. **Parallel Queries**: Optimize for parallel partition scanning
4. **Sub-partitioning**: Add list sub-partitioning by user_id for multi-tenancy
5. **Monitoring Dashboard**: Web UI for partition health visualization
6. **Smart Retention**: AI-based retention policy recommendations

## References

- PostgreSQL Partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html
- Range Partitioning: https://www.postgresql.org/docs/current/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE
- ARQ Documentation: https://arq-docs.helpmanual.io/
- SQLAlchemy Async: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
