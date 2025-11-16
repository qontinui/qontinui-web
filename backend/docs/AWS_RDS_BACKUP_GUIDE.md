# AWS RDS Backup Guide

## Overview

AWS RDS provides two types of backups: **Automated Backups** and **Manual Snapshots**. Understanding the difference is crucial for cost management and disaster recovery.

---

## Backup Types

### 1. Automated Backups (Built-in, Free-ish)

**How it works:**
- RDS automatically creates daily backups during your backup window
- Maintains transaction logs throughout the day for point-in-time recovery
- Retention period: 1-35 days (you configure this)
- **Cost:** FREE up to 100% of your database storage size

**Example:**
- Database size: 20 GB
- Automated backup storage: Up to 20 GB is **FREE**
- If backups exceed 20 GB: $0.095/GB-month for the excess

**Key Points:**
- ✅ Already enabled by default on RDS instances
- ✅ No additional cost for most use cases
- ✅ Point-in-time recovery within retention period
- ❌ Deleted when you delete the RDS instance (unless you create final snapshot)
- ❌ Cannot be shared with other AWS accounts

### 2. Manual Snapshots (Your Control, Costs Apply)

**How it works:**
- You manually create snapshots whenever needed
- Persist indefinitely until you delete them
- Useful for: major migrations, pre-deployment backups, archival
- **Cost:** $0.095/GB-month (US East region)

**Example:**
- Database size: 20 GB
- 1 snapshot: $0.095 × 20 GB = **$1.90/month**
- 5 snapshots: $0.095 × 100 GB = **$9.50/month**

**Key Points:**
- ✅ Persist even if you delete the RDS instance
- ✅ Can be copied to other regions
- ✅ Can be shared with other AWS accounts
- ❌ Costs money (but relatively cheap)
- ❌ Accumulates if you don't delete old snapshots

---

## Cost Breakdown

### Typical Scenarios

#### Small Database (20 GB)
| Scenario | Storage Used | Monthly Cost |
|----------|--------------|--------------|
| Automated backups only | 20 GB | **FREE** |
| 1 manual snapshot | 20 GB | **$1.90** |
| 5 manual snapshots | 100 GB | **$9.50** |
| 10 manual snapshots | 200 GB | **$19.00** |

#### Medium Database (100 GB)
| Scenario | Storage Used | Monthly Cost |
|----------|--------------|--------------|
| Automated backups only | 100 GB | **FREE** |
| 1 manual snapshot | 100 GB | **$9.50** |
| 5 manual snapshots | 500 GB | **$47.50** |
| 10 manual snapshots | 1000 GB | **$95.00** |

**Current RDS Snapshot Pricing (as of 2024):**
- **US East (N. Virginia):** $0.095/GB-month
- **US West (Oregon):** $0.095/GB-month
- **EU (Ireland):** $0.10/GB-month

Check latest pricing: https://aws.amazon.com/rds/postgresql/pricing/

---

## Backup Strategies & Costs

### Strategy 1: Use Automated Backups Only (FREE)

**Best for:** Development, staging, small projects

```bash
# Verify automated backups are enabled
aws rds describe-db-instances \
  --db-instance-identifier your-db-instance \
  --query 'DBInstances[0].BackupRetentionPeriod'

# Should return: 7 (or your configured retention days)
```

**Pros:**
- ✅ Completely FREE (up to database size)
- ✅ No manual management
- ✅ Point-in-time recovery

**Cons:**
- ❌ Lost if RDS instance is deleted
- ❌ Cannot keep long-term archives

**Cost:** $0/month

### Strategy 2: Manual Snapshot Before Each Migration (Low Cost)

**Best for:** Production with infrequent migrations

```bash
# Create snapshot before migration
aws rds create-db-snapshot \
  --db-instance-identifier qontinui-production \
  --db-snapshot-identifier prod-migration-automation-tables-20251114

# After successful migration and verification (e.g., 1 week), delete old snapshots
aws rds delete-db-snapshot \
  --db-snapshot-identifier prod-migration-previous-feature-20251101
```

**Pros:**
- ✅ Safety net for risky changes
- ✅ Can restore to exact pre-migration state
- ✅ Relatively cheap

**Cons:**
- ❌ Costs accumulate if you forget to delete old snapshots
- ❌ Manual process

