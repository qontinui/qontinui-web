# Database Partition Monitoring Guide
## Qontinui Web Platform - Observability & Alerting

**Document Version:** 1.0
**Last Updated:** 2025-11-21
**Audience:** DevOps, SRE, Backend Engineers
**Related:** [PARTITIONING.md](./PARTITIONING.md), [PARTITION_MAINTENANCE.md](./PARTITION_MAINTENANCE.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Key Metrics to Monitor](#key-metrics-to-monitor)
3. [Monitoring Partition Creation](#monitoring-partition-creation)
4. [Alert Configurations](#alert-configurations)
5. [Dashboard Queries](#dashboard-queries)
6. [ARQ Task Monitoring](#arq-task-monitoring)
7. [Performance Metrics](#performance-metrics)
8. [Disk Space Monitoring](#disk-space-monitoring)
9. [Troubleshooting Alerts](#troubleshooting-alerts)

---

## Overview

Effective monitoring of database partitions is critical to prevent:
- **Missing partition errors** (application downtime)
- **Disk space exhaustion** (write failures)
- **Query performance degradation** (slow user experience)
- **Failed automated tasks** (data retention issues)

This guide provides monitoring queries, alert configurations, and dashboard setups for comprehensive partition observability.

---

## Key Metrics to Monitor

### Critical Metrics (Alert Immediately)

| Metric | Threshold | Impact | Alert Priority |
|--------|-----------|--------|----------------|
| Missing future partitions | < 7 days coverage | **Application failure** | P0 - CRITICAL |
| Partition creation failures | > 0 failures/day | **Future downtime risk** | P0 - CRITICAL |
| Partition size | > 50GB single partition | **Performance degradation** | P1 - HIGH |
| Disk space per partition | > 80% utilization | **Write failures** | P1 - HIGH |

### Important Metrics (Alert Within 4 Hours)

| Metric | Threshold | Impact | Alert Priority |
|--------|-----------|--------|---|
| Partition row count | > 100M rows/partition | **Slow queries** | P2 - MEDIUM |
| Partition drop failures | > 0 failures/day | **Disk space exhaustion** | P2 - MEDIUM |
| Archive to S3 failures | > 0 failures/day | **Data retention issues** | P2 - MEDIUM |
| Query performance | > 2x baseline latency | **User experience** | P2 - MEDIUM |

### Informational Metrics (Daily Review)

| Metric | Threshold | Impact | Alert Priority |
|--------|-----------|--------|---|
| Total partition count | Trend monitoring | Capacity planning | P3 - INFO |
| Partition growth rate | Trend monitoring | Capacity planning | P3 - INFO |
| Archive storage size (S3) | Trend monitoring | Cost optimization | P3 - INFO |
| Vacuum operations | Track duration | Performance tuning | P3 - INFO |

---

## Monitoring Partition Creation

### Check Future Partition Coverage

**Query:** Verify next 90 days of partitions exist

```sql
-- Query: automation_logs partition coverage (monthly)
WITH expected_partitions AS (
    SELECT
        generate_series(
            date_trunc('month', NOW()),
            date_trunc('month', NOW() + INTERVAL '3 months'),
            INTERVAL '1 month'
        )::date AS expected_start
),
existing_partitions AS (
    SELECT
        child.relname AS partition_name,
        (regexp_match(pg_get_expr(child.relpartbound, child.oid),
            'FROM \(''([^'']+)'))[1]::date AS start_date
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'automation_logs'
)
SELECT
    ep.expected_start,
    (ep.expected_start + INTERVAL '1 month')::date AS expected_end,
    COALESCE(ex.partition_name, 'MISSING') AS partition_name,
    CASE
        WHEN ex.partition_name IS NULL THEN 'MISSING'
        ELSE 'OK'
    END AS status
FROM expected_partitions ep
LEFT JOIN existing_partitions ex ON ep.expected_start = ex.start_date
ORDER BY ep.expected_start;
```

**Expected Output:**
```
 expected_start | expected_end |       partition_name        | status
----------------+--------------+-----------------------------+--------
 2025-11-01     | 2025-12-01   | automation_logs_2025_11     | OK
 2025-12-01     | 2026-01-01   | automation_logs_2025_12     | OK
 2026-01-01     | 2026-02-01   | automation_logs_2026_01     | OK
 2026-02-01     | 2026-03-01   | automation_logs_2026_02     | OK
```

**Alert Condition:**
```sql
-- Alert if any partition in next 7 days is missing
SELECT COUNT(*) AS missing_partitions
FROM (
    WITH expected_partitions AS (
        SELECT generate_series(
            date_trunc('month', NOW()),
            date_trunc('month', NOW() + INTERVAL '7 days'),
            INTERVAL '1 month'
        )::date AS expected_start
    ),
    existing_partitions AS (
        SELECT
            (regexp_match(pg_get_expr(child.relpartbound, child.oid),
                'FROM \(''([^'']+)'))[1]::date AS start_date
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        WHERE parent.relname = 'automation_logs'
    )
    SELECT ep.expected_start
    FROM expected_partitions ep
    LEFT JOIN existing_partitions ex ON ep.expected_start = ex.start_date
    WHERE ex.start_date IS NULL
) missing;

-- If missing_partitions > 0 → ALERT P0
```

---

### Monitor Partition Creation Task

**Query:** Check last partition creation task status

```sql
-- Query: Last 10 partition creation attempts
SELECT
    operation,
    table_name,
    partition_name,
    status,
    details,
    created_at
FROM partition_audit_log
WHERE operation = 'create'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Output:**
```
 operation | table_name    | partition_name              | status  | created_at
-----------|---------------|----------------------------|---------|-------------------
 create    | automation_logs| automation_logs_2026_03     | success | 2025-11-21 02:00:15
 create    | automation_logs| automation_logs_2026_02     | success | 2025-11-21 02:00:12
 create    | analytics_events| analytics_events_2026_03   | success | 2025-11-21 02:00:08
```

**Alert Condition:**
```sql
-- Alert if any partition creation failed in last 24 hours
SELECT COUNT(*) AS failed_creations
FROM partition_audit_log
WHERE operation = 'create'
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours';

-- If failed_creations > 0 → ALERT P0
```

---

## Alert Configurations

### Alert 1: Missing Future Partitions (P0 - CRITICAL)

**Condition:** Partition coverage < 7 days ahead

**Alert Query:**
```sql
-- Check automation_logs coverage
SELECT
    'automation_logs' AS table_name,
    COUNT(*) AS missing_count
FROM (
    WITH expected AS (
        SELECT generate_series(
            date_trunc('month', NOW()),
            date_trunc('month', NOW() + INTERVAL '7 days'),
            INTERVAL '1 month'
        )::date AS expected_start
    ),
    existing AS (
        SELECT (regexp_match(pg_get_expr(child.relpartbound, child.oid),
                'FROM \(''([^'']+)'))[1]::date AS start_date
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        WHERE parent.relname = 'automation_logs'
    )
    SELECT ep.expected_start
    FROM expected ep
    LEFT JOIN existing ex ON ep.expected_start = ex.start_date
    WHERE ex.start_date IS NULL
) missing
WHERE EXISTS (SELECT 1 FROM missing);
```

**Prometheus Alert (if using Postgres Exporter):**
```yaml
- alert: PartitionCoverageCritical
  expr: partition_missing_future_count > 0
  for: 5m
  labels:
    severity: critical
    team: backend
  annotations:
    summary: "Missing future database partitions for {{ $labels.table_name }}"
    description: "Partition coverage is less than 7 days. Application may fail soon."
    runbook: "https://docs.qontinui.com/runbooks/partition-missing"
```

**Actions:**
1. Immediately create missing partitions (see PARTITION_MAINTENANCE.md)
2. Check ARQ worker status: `docker logs arq-worker`
3. Verify cron schedule in `app/worker/scheduler.py`
4. Notify backend team in #alerts-critical Slack channel

---

### Alert 2: Partition Creation Failed (P0 - CRITICAL)

**Condition:** Partition creation task failed in last 24 hours

**Alert Query:**
```sql
SELECT
    table_name,
    partition_name,
    details->>'error' AS error_message,
    created_at
FROM partition_audit_log
WHERE operation = 'create'
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours';
```

**Grafana Alert:**
```json
{
  "alert": "PartitionCreationFailed",
  "expr": "partition_creation_failures_24h > 0",
  "for": "5m",
  "labels": {
    "severity": "critical",
    "team": "backend"
  },
  "annotations": {
    "summary": "Partition creation task failed",
    "description": "Failed to create partition for {{ $labels.table_name }}. Check ARQ logs."
  }
}
```

---

### Alert 3: Partition Size Exceeds Threshold (P1 - HIGH)

**Condition:** Single partition > 50GB

**Alert Query:**
```sql
SELECT
    schemaname,
    tablename AS partition_name,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) AS size,
    pg_total_relation_size(tablename::regclass) AS size_bytes
FROM pg_tables
WHERE tablename LIKE 'automation_logs_%'
  OR tablename LIKE 'automation_input_events_%'
  OR tablename LIKE 'analytics_events_%'
  AND pg_total_relation_size(tablename::regclass) > 50 * 1024 * 1024 * 1024  -- 50GB
ORDER BY size_bytes DESC;
```

**Actions:**
1. Review partition strategy (may need smaller intervals)
2. Check for duplicate data or missing cleanup
3. Consider switching to weekly partitions if using monthly

---

### Alert 4: Disk Space High (P1 - HIGH)

**Condition:** Partition disk usage > 80%

**Alert Query:**
```sql
-- Check total size of all partitions per table
SELECT
    CASE
        WHEN tablename LIKE 'automation_logs_%' THEN 'automation_logs'
        WHEN tablename LIKE 'automation_input_events_%' THEN 'automation_input_events'
        WHEN tablename LIKE 'analytics_events_%' THEN 'analytics_events'
        ELSE 'other'
    END AS base_table,
    COUNT(*) AS partition_count,
    pg_size_pretty(SUM(pg_total_relation_size(tablename::regclass))) AS total_size,
    SUM(pg_total_relation_size(tablename::regclass)) AS total_size_bytes
FROM pg_tables
WHERE tablename LIKE '%_logs_%' OR tablename LIKE '%_events_%'
GROUP BY base_table
ORDER BY total_size_bytes DESC;
```

**AWS CloudWatch Alarm (RDS FreeStorageSpace):**
```json
{
  "AlarmName": "RDS-LowDiskSpace",
  "MetricName": "FreeStorageSpace",
  "Namespace": "AWS/RDS",
  "Statistic": "Average",
  "Period": 300,
  "EvaluationPeriods": 2,
  "Threshold": 21474836480,  // 20GB
  "ComparisonOperator": "LessThanThreshold",
  "AlarmActions": ["arn:aws:sns:eu-central-1:123456789:alerts-critical"]
}
```

---

### Alert 5: Partition Drop Failed (P2 - MEDIUM)

**Condition:** Drop partition task failed

**Alert Query:**
```sql
SELECT
    table_name,
    partition_name,
    details->>'error' AS error_message,
    created_at
FROM partition_audit_log
WHERE operation = 'drop'
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours';
```

---

## Dashboard Queries

### Grafana Dashboard: Partition Overview

**Panel 1: Partition Coverage Timeline**

```sql
-- Query: Show partition coverage for next 90 days
WITH expected_partitions AS (
    SELECT
        'automation_logs' AS table_name,
        generate_series(
            date_trunc('month', NOW()),
            date_trunc('month', NOW() + INTERVAL '3 months'),
            INTERVAL '1 month'
        )::date AS expected_start
),
existing_partitions AS (
    SELECT
        'automation_logs' AS table_name,
        (regexp_match(pg_get_expr(child.relpartbound, child.oid),
            'FROM \(''([^'']+)'))[1]::date AS start_date
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'automation_logs'
)
SELECT
    ep.table_name,
    ep.expected_start AS date,
    CASE WHEN ex.start_date IS NOT NULL THEN 1 ELSE 0 END AS exists
FROM expected_partitions ep
LEFT JOIN existing_partitions ex
    ON ep.table_name = ex.table_name
    AND ep.expected_start = ex.start_date
ORDER BY ep.expected_start;
```

**Visualization:** Heatmap (green = exists, red = missing)

---

**Panel 2: Partition Size Growth**

```sql
-- Query: Partition sizes over time
SELECT
    CASE
        WHEN tablename LIKE 'automation_logs_%' THEN 'automation_logs'
        WHEN tablename LIKE 'analytics_events_%' THEN 'analytics_events'
        ELSE 'other'
    END AS table_name,
    tablename AS partition_name,
    pg_total_relation_size(tablename::regclass) AS size_bytes,
    -- Extract date from partition name (automation_logs_2025_11)
    to_date(substring(tablename from '\d{4}_\d{2}$'), 'YYYY_MM') AS partition_date
FROM pg_tables
WHERE tablename LIKE '%_logs_%' OR tablename LIKE '%_events_%'
ORDER BY partition_date DESC;
```

**Visualization:** Time series graph (stacked area)

---

**Panel 3: Row Counts per Partition**

```sql
-- Query: Row counts per partition
SELECT
    schemaname,
    tablename AS partition_name,
    n_live_tup AS row_count,
    n_dead_tup AS dead_rows,
    last_autovacuum
FROM pg_stat_user_tables
WHERE tablename LIKE 'automation_logs_%'
   OR tablename LIKE 'analytics_events_%'
   OR tablename LIKE 'automation_input_events_%'
ORDER BY tablename;
```

**Visualization:** Table

---

**Panel 4: Partition Operations (Last 7 Days)**

```sql
-- Query: Partition operations summary
SELECT
    date_trunc('day', created_at) AS day,
    operation,
    table_name,
    COUNT(*) AS operation_count,
    COUNT(*) FILTER (WHERE status = 'success') AS success_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
FROM partition_audit_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY day, operation, table_name
ORDER BY day DESC, table_name, operation;
```

**Visualization:** Bar chart (stacked by success/failed)

---

**Panel 5: Disk Space per Table**

```sql
-- Query: Total disk usage per partitioned table
SELECT
    CASE
        WHEN tablename LIKE 'automation_logs_%' THEN 'automation_logs'
        WHEN tablename LIKE 'automation_input_events_%' THEN 'automation_input_events'
        WHEN tablename LIKE 'analytics_events_%' THEN 'analytics_events'
        WHEN tablename LIKE 'audit_logs_%' THEN 'audit_logs'
        ELSE 'other'
    END AS base_table,
    COUNT(*) AS partition_count,
    SUM(pg_total_relation_size(tablename::regclass)) AS total_size_bytes,
    SUM(pg_relation_size(tablename::regclass)) AS table_size_bytes,
    SUM(pg_total_relation_size(tablename::regclass) - pg_relation_size(tablename::regclass)) AS index_size_bytes
FROM pg_tables
WHERE tablename LIKE '%_logs_%' OR tablename LIKE '%_events_%'
GROUP BY base_table
ORDER BY total_size_bytes DESC;
```

**Visualization:** Pie chart or table

---

### Metabase Dashboard: Business Metrics

**Panel 1: Automation Activity Trend**

```sql
-- Query: Daily automation session counts
SELECT
    date_trunc('day', created_at) AS day,
    COUNT(*) AS session_count,
    COUNT(DISTINCT user_id) AS unique_users
FROM automation_sessions
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day;
```

---

**Panel 2: Log Volume Trend**

```sql
-- Query: Daily log entry counts
SELECT
    date_trunc('day', created_at) AS day,
    COUNT(*) AS log_count,
    AVG(LENGTH(message)) AS avg_message_length
FROM automation_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day;
```

---

## ARQ Task Monitoring

### Check ARQ Worker Status

**Docker Logs:**
```bash
# Check ARQ worker logs
docker logs arq-worker --tail 100 --follow

# Check for partition task executions
docker logs arq-worker | grep "create_future_partitions\|drop_old_partitions"
```

**Expected Output:**
```
2025-11-21 02:00:10 INFO create_future_partitions_started
2025-11-21 02:00:15 INFO create_future_partitions_completed partitions_created=3
2025-11-21 03:00:05 INFO drop_old_partitions_started
2025-11-21 03:00:12 INFO drop_old_partitions_completed partitions_dropped=1
```

---

### Query ARQ Job Results

**Query:** Last 10 partition management jobs

```sql
-- If using ARQ with PostgreSQL job store
SELECT
    job_id,
    function,
    enqueue_time,
    start_time,
    finish_time,
    success,
    result
FROM arq_job
WHERE function IN ('create_future_partitions', 'drop_old_partitions', 'verify_partition_coverage')
ORDER BY enqueue_time DESC
LIMIT 10;
```

**Note:** ARQ stores results in Redis by default. If using Redis, query via Redis CLI:

```bash
# Check recent ARQ job results
redis-cli KEYS "arq:result:*" | head -10

# View specific job result
redis-cli GET "arq:result:<job-id>"
```

---

## Performance Metrics

### Query Performance Monitoring

**Query:** Track query performance on partitioned tables

```sql
-- Query: Slowest queries on partitioned tables (requires pg_stat_statements)
SELECT
    substring(query, 1, 100) AS query_snippet,
    calls,
    total_exec_time / 1000 AS total_time_seconds,
    mean_exec_time AS avg_time_ms,
    max_exec_time AS max_time_ms,
    stddev_exec_time AS stddev_time_ms
FROM pg_stat_statements
WHERE query LIKE '%automation_logs%'
   OR query LIKE '%analytics_events%'
   OR query LIKE '%automation_input_events%'
ORDER BY mean_exec_time DESC
LIMIT 20;
```

**Enable pg_stat_statements (if not enabled):**
```sql
-- Check if enabled
SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';

-- Enable (requires superuser)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Add to postgresql.conf:
-- shared_preload_libraries = 'pg_stat_statements'
-- pg_stat_statements.track = all
```

---

### Index Usage Monitoring

**Query:** Check if partition indexes are being used

```sql
-- Query: Index usage per partition
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS index_scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE tablename LIKE 'automation_logs_%'
ORDER BY idx_scan DESC, tablename;
```

**Alert if indexes are not used:**
```sql
-- Find unused indexes (0 scans in last 7 days)
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS wasted_size
FROM pg_stat_user_indexes
WHERE tablename LIKE 'automation_logs_%'
  AND idx_scan = 0
  AND pg_relation_size(indexrelid) > 100 * 1024 * 1024  -- > 100MB
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## Disk Space Monitoring

### Total Partition Storage

**Query:** Disk space per partitioned table

```sql
-- Query: Storage breakdown by table
SELECT
    CASE
        WHEN tablename LIKE 'automation_logs_%' THEN 'automation_logs'
        WHEN tablename LIKE 'automation_input_events_%' THEN 'automation_input_events'
        WHEN tablename LIKE 'analytics_events_%' THEN 'analytics_events'
        ELSE 'other'
    END AS base_table,
    COUNT(*) AS partition_count,
    pg_size_pretty(SUM(pg_relation_size(tablename::regclass))) AS table_size,
    pg_size_pretty(SUM(pg_total_relation_size(tablename::regclass) - pg_relation_size(tablename::regclass))) AS index_size,
    pg_size_pretty(SUM(pg_total_relation_size(tablename::regclass))) AS total_size
FROM pg_tables
WHERE tablename LIKE '%_logs_%' OR tablename LIKE '%_events_%'
GROUP BY base_table
ORDER BY SUM(pg_total_relation_size(tablename::regclass)) DESC;
```

---

### S3 Archive Storage Tracking

**AWS CLI Query:**
```bash
# Check S3 archive bucket size
aws s3 ls s3://qontinui-archives/partitions/ --recursive --summarize --human-readable

# Check storage by table
aws s3 ls s3://qontinui-archives/partitions/automation_logs/ --recursive --summarize --human-readable
```

**CloudWatch Metric:**
```bash
# Get S3 bucket size from CloudWatch
aws cloudwatch get-metric-statistics \
    --namespace AWS/S3 \
    --metric-name BucketSizeBytes \
    --dimensions Name=BucketName,Value=qontinui-archives Name=StorageType,Value=StandardStorage \
    --start-time 2025-11-20T00:00:00Z \
    --end-time 2025-11-21T00:00:00Z \
    --period 86400 \
    --statistics Average
```

---

## Troubleshooting Alerts

### Alert: Missing Future Partitions

**Investigation Steps:**
1. Check ARQ worker status: `docker logs arq-worker`
2. Verify cron schedule: `psql -c "SELECT * FROM partition_config;"`
3. Check for task failures: `psql -c "SELECT * FROM partition_audit_log WHERE status='failed' ORDER BY created_at DESC LIMIT 10;"`
4. Manually create missing partitions (see PARTITION_MAINTENANCE.md)

---

### Alert: Partition Size Too Large

**Investigation Steps:**
1. Check row count: `psql -c "SELECT COUNT(*) FROM automation_logs_2026_01;"`
2. Check for duplicate data
3. Review partition strategy (switch to smaller intervals?)
4. Consider data archival

---

### Alert: Query Performance Degraded

**Investigation Steps:**
1. Check if partition pruning is working: `EXPLAIN SELECT ... FROM automation_logs WHERE created_at > '2026-01-01';`
2. Verify indexes exist: `psql -c "SELECT * FROM pg_indexes WHERE tablename LIKE 'automation_logs_%';"`
3. Check vacuum stats: `psql -c "SELECT * FROM pg_stat_user_tables WHERE tablename LIKE 'automation_logs_%';"`
4. Run ANALYZE: `psql -c "ANALYZE automation_logs_2026_01;"`

---

## Best Practices

1. **Review partition metrics daily** (via dashboard)
2. **Set up alerts for all critical conditions** (P0, P1)
3. **Monitor ARQ task success rate** (should be 100%)
4. **Track disk space growth weekly** (capacity planning)
5. **Verify partition coverage daily** (automated)
6. **Review slow queries weekly** (pg_stat_statements)
7. **Test alert notifications monthly** (ensure Slack/email works)
8. **Document all incidents** (for postmortems)
9. **Update thresholds quarterly** (as data volume grows)
10. **Backup monitoring config** (Grafana dashboards, alerts)

---

## Related Documentation

- [PARTITIONING.md](./PARTITIONING.md) - Overall strategy
- [PARTITION_MAINTENANCE.md](./PARTITION_MAINTENANCE.md) - Operations guide
- [database-architecture-analysis.md](/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-web/frontend/public/docs/architecture/database-architecture-analysis.md) - Database analysis

---

**Document Status:** DRAFT - Pending DevOps Review
**Next Review Date:** 2026-01-15
**Maintained By:** Backend Team, DevOps

**Change Log:**
- 2025-11-21: Initial draft created
