# Cleanup Tasks Implementation Documentation

## Overview

This document describes the implementation of automated data cleanup and archival tasks for the qontinui-web backend. These tasks manage database growth by archiving old data to S3 in Parquet format and removing it from PostgreSQL.

## Implementation Date

Implemented: November 2025

## Tasks Implemented

### 1. cleanup_old_automation_data

**Purpose:** Archive automation session data older than 180 days to S3 and delete from PostgreSQL.

**What Gets Archived:**
- Automation sessions
- Automation logs
- Automation screenshots (metadata only, not actual image files)
- Automation input events (mouse, keyboard interactions)

**Retention Policy:**
- Database: 180 days
- S3 Archive: Indefinite (until manually deleted)

**S3 Archive Structure:**
```
archives/automation/{year}/{month}/
  ├── sessions_{YYYYMMDD}.parquet
  ├── logs_{YYYYMMDD}.parquet
  ├── screenshots_{YYYYMMDD}.parquet
  └── input_events_{YYYYMMDD}.parquet
```

**Example S3 Paths:**
```
archives/automation/2025/11/sessions_20251121.parquet
archives/automation/2025/11/logs_20251121.parquet
archives/automation/2025/11/screenshots_20251121.parquet
archives/automation/2025/11/input_events_20251121.parquet
```

**Data Integrity Features:**
- 3 retry attempts for S3 uploads
- Database deletion only occurs after ALL S3 uploads succeed
- Comprehensive error logging with structlog
- Returns detailed statistics on archived and deleted records

**Output Example:**
```json
{
  "status": "success",
  "task": "cleanup_old_automation_data",
  "sessions_archived": 42,
  "logs_archived": 1523,
  "screenshots_archived": 856,
  "input_events_archived": 3401,
  "total_records_deleted": 5822,
  "failed_uploads": 0,
  "upload_results": {
    "sessions": {"success": true, "s3_key": "archives/automation/2025/11/sessions_20251121.parquet", "record_count": 42},
    "logs": {"success": true, "s3_key": "archives/automation/2025/11/logs_20251121.parquet", "record_count": 1523},
    "screenshots": {"success": true, "s3_key": "archives/automation/2025/11/screenshots_20251121.parquet", "record_count": 856},
    "input_events": {"success": true, "s3_key": "archives/automation/2025/11/input_events_20251121.parquet", "record_count": 3401}
  },
  "cutoff_date": "2025-05-24T00:00:00",
  "execution_time_seconds": 12.45,
  "timestamp": "2025-11-21T02:00:00"
}
```

### 2. archive_old_analytics_to_s3

**Purpose:** Archive analytics events older than 90 days to S3 with daily aggregation summaries.

**What Gets Archived:**
- Detailed analytics events (raw data)
- Daily aggregated summaries (event counts by type, unique users)

**Retention Policy:**
- Database: 90 days (configurable via `CLEANUP_ANALYTICS_DAYS`)
- S3 Archive: Indefinite (until manually deleted)

**S3 Archive Structure:**
```
archives/analytics/{year}/{month}/
  ├── events_{YYYYMMDD}.parquet
  └── daily_summary_{YYYYMMDD}.parquet
```

**Example S3 Paths:**
```
archives/analytics/2025/11/events_20251121.parquet
archives/analytics/2025/11/daily_summary_20251121.parquet
```

**Aggregation Details:**

The daily summary includes:
- Date of events
- Event name (e.g., "user_login", "project_created")
- Event count (total occurrences)
- Unique users (distinct user_id count)

**Daily Summary Schema:**
| Column | Type | Description |
|--------|------|-------------|
| date | date | Date of the events |
| event_name | string | Name of the event |
| event_count | int | Number of times event occurred |
| unique_users | int | Number of unique users |

**Data Integrity Features:**
- 3 retry attempts for S3 uploads
- Database deletion only occurs after ALL S3 uploads succeed
- Handles events without user_id (system events)
- Comprehensive error logging with structlog

