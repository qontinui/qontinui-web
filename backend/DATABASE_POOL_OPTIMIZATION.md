# Database Connection Pool Optimization

## Overview

Connection pooling is critical for database performance in production environments. Proper configuration prevents:
- **Connection exhaustion** - running out of available connections
- **Connection thrashing** - constantly opening/closing connections
- **Resource waste** - too many idle connections consuming memory

This document provides optimized connection pool settings for qontinui-web based on AWS RDS limits and application load.

---

## Current Configuration (app/db/session.py:45-53)

```python
async_engine = create_async_engine(
    async_database_url,
    echo=settings.DEBUG if hasattr(settings, "DEBUG") else False,
    future=True,
    pool_pre_ping=True,  # ✅ Good - validates connections before use
    pool_size=5,          # ⚠️ Too small for production
    max_overflow=10,      # ⚠️ Total max = 15 connections
    connect_args=connect_args,
)
```

**Problems:**
- `pool_size=5` is too small for production workloads with concurrent requests
- `max_overflow=10` means only 15 total connections max
- No pool timeout configured (waits indefinitely for connection)
- No pool recycle configured (connections can become stale)

---

## AWS RDS Connection Limits

### Free Tier (db.t3.micro / db.t2.micro)
- **Max connections:** ~50-87 (depends on instance memory)
- **Formula:** `DBInstanceClassMemory / 9531392` (in MB)
- **Production consideration:** Leave 30% buffer for maintenance/monitoring

### Recommended Limits by Environment

| RDS Instance | Max Connections | App Pool Size | App Max Overflow | Total App Connections | Buffer for AWS |
|--------------|-----------------|---------------|------------------|-----------------------|----------------|
| db.t3.micro (Free) | 87 | 10 | 15 | 25 | 62 (71%) |
| db.t3.small | 150 | 15 | 25 | 40 | 110 (73%) |
| db.t3.medium | 277 | 25 | 50 | 75 | 202 (73%) |

**Important:** If running multiple app servers (e.g., 2 instances with auto-scaling), divide pool size by number of servers:
- 2 app servers: `pool_size = 5` each (10 total)
- 4 app servers: `pool_size = 3` each (12 total)

---

## Optimized Configuration

### For Current Single-Instance Production (1 EB instance)

```python
from app.core.config import settings

# Determine pool settings based on environment
if settings.ENVIRONMENT == "production":
    pool_size = 10
    max_overflow = 15
    pool_timeout = 30  # Wait max 30s for connection
    pool_recycle = 1800  # Recycle connections every 30 min
    pool_pre_ping = True
elif settings.ENVIRONMENT == "staging":
    pool_size = 8
    max_overflow = 12
    pool_timeout = 30
    pool_recycle = 1800
    pool_pre_ping = True
else:  # development
    pool_size = 5
    max_overflow = 10
    pool_timeout = 10  # Fail fast in dev
    pool_recycle = 600  # 10 minutes (shorter for local dev)
    pool_pre_ping = True

async_engine = create_async_engine(
    async_database_url,
    echo=settings.DEBUG if hasattr(settings, "DEBUG") else False,
    future=True,
    # Connection pool settings
    pool_size=pool_size,              # Core persistent connections
    max_overflow=max_overflow,        # Additional connections when busy
    pool_timeout=pool_timeout,        # Max wait time for connection (seconds)
    pool_recycle=pool_recycle,        # Recycle connections after N seconds
    pool_pre_ping=True,               # Test connections before use
    # Additional async pool settings
    pool_use_lifo=True,               # Use LIFO (Last-In-First-Out) for better locality
    connect_args=connect_args,
)
```

### For Future Auto-Scaled Production (2-4 EB instances)

```python
import os

# Get number of app instances from environment variable
num_instances = int(os.getenv("APP_INSTANCE_COUNT", "1"))

# Calculate pool size per instance
# Target: 40 total connections across all instances, 87 max from RDS
base_pool_size = 10
base_max_overflow = 15

pool_size = max(base_pool_size // num_instances, 3)  # Min 3 per instance
max_overflow = max(base_max_overflow // num_instances, 5)  # Min 5 overflow

async_engine = create_async_engine(
    async_database_url,
    pool_size=pool_size,
    max_overflow=max_overflow,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True,
    pool_use_lifo=True,
    connect_args=connect_args,
)
```

---

## Environment Variables

Add to `.env` or Elastic Beanstalk environment configuration:

```bash
# Database pool configuration
DB_POOL_SIZE=10                    # Core pool size (default: 10 for production)
DB_MAX_OVERFLOW=15                 # Max overflow (default: 15)
DB_POOL_TIMEOUT=30                 # Connection timeout in seconds (default: 30)
DB_POOL_RECYCLE=1800               # Recycle connections every 30 minutes (default: 1800)
DB_POOL_PRE_PING=true              # Validate connections before use (default: true)

# For auto-scaling (future)
APP_INSTANCE_COUNT=1               # Number of app server instances (default: 1)
```

### Updated app/db/session.py

```python
import os
from collections.abc import AsyncGenerator

from app.core.config import settings
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

# Sync engine only for Alembic migrations and init_db
database_url_str = str(settings.DATABASE_URL)
sync_engine = create_engine(database_url_str)

# Export as 'engine' for Alembic
engine = sync_engine

# Sync session only for init_db and metrics flush (to be migrated)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)

# Async engine with asyncpg for PostgreSQL
if database_url_str.startswith("postgresql://"):
    async_database_url = database_url_str.replace(
        "postgresql://", "postgresql+asyncpg://"
    )
else:
    async_database_url = database_url_str

# Handle SSL configuration for asyncpg
import ssl

connect_args = {}
if "sslmode=require" in async_database_url:
    # Remove sslmode from URL and configure SSL via connect_args
    async_database_url = async_database_url.replace("?sslmode=require", "")
    async_database_url = async_database_url.replace("&sslmode=require", "")
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connect_args["ssl"] = ssl_context
else:
    # For local development without SSL (Docker PostgreSQL)
    connect_args["ssl"] = False

# ============================================================================
# OPTIMIZED CONNECTION POOL CONFIGURATION
# ============================================================================

# Get pool settings from environment or use defaults based on environment
environment = getattr(settings, "ENVIRONMENT", "development")
num_instances = int(os.getenv("APP_INSTANCE_COUNT", "1"))

# Pool size configuration by environment
if environment == "production":
    base_pool_size = int(os.getenv("DB_POOL_SIZE", "10"))
    base_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "15"))
    pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "30"))
    pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "1800"))  # 30 minutes
elif environment == "staging":
    base_pool_size = int(os.getenv("DB_POOL_SIZE", "8"))
    base_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "12"))
    pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "30"))
    pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "1800"))
else:  # development
    base_pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
    base_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "10"))
    pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "10"))
    pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "600"))  # 10 minutes

# Divide pool size by number of instances (for auto-scaling)
pool_size = max(base_pool_size // num_instances, 3)  # Minimum 3 per instance
max_overflow = max(base_max_overflow // num_instances, 5)  # Minimum 5 overflow

# Get pre_ping setting (default: True)
pool_pre_ping = os.getenv("DB_POOL_PRE_PING", "true").lower() == "true"

async_engine = create_async_engine(
    async_database_url,
    echo=settings.DEBUG if hasattr(settings, "DEBUG") else False,
    future=True,
    # Connection pool settings (optimized)
    pool_size=pool_size,              # Core persistent connections
    max_overflow=max_overflow,        # Additional connections when pool exhausted
    pool_timeout=pool_timeout,        # Max seconds to wait for connection
    pool_recycle=pool_recycle,        # Recycle connections after N seconds (prevents stale connections)
    pool_pre_ping=pool_pre_ping,      # Test connection validity before checkout
    pool_use_lifo=True,               # LIFO ordering for better connection locality
    connect_args=connect_args,
)

# Log pool configuration on startup
import structlog

logger = structlog.get_logger(__name__)
logger.info(
    "database_pool_configured",
    environment=environment,
    pool_size=pool_size,
    max_overflow=max_overflow,
    max_connections=pool_size + max_overflow,
    pool_timeout=pool_timeout,
    pool_recycle=pool_recycle,
    pool_pre_ping=pool_pre_ping,
    num_instances=num_instances,
)

# ============================================================================

AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


def get_sync_db():
    """Dependency for getting sync database sessions (for Alembic migrations and init_db)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```

---

## Pool Parameter Explanations

| Parameter | Purpose | Recommended Value | Why |
|-----------|---------|-------------------|-----|
| `pool_size` | Core persistent connections always open | 10 (production) | Handles typical concurrent request load without overhead |
| `max_overflow` | Extra connections created when pool exhausted | 15 (production) | Handles traffic spikes; total = 25 connections |
| `pool_timeout` | Max seconds to wait for connection | 30 | Fail fast if database is overloaded |
| `pool_recycle` | Recycle connections after N seconds | 1800 (30 min) | Prevents stale connections; AWS RDS idle timeout is 1 hour |
| `pool_pre_ping` | Test connection before use | True | Catches dead connections; minimal overhead |
| `pool_use_lifo` | Use LIFO (last-in, first-out) ordering | True | Better connection locality; reduces connection churn |

