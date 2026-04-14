"""
Redis health check functions.

Provides Redis status monitoring and token blacklist statistics.
"""

import time
from typing import Any

import structlog
from app.config.redis_config import RedisConfig
from app.core.config import settings
from app.services.health.thresholds import THRESHOLDS
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


async def get_redis_status() -> dict[str, Any]:
    """
    Get detailed Redis status and metrics.

    Returns:
        Dictionary with Redis health information including:
        - status: "healthy", "degraded", or "down"
        - available: boolean
        - uptime_seconds: Redis uptime
        - memory_used_mb: Memory used by Redis
        - memory_total_mb: Total memory available to Redis
        - memory_percent: Memory usage percentage
        - connected_clients: Number of connected clients
        - ops_per_second: Operations per second (if available)
        - alert_level: "healthy", "warning", or "critical"
    """
    if not settings.REDIS_ENABLED:
        return {
            "status": "disabled",
            "available": False,
            "mode": "disabled",
            "alert_level": "healthy",
            "message": "Redis is disabled in configuration",
        }

    try:
        redis_client = await RedisConfig.get_client()

        # Test connection with ping
        start_time = time.time()
        await redis_client.ping()
        ping_time_ms = (time.time() - start_time) * 1000

        # Get Redis info
        info = await redis_client.info()

        # Extract metrics
        uptime_seconds = info.get("uptime_in_seconds", 0)
        memory_used = info.get("used_memory", 0)
        memory_total = info.get("maxmemory", 0)

        # Calculate memory percentage
        if memory_total > 0:
            memory_percent = (memory_used / memory_total) * 100
        else:
            # If maxmemory not set, use system memory
            memory_percent = 0.0

        connected_clients = info.get("connected_clients", 0)

        # Operations per second
        ops_per_second = info.get("instantaneous_ops_per_sec", 0)

        # Determine alert level
        alert_level = "healthy"
        if memory_percent >= THRESHOLDS["redis_memory_critical"]:
            alert_level = "critical"
            status = "degraded"
        elif memory_percent >= THRESHOLDS["redis_memory_warning"]:
            alert_level = "warning"
            status = "healthy"
        else:
            status = "healthy"

        return {
            "status": status,
            "available": True,
            "uptime_seconds": uptime_seconds,
            "uptime_hours": round(uptime_seconds / 3600, 2),
            "memory_used_mb": round(memory_used / (1024 * 1024), 2),
            "memory_total_mb": (
                round(memory_total / (1024 * 1024), 2) if memory_total > 0 else None
            ),
            "memory_percent": round(memory_percent, 2),
            "connected_clients": connected_clients,
            "ops_per_second": ops_per_second,
            "ping_time_ms": round(ping_time_ms, 2),
            "alert_level": alert_level,
            "redis_version": info.get("redis_version", "unknown"),
        }

    except RedisError as e:
        logger.error("redis_health_check_failed", error=str(e))
        return {
            "status": "down",
            "available": False,
            "alert_level": "critical",
            "error": str(e),
        }
    except Exception as e:
        logger.error("redis_health_check_error", error=str(e))
        return {
            "status": "down",
            "available": False,
            "alert_level": "critical",
            "error": str(e),
        }


async def get_token_blacklist_stats(db: AsyncSession) -> dict[str, Any]:
    """
    Get token blacklist statistics.

    Args:
        db: Database session

    Returns:
        Dictionary with blacklist information:
        - mode: "redis" or "memory"
        - count: Number of blacklisted tokens
        - size_mb: Estimated size in megabytes
        - redis_keys: Number of Redis keys (if Redis mode)
    """
    mode = "redis" if settings.REDIS_ENABLED else "memory"

    try:
        if settings.REDIS_ENABLED:
            redis_client = await RedisConfig.get_client()

            # Count blacklist keys (pattern: token:blacklist:*)
            keys = []
            async for key in redis_client.scan_iter(match="token:blacklist:*"):
                keys.append(key)

            count = len(keys)

            # Estimate size (rough estimate: 100 bytes per token)
            estimated_size_bytes = count * 100
            size_mb = round(estimated_size_bytes / (1024 * 1024), 4)

            return {
                "mode": mode,
                "count": count,
                "size_mb": size_mb,
                "redis_keys": count,
                "available": True,
            }
        else:
            # In-memory mode - no way to get exact count without implementation
            return {
                "mode": mode,
                "count": 0,
                "size_mb": 0.0,
                "available": True,
                "note": "In-memory blacklist - count not available",
            }

    except Exception as e:
        logger.error("token_blacklist_stats_error", error=str(e))
        return {
            "mode": mode,
            "count": 0,
            "size_mb": 0.0,
            "available": False,
            "error": str(e),
        }