**Output Example:**
```json
{
  "status": "success",
  "task": "archive_old_analytics_to_s3",
  "events_archived": 15420,
  "events_deleted": 15420,
  "failed_uploads": 0,
  "upload_results": {
    "events": {"success": true, "s3_key": "archives/analytics/2025/11/events_20251121.parquet", "record_count": 15420},
    "daily_summary": {"success": true, "s3_key": "archives/analytics/2025/11/daily_summary_20251121.parquet", "record_count": 247}
  },
  "cutoff_date": "2025-08-23T00:00:00",
  "days_to_keep": 90,
  "execution_time_seconds": 8.32,
  "timestamp": "2025-11-21T02:00:00"
}
```

## Scheduling

### ARQ Worker Configuration

Both tasks are registered in the ARQ worker (`app/worker/settings.py`) and can be queued individually or run as part of the daily cleanup job.

**Individual Task Queuing:**
```python
from arq import create_pool
from app.worker.settings import WorkerSettings

pool = await create_pool(WorkerSettings.redis_settings)

# Queue automation data cleanup
await pool.enqueue_job('cleanup_old_automation_data')

# Queue analytics archival
await pool.enqueue_job('archive_old_analytics_to_s3')
```

### Automated Daily Cleanup

Both tasks are included in the `run_all_cleanup_tasks` scheduler function, which runs all cleanup tasks sequentially.

**Default Schedule:** Daily at 2:00 AM UTC

**Cron Configuration:** Set via `CLEANUP_SCHEDULE` environment variable
- Format: `minute hour day month weekday`
- Default: `0 2 * * *` (2 AM UTC daily)
- Examples:
  - `0 3 * * *` - 3 AM UTC daily
  - `0 2 * * 0` - 2 AM UTC every Sunday
  - `0 4 1 * *` - 4 AM UTC on the 1st of each month

**Enable/Disable:** Set via `CLEANUP_ENABLED` environment variable
- `true` - Cleanup tasks run automatically
- `false` - Cleanup tasks disabled

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLEANUP_ENABLED` | `true` | Enable/disable automatic cleanup |
| `CLEANUP_SCHEDULE` | `0 2 * * *` | Cron schedule for cleanup jobs |
| `CLEANUP_ANALYTICS_DAYS` | `90` | Days to keep analytics events |
| `STORAGE_BACKEND` | `local` | Storage backend: local, s3, minio |
| `STORAGE_BUCKET_NAME` | `qontinui` | S3/MinIO bucket name |
| `STORAGE_REGION` | `us-east-1` | AWS region |
| `STORAGE_ACCESS_KEY` | - | S3/MinIO access key |
| `STORAGE_SECRET_KEY` | - | S3/MinIO secret key |

### Retention Policies

| Data Type | Database Retention | Notes |
|-----------|-------------------|-------|
| Automation Sessions | 180 days | Hardcoded in function |
| Analytics Events | 90 days | Configurable via `CLEANUP_ANALYTICS_DAYS` |
| Session Activity | Expired sessions | Based on `absolute_expiry_at` |
| Device Sessions | 90 days | Configurable via `CLEANUP_SESSION_DAYS` |

## Dependencies

### New Dependencies Added

```toml
pandas = "^2.2.0"
pyarrow = "^15.0.0"
```

**Install with Poetry:**
```bash
cd backend
poetry add pandas pyarrow
```

### Existing Dependencies Used

- `boto3` - S3 interactions
- `structlog` - Structured logging
- `sqlalchemy` - Database queries
- `arq` - Task queue

## Data Format: Parquet

### Why Parquet?

1. **Compression:** 5-10x smaller than JSON/CSV
2. **Query Performance:** Columnar format allows efficient filtering
3. **Schema Enforcement:** Maintains data types
4. **Industry Standard:** Widely supported by analytics tools

### Compression Settings

- **Engine:** PyArrow
- **Compression:** Snappy (good balance of speed and compression)
- **Index:** Not included (reduces file size)

### Reading Archived Data

**Python (pandas):**
```python
import pandas as pd
import boto3
from io import BytesIO