**Cost:** ~$2-10/month (depending on database size and how many you keep)

### Strategy 3: Automated Snapshot Rotation (Recommended for Production)

**Best for:** Production with regular deployments

Use AWS Backup service or custom Lambda to automatically:
- Create snapshot before each migration
- Keep only last N snapshots (e.g., last 3)
- Delete snapshots older than X days (e.g., 30 days)

**Script Example:**

```bash
#!/bin/bash
# create_rotating_snapshot.sh

DB_INSTANCE="qontinui-production"
SNAPSHOT_PREFIX="prod-auto-backup"
KEEP_COUNT=3  # Keep only last 3 snapshots

# Create new snapshot
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SNAPSHOT_ID="${SNAPSHOT_PREFIX}-${TIMESTAMP}"

echo "Creating snapshot: $SNAPSHOT_ID"
aws rds create-db-snapshot \
  --db-instance-identifier $DB_INSTANCE \
  --db-snapshot-identifier $SNAPSHOT_ID

# Wait for snapshot to complete
aws rds wait db-snapshot-completed \
  --db-snapshot-identifier $SNAPSHOT_ID

# List all snapshots with this prefix, sorted by date
SNAPSHOTS=$(aws rds describe-db-snapshots \
  --db-instance-identifier $DB_INSTANCE \
  --query "DBSnapshots[?starts_with(DBSnapshotIdentifier, '$SNAPSHOT_PREFIX')].DBSnapshotIdentifier" \
  --output text | tr '\t' '\n' | sort -r)

# Count snapshots
SNAPSHOT_COUNT=$(echo "$SNAPSHOTS" | wc -l)

# Delete old snapshots if we have more than KEEP_COUNT
if [ $SNAPSHOT_COUNT -gt $KEEP_COUNT ]; then
  echo "Found $SNAPSHOT_COUNT snapshots, keeping $KEEP_COUNT"

  # Skip first KEEP_COUNT, delete the rest
  echo "$SNAPSHOTS" | tail -n +$((KEEP_COUNT + 1)) | while read OLD_SNAPSHOT; do
    echo "Deleting old snapshot: $OLD_SNAPSHOT"
    aws rds delete-db-snapshot \
      --db-snapshot-identifier $OLD_SNAPSHOT
  done
else
  echo "Found $SNAPSHOT_COUNT snapshots, no cleanup needed"
fi

echo "Snapshot rotation complete"
```

**Pros:**
- ✅ Automatic cleanup
- ✅ Always have N recent backups
- ✅ Predictable costs

**Cons:**
- ❌ Requires setup/maintenance
- ❌ Still costs money (but controlled)

**Cost:** ~$6-30/month (for 3 snapshots of 20-100 GB database)

---

## Can You Overwrite Snapshots? (NO, but...)

### ❌ Cannot Overwrite Existing Snapshots

AWS RDS snapshots are **immutable**. You cannot overwrite or update an existing snapshot.

### ✅ You Can Delete + Recreate

The workaround is to delete the old snapshot and create a new one with the same name:

```bash
# Delete old snapshot (if it exists)
aws rds delete-db-snapshot \
  --db-snapshot-identifier prod-pre-migration-backup \
  2>/dev/null || true

# Create new snapshot with same name
aws rds create-db-snapshot \
  --db-instance-identifier qontinui-production \
  --db-snapshot-identifier prod-pre-migration-backup
```

**Important:** There's a gap between deletion and creation where the backup doesn't exist. Not recommended for production!

### ✅ Better: Use Dated Names + Cleanup Script

Instead of trying to overwrite, use descriptive names with dates:

```bash
# Good naming convention
prod-migration-{feature-name}-{date}
prod-migration-automation-tables-20251114
prod-migration-user-auth-20251120
prod-migration-payments-20251201

# After successful verification, delete old ones
aws rds delete-db-snapshot --db-snapshot-identifier prod-migration-automation-tables-20251114
```

---

## Recommended Backup Strategy for Qontinui

### For Development/Staging

**Strategy:** Rely on automated backups only

```bash
# Ensure automated backups are enabled (7-day retention)
aws rds modify-db-instance \
  --db-instance-identifier qontinui-staging \
  --backup-retention-period 7 \
  --apply-immediately
```

**Cost:** $0/month

