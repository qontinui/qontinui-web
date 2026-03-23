# Redis on EC2 Setup (Free Alternative to ElastiCache)

This guide shows how to install and run Redis on your existing EC2 instance at no additional cost.

## When to Use This Approach

✅ **Use EC2 Redis when:**
- Starting out or on a tight budget
- Processing < 10,000 jobs/day
- Single-server deployment
- Development/staging environments
- Small to medium applications

❌ **Upgrade to ElastiCache when:**
- Need 99.9%+ uptime (multi-AZ failover)
- Processing > 50,000 jobs/day
- Multi-server architecture
- Have budget for managed services (~$15/month)

## Installation on EC2

### For Amazon Linux 2 / Amazon Linux 2023

```bash
# SSH into your EC2 instance
ssh ec2-user@your-ec2-instance

# Update packages
sudo yum update -y

# Install Redis
sudo yum install redis -y

# Start Redis
sudo systemctl start redis

# Enable Redis to start on boot
sudo systemctl enable redis

# Verify it's running
redis-cli ping  # Should return "PONG"
```

### For Ubuntu EC2

```bash
# SSH into your EC2 instance
ssh ubuntu@your-ec2-instance

# Update packages
sudo apt-get update

# Install Redis
sudo apt-get install redis-server -y

# Start Redis
sudo systemctl start redis-server

# Enable Redis to start on boot
sudo systemctl enable redis-server

# Verify it's running
redis-cli ping  # Should return "PONG"
```

## Configure Redis

Edit Redis configuration for production:

```bash
sudo nano /etc/redis/redis.conf
# Or on Ubuntu: sudo nano /etc/redis.conf
```

**Recommended changes:**

```conf
# Bind to localhost only (security)
bind 127.0.0.1 ::1

# Set max memory (e.g., 512MB for t3.small, 256MB for t3.micro)
maxmemory 256mb

# Eviction policy (remove least recently used keys when memory full)
maxmemory-policy allkeys-lru

# Enable persistence (save data to disk)
save 900 1       # Save after 900 seconds if at least 1 key changed
save 300 10      # Save after 300 seconds if at least 10 keys changed
save 60 10000    # Save after 60 seconds if at least 10000 keys changed

# Enable AOF for durability (optional, uses more disk)
appendonly yes
appendfsync everysec

# Log level
loglevel notice

# Log file location
logfile /var/log/redis/redis-server.log
```

**Restart Redis after changes:**

```bash
sudo systemctl restart redis
# Or: sudo systemctl restart redis-server (Ubuntu)
```

## Configure Your Application

Since Redis is on the same server, use localhost:

```bash
# In your .env file
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
```

## Deploy Both API and Worker on Same EC2

### Option 1: Using Systemd Services

**Create API service** (`/etc/systemd/system/qontinui-web.service`):

```ini
[Unit]
Description=Qontinui FastAPI Application
After=network.target redis.service
Requires=redis.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/qontinui-backend
Environment="PATH=/opt/qontinui-backend/.venv/bin"
ExecStart=/opt/qontinui-backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Create Worker service** (`/etc/systemd/system/qontinui-worker.service`):

```ini
[Unit]
Description=Qontinui ARQ Worker
After=network.target redis.service
Requires=redis.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/qontinui-backend
Environment="PATH=/opt/qontinui-backend/.venv/bin"
ExecStart=/opt/qontinui-backend/.venv/bin/python run_worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start services:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable qontinui-web qontinui-worker
sudo systemctl start qontinui-web qontinui-worker

# Check status
sudo systemctl status qontinui-web
sudo systemctl status qontinui-worker
```

### Option 2: Using Docker Compose on EC2

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru

  backend:
    build: .
    restart: always
    ports:
      - "8000:8000"
    depends_on:
      - redis
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - DATABASE_URL=${DATABASE_URL}
      - SECRET_KEY=${SECRET_KEY}
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000

  worker:
    build: .
    restart: always
    depends_on:
      - redis
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - DATABASE_URL=${DATABASE_URL}
    command: python run_worker.py

volumes:
  redis_data:
```

Deploy:

```bash
docker-compose up -d
```

## Monitoring

### Check Redis Stats

```bash
# Connect to Redis CLI
redis-cli

# Inside redis-cli:
INFO                    # Full stats
INFO stats              # Stats only
INFO memory             # Memory usage
DBSIZE                  # Number of keys
MONITOR                 # Watch commands in real-time (Ctrl+C to exit)
```

### Monitor Redis Memory

```bash
# Check memory usage
redis-cli INFO memory | grep used_memory_human

# Check if evictions are happening (should be 0 or low)
redis-cli INFO stats | grep evicted_keys
```

### Monitor Worker Jobs