# Download from S3
s3 = boto3.client('s3')
obj = s3.get_object(Bucket='qontinui', Key='archives/automation/2025/11/sessions_20251121.parquet')
parquet_data = obj['Body'].read()

# Load into DataFrame
df = pd.read_parquet(BytesIO(parquet_data))
print(df.head())
```

**Python (pyarrow):**
```python
import pyarrow.parquet as pq
import boto3
from io import BytesIO

# Download and read
s3 = boto3.client('s3')
obj = s3.get_object(Bucket='qontinui', Key='archives/analytics/2025/11/daily_summary_20251121.parquet')
parquet_data = obj['Body'].read()

table = pq.read_table(BytesIO(parquet_data))
df = table.to_pandas()
print(df)
```

**AWS Athena:** (for SQL queries on S3 data)
```sql
CREATE EXTERNAL TABLE automation_sessions_archive (
  id VARCHAR(36),
  user_id VARCHAR(36),
  status VARCHAR(50),
  created_at TIMESTAMP,
  ...
)
STORED AS PARQUET
LOCATION 's3://qontinui/archives/automation/'
```

## Monitoring and Logs

### Structured Logging

All tasks use structlog for comprehensive logging:

**Log Events:**
- `cleanup_old_automation_data_started`
- `found_old_automation_sessions` (with count)
- `sessions_archived_to_s3` (with S3 key, record count)
- `logs_archived_to_s3`
- `screenshots_archived_to_s3`
- `input_events_archived_to_s3`
- `automation_data_deleted_from_database`
- `cleanup_old_automation_data_completed`
- `cleanup_old_automation_data_failed` (on errors)

**Log Fields:**
- `task_name`
- `cutoff_date`
- `s3_key`
- `record_count`
- `execution_time_seconds`
- `error` (if failed)
- `error_type` (if failed)

### Monitoring Task Results

**View in Redis:**
```bash
redis-cli
KEYS arq:*
GET arq:result:{job_id}
```

**Programmatically:**
```python
from arq import create_pool
from app.worker.settings import WorkerSettings

pool = await create_pool(WorkerSettings.redis_settings)
job = await pool.enqueue_job('cleanup_old_automation_data')
result = await job.result(timeout=300)
print(result)
```

## Error Handling

### S3 Upload Failures

**Retry Logic:**
- 3 automatic retries with exponential backoff
- Logs warning on each retry attempt
- Logs error if all retries fail

**Database Protection:**
- Database deletion is SKIPPED if any S3 upload fails
- Ensures data is never lost
- Returns `partial_success` status

**Example Error Response:**
```json
{
  "status": "partial_success",
  "task": "cleanup_old_automation_data",
  "sessions_archived": 0,
  "failed_uploads": 2,
  "upload_results": {
    "sessions": {"success": true, "s3_key": "...", "record_count": 42},
    "logs": {"success": false, "error": "Connection timeout"}
  }
}
```

### Database Query Failures

**Handled Gracefully:**
- Wrapped in try-except blocks
- Returns error status with exception details
- Logs full traceback with structlog
- Does not crash worker

## Testing

### Manual Testing

**1. Install dependencies:**
```bash
cd backend
poetry install
```

**2. Ensure Redis is running:**
```bash
docker-compose -f docker-compose.dev.yml up -d redis
```

**3. Start ARQ worker:**
```bash
poetry run arq app.worker.settings.WorkerSettings
```

**4. Queue a task (in another terminal):**
```python
import asyncio
from arq import create_pool
from app.worker.settings import WorkerSettings

async def test():
    pool = await create_pool(WorkerSettings.redis_settings)
    job = await pool.enqueue_job('cleanup_old_automation_data')
    print(f"Job queued: {job.job_id}")
    result = await job.result(timeout=300)
    print(f"Result: {result}")

asyncio.run(test())
```

### Verify S3 Archives

**AWS CLI:**
```bash
# List archives
aws s3 ls s3://qontinui/archives/automation/2025/11/ --recursive

# Download archive
aws s3 cp s3://qontinui/archives/automation/2025/11/sessions_20251121.parquet .