### For Production

**Strategy:** Automated backups + manual snapshots before major changes

```bash
# 1. Automated backups (FREE - already enabled)
# Keeps 7 days of point-in-time recovery

# 2. Before major migration: create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier qontinui-production \
  --db-snapshot-identifier prod-migration-automation-tables-$(date +%Y%m%d)

# 3. After successful verification (1-2 weeks): delete old migration snapshots
aws rds delete-db-snapshot \
  --db-snapshot-identifier prod-migration-old-feature-20251001
```

**Cost Estimate:**
- Automated backups: $0 (free tier)
- 1-2 migration snapshots at a time: $2-5/month (for 20 GB database)
- **Total: ~$2-5/month**

---

## Backup Before Migration: Step-by-Step

### Option 1: Quick Manual Snapshot (Recommended)

```bash
# 1. Set your database identifier
DB_INSTANCE="qontinui-production"

# 2. Create snapshot with descriptive name
SNAPSHOT_NAME="prod-before-automation-migration-$(date +%Y%m%d-%H%M)"

aws rds create-db-snapshot \
  --db-instance-identifier $DB_INSTANCE \
  --db-snapshot-identifier $SNAPSHOT_NAME

# 3. Wait for snapshot to complete (optional)
echo "Waiting for snapshot to complete..."
aws rds wait db-snapshot-completed \
  --db-snapshot-identifier $SNAPSHOT_NAME

echo "Snapshot created: $SNAPSHOT_NAME"

# 4. Verify snapshot exists
aws rds describe-db-snapshots \
  --db-snapshot-identifier $SNAPSHOT_NAME \
  --query 'DBSnapshots[0].[DBSnapshotIdentifier,Status,SnapshotCreateTime,AllocatedStorage]' \
  --output table
```

**Time:** 5-30 minutes (depending on database size)
**Cost:** ~$0.095/GB-month (e.g., $1.90/month for 20 GB)

### Option 2: Using pg_dump (Alternative)

If you want a backup outside of AWS:

```bash
# 1. Create dump file
pg_dump $DATABASE_URL > backup_before_automation_migration_$(date +%Y%m%d_%H%M%S).sql

# 2. Compress to save space
gzip backup_before_automation_migration_*.sql

# 3. Upload to S3 for safekeeping (optional)
aws s3 cp backup_before_automation_migration_*.sql.gz \
  s3://qontinui-backups/database/

# 4. Verify backup is restorable
gunzip -c backup_before_automation_migration_*.sql.gz | head -n 50
```

**Pros:**
- ✅ Portable (can restore anywhere)
- ✅ Can store in S3 for cheap ($0.023/GB-month)
- ✅ No RDS snapshot costs

**Cons:**
- ❌ Requires database to be accessible from your machine
- ❌ Slower for large databases
- ❌ Manual restore process

**Cost:** S3 storage ~$0.023/GB-month (75% cheaper than RDS snapshots!)

---

## Restoring from Backup

### Restore from RDS Snapshot

```bash
# 1. List available snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier qontinui-production \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime]' \
  --output table

# 2. Restore to NEW instance (doesn't overwrite existing)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier qontinui-production-restored \
  --db-snapshot-identifier prod-before-automation-migration-20251114

# 3. After verification, you can:
#    - Point your app to the restored instance
#    - Or delete the restored instance if migration was successful
```

**Important:** Restore creates a NEW RDS instance. It doesn't overwrite the existing one!

### Restore from pg_dump

```bash
# 1. Uncompress backup
gunzip backup_before_automation_migration_20251114.sql.gz

# 2. Restore to database
psql $DATABASE_URL < backup_before_automation_migration_20251114.sql

# Or if you need to drop/recreate database first:
dropdb qontinui_production
createdb qontinui_production
psql qontinui_production < backup_before_automation_migration_20251114.sql
```

---

## Cost Optimization Tips

### 1. Delete Snapshots After Successful Migration

```bash
# After migration is verified (e.g., 1-2 weeks), delete the pre-migration snapshot
aws rds delete-db-snapshot \
  --db-snapshot-identifier prod-before-automation-migration-20251114
```

**Savings:** $1.90-9.50/month per snapshot deleted (for 20-100 GB database)

### 2. Use Lifecycle Policy