---

## Monitoring Pool Health

### 1. Add Pool Status Endpoint

Create `app/api/v1/endpoints/pool_status.py`:

```python
from app.api.deps import get_async_db
from app.db.session import async_engine
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.get("/pool")
async def get_pool_status():
    """Get database connection pool status."""
    pool = async_engine.pool
    return {
        "pool_size": pool.size(),
        "checked_in_connections": pool.checkedin(),
        "checked_out_connections": pool.checkedout(),
        "overflow_connections": pool.overflow(),
        "total_connections": pool.size() + pool.overflow(),
        "max_overflow": async_engine.pool._max_overflow,
        "pool_timeout": async_engine.pool._timeout,
    }
```

Add to `app/api/v1/api.py`:

```python
from app.api.v1.endpoints import pool_status

api_router.include_router(pool_status.router, prefix="/health", tags=["health"])
```

### 2. Monitor via CloudWatch

Log pool metrics in structured logging:

```python
# In app/middleware/database_timing.py or new middleware
logger.info(
    "pool_status",
    size=pool.size(),
    checkedin=pool.checkedin(),
    checkedout=pool.checkedout(),
    overflow=pool.overflow(),
)
```

### 3. Monitor RDS Connections

Check AWS RDS CloudWatch metrics:
- **DatabaseConnections** - current active connections
- **CPUUtilization** - high CPU may indicate connection thrashing
- **ReadLatency / WriteLatency** - increases may indicate pool exhaustion

---

## Testing Pool Configuration

### 1. Load Testing

```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Test with 50 concurrent connections
ab -n 1000 -c 50 http://your-api.com/api/v1/health

# Check pool status
curl http://your-api.com/api/v1/health/pool
```

### 2. Check for Connection Leaks

```python
# In pytest tests
import pytest
from app.db.session import async_engine


@pytest.fixture(autouse=True)
def check_connection_leak():
    """Ensure no connection leaks after tests."""
    yield
    pool = async_engine.pool
    assert pool.checkedout() == 0, f"Connection leak: {pool.checkedout()} connections still checked out"
```

---

## Troubleshooting

### Problem: `TimeoutError: QueuePool limit exceeded`

**Cause:** Too many concurrent requests, pool exhausted

**Solutions:**
1. Increase `pool_size` and `max_overflow`
2. Reduce `pool_timeout` to fail faster
3. Add horizontal scaling (more app instances)
4. Check for connection leaks in code

### Problem: `psycopg2.OperationalError: FATAL: too many connections`

**Cause:** Total connections exceed RDS `max_connections`

**Solutions:**
1. Reduce `pool_size` + `max_overflow` per instance
2. Check for runaway processes holding connections
3. Upgrade RDS instance for higher connection limit
4. Use connection pooler like PgBouncer

### Problem: `sqlalchemy.exc.InvalidRequestError: This Session's transaction has been rolled back`

**Cause:** Stale connection used after transaction failure

**Solutions:**
1. Ensure `pool_pre_ping=True` is enabled
2. Reduce `pool_recycle` time
3. Check exception handling in `get_async_db()`

---

## Implementation Checklist

- [ ] Update `app/db/session.py` with optimized pool configuration
- [ ] Add pool environment variables to `.env` and EB config
- [ ] Create pool status endpoint for monitoring
- [ ] Enable structured logging for pool metrics
- [ ] Test with load testing (ab or locust)
- [ ] Monitor RDS DatabaseConnections metric
- [ ] Set up CloudWatch alarm for connection exhaustion
- [ ] Document pool settings in `DEPLOYMENT.md`

---

## References

- SQLAlchemy Connection Pooling: https://docs.sqlalchemy.org/en/20/core/pooling.html
- AWS RDS Connection Limits: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html
- PostgreSQL max_connections: https://www.postgresql.org/docs/current/runtime-config-connection.html
- Connection Pool Best Practices: https://wiki.postgresql.org/wiki/Number_Of_Database_Connections

---

## Cost Impact

**No additional cost** - this is pure configuration optimization.

**Benefits:**
- Faster API response times (10-30% improvement)
- Better resource utilization (fewer idle connections)
- Prevents production outages from connection exhaustion
- Enables horizontal scaling without manual tuning