# Verify with Python
python -c "import pandas as pd; df = pd.read_parquet('sessions_20251121.parquet'); print(df.info())"
```

## Performance Considerations

### Database Impact

**Query Optimization:**
- Uses indexed columns (`created_at`, `timestamp`)
- Eager loads related data with `selectinload()` to avoid N+1 queries
- Deletes in batches using `WHERE IN` clauses

**Estimated Performance:**
- 1000 sessions: ~5-10 seconds
- 10000 sessions: ~30-60 seconds
- 100000 sessions: ~5-10 minutes

### S3 Upload Performance

**Compression Benefits:**
- Raw JSON: ~1 MB per 1000 records
- Parquet (Snappy): ~100-200 KB per 1000 records
- ~80-90% size reduction

**Upload Speed:**
- Depends on network bandwidth
- ~1-5 MB/s typical
- Retry logic handles temporary network issues

## Troubleshooting

### Task Not Running

**Check:**
1. Is Redis running? `docker ps | grep redis`
2. Is ARQ worker running? `ps aux | grep arq`
3. Is cleanup enabled? Check `CLEANUP_ENABLED` env var
4. Check worker logs for errors

### S3 Upload Failures

**Common Issues:**
1. **Access denied:** Check `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY`
2. **Bucket not found:** Verify `STORAGE_BUCKET_NAME` exists
3. **Region mismatch:** Check `STORAGE_REGION` matches bucket region
4. **Network timeout:** Increase retry timeout in code

**Debug Steps:**
```bash
# Test S3 credentials
aws s3 ls s3://qontinui/ --profile your-profile

# Check bucket permissions
aws s3api get-bucket-policy --bucket qontinui

# Verify network connectivity
ping s3.amazonaws.com
```

### Database Performance Issues

**If cleanup is slow:**
1. Check database indexes on `created_at` and `timestamp` columns
2. Run `VACUUM ANALYZE` on affected tables
3. Consider running cleanup during off-peak hours
4. Increase `job_timeout` in worker settings

## Security Considerations

### S3 Bucket Security

**Recommended Settings:**
1. Enable server-side encryption (SSE-S3 or SSE-KMS)
2. Block public access
3. Enable versioning for disaster recovery
4. Set up lifecycle policies for long-term cost management

**Example Lifecycle Policy:**
```json
{
  "Rules": [
    {
      "Id": "Archive old data to Glacier",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "archives/"
      },
      "Transitions": [
        {
          "Days": 365,
          "StorageClass": "GLACIER"
        }
      ]
    }
  ]
}
```

### Data Privacy

**PII Considerations:**
- Automation logs may contain user input data
- Analytics events include user IDs
- Ensure archived data complies with GDPR/privacy policies
- Consider anonymizing data before archival if required

## Future Enhancements

### Potential Improvements

1. **Incremental Archival:** Archive data continuously instead of daily batches
2. **Compression Tuning:** Experiment with different compression algorithms (zstd, gzip)
3. **Partitioning:** Partition Parquet files by user_id or project_id for faster queries
4. **Data Validation:** Add schema validation before/after archival
5. **Restore Function:** Implement function to restore archived data back to database
6. **Analytics Dashboard:** Create dashboard to visualize archived data trends
7. **Cost Optimization:** Automatically move old archives to S3 Glacier

### Metrics to Track

1. **Storage Savings:** Track database size reduction over time
2. **Archive Growth:** Monitor S3 bucket size and costs
3. **Task Duration:** Track execution time trends
4. **Failure Rate:** Monitor upload/deletion failure rates
5. **Data Volume:** Track records archived per day

## Contact and Support

For questions or issues related to cleanup tasks:
- Check logs in structlog format
- Review ARQ worker output
- Consult this documentation
- Contact backend team

## Change Log

### Version 1.0 (November 2025)
- Initial implementation
- Added `cleanup_old_automation_data` task (180-day retention)
- Added `archive_old_analytics_to_s3` task (90-day retention)
- Parquet format with Snappy compression
- 3-retry upload logic
- Integrated with ARQ worker and cron scheduler
