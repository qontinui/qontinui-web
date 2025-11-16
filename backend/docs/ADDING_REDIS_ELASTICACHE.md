# Adding Redis with ElastiCache

This document describes how to add Redis using AWS ElastiCache when you're ready to scale background job processing.

## When to Add Redis

Add Redis when you experience:
- **High traffic**: >100 requests/minute consistently
- **Slow operations**: Users complaining about email sends or page loads
- **Background jobs needed**: Heavy processing like batch image operations
- **Revenue milestone**: Making enough to justify ~$15/month

## Prerequisites

- AWS CLI configured with appropriate credentials
- Elastic Beanstalk environment running (`qontinui-prod`)
- PostgreSQL database already configured

## Step 1: Create ElastiCache Redis Instance

### Using AWS CLI

```bash
# Create a cache subnet group (if not already created)
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name qontinui-redis-subnet \
  --cache-subnet-group-description "Subnet group for Qontinui Redis" \
  --subnet-ids subnet-xxxxxxxx subnet-yyyyyyyy \
  --region eu-central-1

# Create Redis cluster
aws elasticache create-cache-cluster \
  --cache-cluster-id qontinui-redis \
  --engine redis \
  --cache-node-type cache.t3.micro \
  --num-cache-nodes 1 \
  --engine-version 7.0 \
  --cache-subnet-group-name qontinui-redis-subnet \
  --security-group-ids sg-xxxxxxxxx \
  --region eu-central-1
```

### Using AWS Console

1. Go to **ElastiCache** in AWS Console
2. Click **Create cluster**
3. Choose **Redis**
4. Configuration:
   - **Name**: `qontinui-redis`
   - **Engine version**: 7.x (latest)
   - **Node type**: `cache.t3.micro` (~$15/month)
   - **Number of nodes**: 1
5. **Subnet group**: Select your VPC subnet group
6. **Security group**: Same as your EB environment
7. Click **Create**

### Get Redis Endpoint

```bash
# Get the endpoint
aws elasticache describe-cache-clusters \
  --cache-cluster-id qontinui-redis \
  --show-cache-node-info \
  --region eu-central-1 \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
  --output text
```

Output will be something like: `qontinui-redis.abc123.0001.euc1.cache.amazonaws.com`

## Step 2: Update Security Group

Allow Redis traffic (port 6379) from your EB environment:

```bash
# Get your EB environment's security group
eb printenv | grep SECURITY

# Add inbound rule to Redis security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-redis-xxxxxxxxx \
  --protocol tcp \
  --port 6379 \
  --source-group sg-eb-xxxxxxxxx \
  --region eu-central-1
```

Or in AWS Console:
1. Go to **EC2 → Security Groups**
2. Find Redis security group
3. Add inbound rule:
   - **Type**: Custom TCP
   - **Port**: 6379
   - **Source**: EB environment security group

## Step 3: Update EB Environment Variables

```bash
cd /path/to/qontinui-web/backend

# Set Redis connection details
eb setenv \
  REDIS_HOST='qontinui-redis.abc123.0001.euc1.cache.amazonaws.com' \
  REDIS_PORT='6379' \
  REDIS_DB='0'
```

## Step 4: Update Dockerfile to Run Worker

Your current Dockerfile only runs the API. Update it to run both API and worker:

### Option A: Use docker-compose locally, supervisor in production

Add a `supervisord.conf`:

```conf
[supervisord]
nodaemon=true
user=root

[program:api]
command=python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:worker]
command=python run_worker.py
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

Update Dockerfile CMD:
```dockerfile
CMD ["supervisord", "-c", "/app/supervisord.conf"]
```

### Option B: Keep API only, run worker separately

Keep current setup and run worker on a separate EC2 instance or ECS task.

## Step 5: Deploy

```bash
# Commit changes if you modified Dockerfile/config
git add -A
git commit -m "feat: add Redis ElastiCache support with worker process"
git push origin main

# Deploy
eb deploy
```

## Step 6: Verify Redis Connection

Check logs to confirm Redis connectivity:

```bash
eb logs --all

# Look for:
# - "Redis client initialized"
# - "ARQ Redis pool created"
# - "Starting worker for 6 functions"
```

Test the health endpoint:

```bash
curl https://api.qontinui.com/api/v1/admin/system/health
```

Should show Redis connection in the response.

## Step 7: Test Background Jobs

Test email sending via background job:

```bash
# Use your API to trigger an email
curl -X POST https://api.qontinui.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "securepass123"
  }'
```

Check worker logs to see job processing:
```bash
eb ssh
docker logs $(docker ps -q --filter name=worker) --tail 50
```

## Cost Breakdown

### ElastiCache Redis (cache.t3.micro)
- **Cost**: ~$15/month ($0.017/hour)
- **Memory**: 512 MB
- **Network**: Good for moderate traffic
- **Backup**: Included
- **High Availability**: Single node (no failover)

### Upgrading Later

When traffic grows, upgrade to:
- **cache.t3.small**: ~$30/month, 1.37 GB memory
- **cache.m6g.large**: ~$90/month, 6.38 GB memory
- **Multi-AZ**: Add replica for high availability (+100% cost)

## Rollback

If you need to remove Redis:

```bash
# Remove environment variables
eb setenv REDIS_HOST=localhost REDIS_PORT=6379 REDIS_DB=0

# Delete ElastiCache cluster
aws elasticache delete-cache-cluster \
  --cache-cluster-id qontinui-redis \
  --region eu-central-1
```

## Monitoring

### CloudWatch Metrics

ElastiCache automatically sends metrics to CloudWatch:
- **CPUUtilization**: Should be <75%
- **FreeableMemory**: Monitor for memory pressure
- **NetworkBytesIn/Out**: Track traffic
- **CurrConnections**: Monitor connection count

### Set Up Alerts

```bash
# Alert if memory usage is high
aws cloudwatch put-metric-alarm \
  --alarm-name qontinui-redis-memory \
  --alarm-description "Redis memory usage high" \
  --metric-name FreeableMemory \
  --namespace AWS/ElastiCache \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 50000000 \
  --comparison-operator LessThanThreshold \
  --dimensions Name=CacheClusterId,Value=qontinui-redis
```

## Troubleshooting

### Redis Connection Failed

1. Check security group allows traffic from EB
2. Verify Redis endpoint is correct
3. Ensure EB and Redis are in same VPC
4. Check Redis cluster is in "available" state

```bash
aws elasticache describe-cache-clusters \
  --cache-cluster-id qontinui-redis \
  --region eu-central-1
```

### Worker Not Processing Jobs

1. Check worker is running: `eb ssh` then `docker ps`
2. Check worker logs: `docker logs <worker-container-id>`
3. Verify Redis connection in worker logs
4. Test Redis connectivity: `redis-cli -h <endpoint> ping`

### High Memory Usage

1. Check job queue backlog
2. Review job retention settings
3. Consider upgrading to larger instance
4. Implement job expiration in ARQ

## Additional Resources

- [ElastiCache Redis Documentation](https://docs.aws.amazon.com/elasticache/latest/red-ug/)
- [ARQ Documentation](https://arq-docs.helpmanual.io/)
- [Elastic Beanstalk Environment Variables](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/environments-cfg-softwaresettings.html)
