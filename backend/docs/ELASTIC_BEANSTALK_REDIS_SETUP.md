# Adding Redis to Elastic Beanstalk Deployment

## What Was Set Up

I've detected that you're using **AWS Elastic Beanstalk with Docker** for your qontinui-prod environment.

**Your Current Setup:**
- Environment: qontinui-prod
- Application: qontinui-backend
- Platform: Docker on Amazon Linux 2023
- Instance: t3.micro (3.71.34.120)
- URL: qontinui-prod.eba-km2u4s23.eu-central-1.elasticbeanstalk.com

## Files Created

1. **`docker-compose.yml`** - Multi-container setup with:
   - Redis container (7-alpine)
   - Backend API container
   - Worker container (for background jobs)

2. **`.ebextensions/03_redis.config`** - Environment variables for Redis

## How to Deploy

### Step 1: Test Locally First

```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend

# Build and start all containers
docker-compose up --build

# You should see:
# - redis container running
# - backend container connected to Redis
# - worker container processing jobs

# Test it:
curl http://localhost/health
# Should show: "redis": "connected", "arq": "connected"
```

### Step 2: Deploy to Elastic Beanstalk

Elastic Beanstalk will automatically detect `docker-compose.yml` and deploy all 3 containers.

```bash
# Make sure you're in the backend directory
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend

# Initialize EB CLI if not already done
eb init

# Deploy
eb deploy qontinui-prod

# Monitor deployment
eb health qontinui-prod
eb logs qontinui-prod
```

### Step 3: Verify Redis is Running

```bash
# Check environment health
eb health qontinui-prod

# Check logs for Redis connection
eb logs qontinui-prod | grep -i redis

# You should see:
# - "redis_initialized" - status: connected
# - "arq_pool_initialized" - status: connected
# - ARQ worker logs showing it's connected
```

### Step 4: Test Email Background Jobs

```bash
# Test registration endpoint (will queue email)
curl -X POST https://qontinui-prod.eba-km2u4s23.eu-central-1.elasticbeanstalk.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "TestPass123!",
    "full_name": "Test User"
  }'

# Check logs to see:
# 1. "Verification email enqueued" (in API logs)
# 2. "Sending verification email" (in worker logs)
# 3. "Verification email sent successfully" (in worker logs)
```

## What Each Container Does

### 1. Redis Container
- **Image**: redis:7-alpine
- **Purpose**: Message queue for background jobs
- **Memory**: 256MB max
- **Data**: Persisted to volume (survives restarts)
- **Port**: 6379 (internal only, not exposed)

### 2. Backend Container
- **Built from**: Your Dockerfile
- **Purpose**: FastAPI application
- **Port**: 80 (exposed to internet)
- **Connects to**: Redis, RDS database

### 3. Worker Container
- **Built from**: Same Dockerfile
- **Purpose**: Process background jobs (emails, etc.)
- **Command**: `python run_worker.py`
- **Connects to**: Redis, RDS database

## Configuration

All configuration is done through environment variables in Elastic Beanstalk console or `.ebextensions`.

**Redis variables (automatically set):**
- `REDIS_HOST=redis`
- `REDIS_PORT=6379`
- `REDIS_DB=0`

**Other variables (set in EB console):**
- Database connection
- Stripe keys
- SMTP settings
- etc.

## Troubleshooting

### Redis Not Starting

```bash
# Check Docker Compose logs
eb ssh qontinui-prod
docker-compose logs redis

# Common issues:
# - Out of memory: Check t3.micro has enough RAM
# - Port conflict: Shouldn't happen (internal network)
```

### Worker Not Processing Jobs

```bash
# Check worker logs
eb logs qontinui-prod | grep worker

# Or SSH and check directly
eb ssh qontinui-prod
docker-compose logs worker

# Common issues:
# - Can't connect to Redis: Check REDIS_HOST is set to "redis"
# - Can't import modules: Rebuild Docker image
```

### Backend Can't Connect to Redis

```bash
# Check backend logs
eb logs qontinui-prod | grep backend

# Look for:
# - "arq_initialization_failed" - means Redis connection issue
# - "redis_initialized" - means it's working

# Common fix:
# - Ensure docker-compose.yml has depends_on: redis
# - Check REDIS_HOST=redis (not localhost!)
```