```bash
# View worker logs
sudo journalctl -u qontinui-worker -f

# Or with Docker:
docker-compose logs -f worker
```

## Backup and Restore

### Manual Backup

```bash
# Redis will save to /var/lib/redis/dump.rdb automatically
# Force a save now:
redis-cli BGSAVE

# Copy backup
sudo cp /var/lib/redis/dump.rdb /backup/redis-$(date +%Y%m%d).rdb
```

### Automated Daily Backups

Create a cron job:

```bash
# Edit crontab
sudo crontab -e

# Add this line (backup daily at 3 AM)
0 3 * * * redis-cli BGSAVE && cp /var/lib/redis/dump.rdb /backup/redis-$(date +\%Y\%m\%d).rdb
```

### Restore from Backup

```bash
# Stop Redis
sudo systemctl stop redis

# Replace dump file
sudo cp /backup/redis-20250113.rdb /var/lib/redis/dump.rdb
sudo chown redis:redis /var/lib/redis/dump.rdb

# Start Redis
sudo systemctl start redis
```

## Security Best Practices

1. **Bind to localhost only** (already configured above)
   - Redis is only accessible from the same server
   - No external access needed

2. **Set password** (optional, adds slight overhead):
   ```bash
   # In /etc/redis/redis.conf
   requirepass your-strong-password-here

   # Update your app's .env
   REDIS_PASSWORD=your-strong-password-here
   ```

3. **Rename dangerous commands** (optional):
   ```bash
   # In /etc/redis/redis.conf
   rename-command FLUSHDB ""
   rename-command FLUSHALL ""
   rename-command CONFIG "CONFIG-a1b2c3d4"
   ```

4. **Firewall rules** (Redis should NOT be exposed):
   ```bash
   # Verify Redis is NOT listening on external interface
   sudo netstat -tlnp | grep 6379
   # Should show: 127.0.0.1:6379 (not 0.0.0.0:6379)
   ```

## Troubleshooting

### Redis Won't Start

```bash
# Check logs
sudo journalctl -u redis -n 50

# Common issue: Port already in use
sudo netstat -tlnp | grep 6379

# Kill existing Redis
sudo pkill redis-server
sudo systemctl start redis
```

### Out of Memory

```bash
# Check memory usage
redis-cli INFO memory

# Clear all data (WARNING: deletes everything)
redis-cli FLUSHALL

# Or increase maxmemory in redis.conf
sudo nano /etc/redis/redis.conf
# maxmemory 512mb
sudo systemctl restart redis
```

### Worker Can't Connect

```bash
# Test Redis connection
redis-cli ping

# Check Redis is listening
sudo netstat -tlnp | grep 6379

# Check environment variables
printenv | grep REDIS

# Check worker logs
sudo journalctl -u qontinui-worker -n 50
```

### Slow Performance

```bash
# Check for slow queries
redis-cli SLOWLOG GET 10

# Check if swapping to disk
redis-cli INFO stats | grep swapped

# Check connected clients
redis-cli INFO clients
```

## Performance Tuning

### For t3.micro (1GB RAM)
```conf
maxmemory 256mb
```

### For t3.small (2GB RAM)
```conf
maxmemory 512mb
```

### For t3.medium (4GB RAM)
```conf
maxmemory 1gb
```

**Rule of thumb**: Allocate 25-50% of server RAM to Redis

## When to Upgrade to ElastiCache

Consider upgrading when:

1. **High Traffic**: > 1,000 users/day or > 10,000 jobs/day
2. **Need HA**: Can't afford any downtime
3. **Multi-Server**: Running multiple backend instances
4. **Have Revenue**: $15/month is negligible compared to sales
5. **Want Managed**: Don't want to maintain Redis yourself

## Cost Comparison

| Solution | Monthly Cost | Setup Time | Maintenance |
|----------|-------------|------------|-------------|
| Redis on EC2 | $0 | 10 minutes | You manage |
| ElastiCache t3.micro | ~$15 | 15 minutes | AWS manages |
| ElastiCache t3.small | ~$30 | 15 minutes | AWS manages |

## Migration Path

When ready to migrate to ElastiCache:

1. Create ElastiCache cluster (see `AWS_ELASTICACHE_SETUP.md`)
2. Update `REDIS_HOST` environment variable
3. Deploy changes
4. Stop local Redis: `sudo systemctl stop redis`

Zero downtime - just point to new endpoint!

## Summary

Running Redis on EC2 is:
- ✅ **Free** (no additional costs)
- ✅ **Simple** (10 minute setup)
- ✅ **Sufficient** for most small-medium apps
- ✅ **Easy to upgrade** to ElastiCache later

Start here, upgrade when you need to. Your app gets all the async/scalability benefits without the extra cost.