Create a Lambda function that automatically deletes snapshots older than 30 days:

```python
# Lambda function (simplified)
import boto3
from datetime import datetime, timedelta

rds = boto3.client('rds')

def lambda_handler(event, context):
    # Get all manual snapshots
    snapshots = rds.describe_db_snapshots(
        SnapshotType='manual'
    )['DBSnapshots']

    # Delete snapshots older than 30 days
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=30)

    for snapshot in snapshots:
        if snapshot['SnapshotCreateTime'] < cutoff_date:
            print(f"Deleting old snapshot: {snapshot['DBSnapshotIdentifier']}")
            rds.delete_db_snapshot(
                DBSnapshotIdentifier=snapshot['DBSnapshotIdentifier']
            )
```

**Savings:** Automatic - only pay for recent snapshots

### 3. Use S3 + pg_dump for Long-term Archives

For long-term archives (>30 days), use pg_dump + S3:

```bash
# Create dump
pg_dump $DATABASE_URL | gzip > monthly_backup_$(date +%Y%m).sql.gz

# Upload to S3 (Glacier Deep Archive for super cheap long-term storage)
aws s3 cp monthly_backup_*.sql.gz \
  s3://qontinui-backups/monthly/ \
  --storage-class DEEP_ARCHIVE
```

**Cost Comparison (100 GB backup):**
- RDS Snapshot: $9.50/month
- S3 Standard: $2.30/month (75% cheaper!)
- S3 Glacier Deep Archive: $0.10/month (99% cheaper!)

---

## Summary & Recommendations

### For Your Automation Migration

**Recommended Approach:**

1. **Development/Staging:** No manual backup needed
   - Automated backups are sufficient
   - Cost: $0

2. **Production:** Create one manual snapshot before migration
   ```bash
   aws rds create-db-snapshot \
     --db-instance-identifier qontinui-production \
     --db-snapshot-identifier prod-automation-migration-$(date +%Y%m%d)
   ```
   - Cost: ~$1.90-9.50/month (depending on database size)
   - Delete after 2 weeks if migration successful
   - Net cost: ~$1-3 (pro-rated for 2 weeks)

### Ongoing Backup Strategy

**For Production Database:**

| Backup Type | Retention | Purpose | Cost |
|-------------|-----------|---------|------|
| Automated backups | 7 days | Daily disasters, point-in-time recovery | FREE |
| Manual snapshot before major migrations | Delete after 2 weeks | Pre-migration safety net | ~$1-3 per migration |
| Monthly archive (optional) | 12 months | Long-term compliance | ~$2.30/month (S3) |

**Total Ongoing Cost: ~$2-5/month**

### Answers to Your Questions

1. **How do I backup on AWS before migrating production?**
   - Use `aws rds create-db-snapshot` command (see examples above)
   - Takes 5-30 minutes depending on size
   - No downtime during snapshot creation

2. **How much does this cost?**
   - $0.095/GB-month
   - 20 GB database = $1.90/month per snapshot
   - 100 GB database = $9.50/month per snapshot

3. **Does it cost every time I make a backup?**
   - No upfront cost to create snapshot
   - Storage costs accrue monthly while snapshot exists
   - Pro-rated (if you delete after 2 weeks, you pay ~half the monthly cost)

4. **Can I overwrite the backup to save costs?**
   - No, snapshots are immutable
   - But you can: delete old snapshot + create new one
   - Better: use dated names + delete old snapshots after verification
   - Best: automate cleanup with script or Lambda

---

## Quick Commands Reference

```bash
# Create snapshot
aws rds create-db-snapshot \
  --db-instance-identifier YOUR_DB \
  --db-snapshot-identifier backup-$(date +%Y%m%d)

# List snapshots
aws rds describe-db-snapshots --db-instance-identifier YOUR_DB

# Delete snapshot
aws rds delete-db-snapshot --db-snapshot-identifier backup-20251114

# Check snapshot size (for cost estimation)
aws rds describe-db-snapshots \
  --db-snapshot-identifier backup-20251114 \
  --query 'DBSnapshots[0].AllocatedStorage'
```

---

**Bottom Line:** For your automation migration, create one manual snapshot before migrating production, verify the migration works for 1-2 weeks, then delete the snapshot. **Total cost: ~$1-3** for peace of mind.
