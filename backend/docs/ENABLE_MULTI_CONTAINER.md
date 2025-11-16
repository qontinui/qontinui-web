# Enable Multi-Container Docker on Elastic Beanstalk

Your current EB environment uses **single-container Docker** platform. To run Redis + Backend + Worker, you need to switch to **multi-container Docker**.

## Current Situation

- Platform: `Docker running on 64bit Amazon Linux 2023/4.7.1` (single-container)
- Can only run ONE Docker container
- docker-compose.yml is ignored

## Option 1: Switch to Multi-Container Platform (Recommended)

### Steps:

1. **Create a new environment with Docker Compose platform**:
   ```bash
   eb create qontinui-prod-v2 --platform "Docker Compose running on 64bit Amazon Linux 2023"
   ```

2. **Deploy to new environment**:
   ```bash
   eb deploy qontinui-prod-v2
   ```

3. **Test the new environment**:
   ```bash
   eb open qontinui-prod-v2
   curl https://qontinui-prod-v2...elasticbeanstalk.com/health
   ```

4. **Swap CNAMEs (zero downtime)**:
   ```bash
   eb swap qontinui-prod --destination qontinui-prod-v2
   ```

5. **Verify and cleanup**:
   ```bash
   # Test old URL now points to new environment
   curl https://qontinui-prod.eba-km2u4s23.eu-central-1.elasticbeanstalk.com/health

   # Terminate old environment when confident
   eb terminate qontinui-prod-v2  # This terminates the OLD code
   ```

### What You Get:
- ✅ Redis running in a container
- ✅ Worker processing background jobs
- ✅ All 3 containers on same t3.micro ($0 extra)
- ✅ Zero downtime switchover

## Option 2: Install Redis on EC2 (Alternative)

If you want to keep single-container platform:

1. **SSH into your instance**:
   ```bash
   eb ssh qontinui-prod
   ```

2. **Install Redis**:
   ```bash
   sudo yum install redis -y
   sudo systemctl start redis
   sudo systemctl enable redis
   ```

3. **Add worker as systemd service**:
   Create `/etc/systemd/system/qontinui-worker.service`:
   ```ini
   [Unit]
   Description=Qontinui ARQ Worker
   After=network.target redis.service docker.service
   Requires=redis.service

   [Service]
   Type=simple
   User=ec2-user
   ExecStart=/bin/bash -c 'eval $(docker inspect -f \"{{ range .Config.Env }}export {{ . }};{{ end }}\" $(docker ps -q)) && docker exec -i $(docker ps -q) python run_worker.py'
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

4. **Enable worker**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable qontinui-worker
   sudo systemctl start qontinui-worker
   ```

### What You Get:
- ✅ Redis running on EC2 (not containerized)
- ✅ Worker running on EC2 (not containerized)
- ❌ More manual setup
- ❌ Worker process needs to be updated on each deployment

## Option 3: Use ElastiCache (~$15/month)

See `AWS_ELASTICACHE_SETUP.md` for full guide.

Quick setup:
```bash
./scripts/setup-elasticache.sh production <vpc-id> <subnet-1> <subnet-2> <backend-sg>
```

### What You Get:
- ✅ Managed Redis (AWS handles updates, backups)
- ✅ High availability
- ✅ Works with current single-container setup
- ❌ Costs ~$15/month

## Recommended Approach

**For your stage**: Use **Option 1 - Switch to Multi-Container Platform**

**Why?**
1. Free (no extra cost)
2. Clean architecture (all containers together)
3. Easy to deploy and manage
4. Can upgrade to ElastiCache later if needed

## Implementation Guide for Option 1

### Step-by-Step:

```bash
# 1. Create new multi-container environment
eb create qontinui-multi --platform "Docker Compose running on 64bit Amazon Linux 2023" --instance-type t3.micro --region eu-central-1

# 2. Deploy
eb deploy qontinui-multi

# 3. Wait for deployment (2-3 minutes)
eb health qontinui-multi

# 4. Test health endpoint
curl https://qontinui-multi...elasticbeanstalk.com/health
# Should show: "redis": "connected", "arq": "connected"

# 5. Test registration (should enqueue email)
curl -X POST https://qontinui-multi...elasticbeanstalk.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "TestPass123!",
    "full_name": "Test User"
  }'

# 6. Check logs for worker activity
eb logs qontinui-multi | grep -i "sending verification email"

# 7. If all good, swap URLs (zero downtime)
eb swap qontinui-prod --destination qontinui-multi

# 8. Verify old URL now points to new environment
curl https://qontinui-prod.eba-km2u4s23.eu-central-1.elasticbeanstalk.com/health

# 9. Terminate old environment (the one WITHOUT Redis)
# First check which environment has old code:
eb list
# Then terminate it:
eb terminate qontinui-multi  # or whatever name has old code
```

### Troubleshooting

**If health check fails**:
```bash
eb logs qontinui-multi | grep -i error
```

**Common issues**:
1. **Out of memory**: Reduce Redis maxmemory in docker-compose.yml to 128mb
2. **Containers not starting**: Check logs with `eb ssh` then `docker-compose logs`
3. **Worker not processing**: Check `eb logs` for worker container logs

### Resource Check

Your t3.micro (1GB RAM):
- Redis: 256MB
- Backend: 384MB
- Worker: 256MB
- System: ~100MB
- **Total**: ~996MB (fits!)

If you get OOM errors, reduce Redis to 128MB in docker-compose.yml.

## Summary

You have 3 options for Redis:
1. **Multi-container EB** (free, recommended) - Switch platform
2. **Redis on EC2** (free, manual) - Install directly on instance
3. **ElastiCache** (~$15/month, managed) - Use AWS service

I recommend **Option 1** for your current stage. It's free, clean, and easy to manage.

When ready to deploy, just run:
```bash
eb create qontinui-multi --platform "Docker Compose running on 64bit Amazon Linux 2023"
```