### Health Check Failures

If EB health checks fail:

1. **Check backend is responding on port 80**:
   ```bash
   eb ssh qontinui-prod
   curl localhost:80/health
   ```

2. **Check all containers are running**:
   ```bash
   docker-compose ps
   # All should show "Up"
   ```

3. **Check container logs**:
   ```bash
   docker-compose logs backend
   docker-compose logs redis
   docker-compose logs worker
   ```

## Resource Usage

**t3.micro Capacity (1GB RAM, 2 vCPU):**
- Backend: ~300-400MB RAM
- Redis: ~256MB RAM
- Worker: ~200-300MB RAM
- System: ~100MB RAM
- **Total**: ~850-1050MB (fits in 1GB with ~10% headroom)

**If you get OOM (Out of Memory) errors:**
1. Reduce Redis max memory in `docker-compose.yml`:
   ```yaml
   command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
   ```
2. Or upgrade to t3.small (2GB RAM) - adds ~$15/month

## Monitoring

### CloudWatch Logs

Elastic Beanstalk automatically sends logs to CloudWatch:

1. Go to CloudWatch console
2. Find `/aws/elasticbeanstalk/qontinui-prod/`
3. Monitor:
   - Application logs (backend)
   - Worker logs
   - Redis logs (via Docker)

### Application Metrics

Check `/health` endpoint:
```bash
curl https://qontinui-prod.eba-km2u4s23.eu-central-1.elasticbeanstalk.com/health
```

Should return:
```json
{
  "status": "healthy",
  "redis": "connected",
  "database": "connected",
  "arq": "connected"
}
```

## Scaling

### Current Setup (Single Instance)
- 1 backend process
- 1 worker process
- 1 Redis instance
- Good for: 100-1,000 users/day

### When to Scale

**Vertical Scaling (Bigger Instance):**
- If memory/CPU maxed out
- Upgrade to t3.small or t3.medium
- Cost: +$15-30/month

**Horizontal Scaling (Multiple Instances):**
- If traffic > 1,000 users/day
- Enable EB auto-scaling
- **Important**: Move Redis to ElastiCache first!
- Cost: Instance cost × number of instances

### Scaling with ElastiCache

When you need to scale to multiple instances:

1. **Create ElastiCache cluster** (see `AWS_ELASTICACHE_SETUP.md`)
2. **Update docker-compose.yml**:
   ```yaml
   # Remove redis service
   # Update backend and worker:
   environment:
     - REDIS_HOST=your-elasticache-endpoint.amazonaws.com
   ```
3. **Deploy**: All instances share same ElastiCache

## Cost Breakdown

**Current Setup (Single t3.micro):**
- EC2: ~$8/month
- RDS: ~$15/month (assuming db.t3.micro)
- Redis: $0 (included in EC2)
- **Total**: ~$23/month

**If Scaling to ElastiCache:**
- EC2: ~$8/month
- RDS: ~$15/month
- ElastiCache: ~$15/month
- **Total**: ~$38/month

## Next Steps

1. **Test locally** with `docker-compose up`
2. **Deploy to EB** with `eb deploy qontinui-prod`
3. **Verify** with `eb logs` and health endpoint
4. **Monitor** for a day to ensure stability
5. **Scale** if needed (see above)

## Rollback Plan

If something goes wrong:

```bash
# Roll back to previous version
eb deploy qontinui-prod --version <previous-version-label>

# Or
eb use qontinui-prod
eb deploy --staged  # Deploy last uploaded version
```

Your app will work without Redis (falls back to sync emails), so worst case it degrades gracefully.

## Support

If you run into issues:
1. Check logs: `eb logs qontinui-prod`
2. SSH in: `eb ssh qontinui-prod`
3. Check containers: `docker-compose ps` and `docker-compose logs`
4. Review health: `eb health qontinui-prod`

---

**Summary**: Redis is now configured for your Elastic Beanstalk deployment. Just run `eb deploy` and you'll have async email sending working in production at no extra cost! 🚀
