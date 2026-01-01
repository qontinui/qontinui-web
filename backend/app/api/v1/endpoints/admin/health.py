"""Admin health monitoring endpoints."""

from typing import Any

import structlog
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.v1.endpoints.admin.dependencies import require_admin
from app.models.user import User
from app.schemas.health import (
    DatabaseHealth,
    HealthOverview,
    HealthThresholds,
    RedisHealth,
    SecurityWarnings,
    SessionStats,
    TokenBlacklistStats,
)
from app.services.health_service import health_service

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.get("/system/health")
async def get_system_health(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get system health metrics."""
    # Database status
    try:
        await db.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as e:
        logger.warning("database_health_check_failed", error=str(e))
        db_status = "down"

    # Database connection info (simplified)
    db_connections = {
        "active": 1,
        "idle": 5,
        "max": 20,
    }

    # Try to get system resources
    try:
        import psutil

        disk = psutil.disk_usage("/")
        memory = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=0.1)

        storage = {
            "total_gb": disk.total / (1024**3),
            "used_gb": disk.used / (1024**3),
            "available_gb": disk.free / (1024**3),
            "usage_percent": disk.percent,
        }
        memory_info = {
            "total_mb": memory.total / (1024**2),
            "used_mb": memory.used / (1024**2),
            "available_mb": memory.available / (1024**2),
            "usage_percent": memory.percent,
        }
        cpu_usage = cpu_percent
    except Exception as e:
        logger.warning("system_metrics_unavailable", error=str(e))
        storage = {
            "total_gb": 0.0,
            "used_gb": 0.0,
            "available_gb": 0.0,
            "usage_percent": 0.0,
        }
        memory_info = {
            "total_mb": 0.0,
            "used_mb": 0.0,
            "available_mb": 0.0,
            "usage_percent": 0.0,
        }
        cpu_usage = 0.0

    return {
        "api_status": "healthy",
        "database_status": db_status,
        "database_connections": db_connections,
        "storage": storage,
        "memory": memory_info,
        "cpu_usage": cpu_usage,
        "uptime_hours": 24.0,  # Placeholder
        "last_backup": None,
        "recent_errors": [],
    }


@router.get("/health/overview", response_model=HealthOverview)
async def get_health_overview(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> HealthOverview:
    """
    Get comprehensive health overview with all system metrics.

    Returns detailed status for:
    - Redis availability and performance
    - Database connection pool and status
    - Token blacklist statistics
    - Security warnings and suspicious activity
    - Session statistics and adoption rates
    - System resources (CPU, memory, disk)

    Cached for 30 seconds to avoid overwhelming system with health checks.
    """
    overview = await health_service.get_health_overview(db)
    return HealthOverview(**overview)


@router.get("/health/redis", response_model=RedisHealth)
async def get_health_redis(
    current_user: User = Depends(require_admin),
) -> RedisHealth:
    """
    Get detailed Redis health status and metrics.

    Returns:
    - Connection status (healthy/degraded/down/disabled)
    - Uptime and performance metrics
    - Memory usage and availability
    - Connected clients count
    - Operations per second
    - Alert level based on thresholds
    """
    redis_status = await health_service.get_redis_status()
    return RedisHealth(**redis_status)


@router.get("/health/database", response_model=DatabaseHealth)
async def get_health_database(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> DatabaseHealth:
    """
    Get database health status and connection pool metrics.

    Returns:
    - Connection status
    - Pool size and usage
    - Active vs idle connections
    - Pool usage percentage
    - Alert level based on thresholds
    """
    db_health = await health_service.get_database_health(db)
    return DatabaseHealth(**db_health)


@router.get("/health/security", response_model=SecurityWarnings)
async def get_health_security(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> SecurityWarnings:
    """
    Get security warnings and suspicious activity alerts.

    Returns (last 24 hours):
    - Device fingerprint mismatches
    - New device registrations
    - Failed login attempts
    - Untrusted devices count
    - Users with multiple devices
    - Alert level and recommendations
    """
    security = await health_service.get_security_warnings(db)
    return SecurityWarnings(**security)


@router.get("/health/sessions", response_model=SessionStats)
async def get_health_sessions(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> SessionStats:
    """
    Get session statistics and adoption metrics.

    Returns:
    - Total active sessions
    - Remember me vs standard session counts
    - Remember me adoption rate (%)
    - Average session age
    - Sessions expiring soon (within 1 hour)
    - Recent activity metrics
    """
    sessions = await health_service.get_session_stats(db)
    return SessionStats(**sessions)


@router.get("/health/blacklist", response_model=TokenBlacklistStats)
async def get_health_blacklist(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> TokenBlacklistStats:
    """
    Get token blacklist statistics.

    Returns:
    - Storage mode (redis/memory/disabled)
    - Number of blacklisted tokens
    - Estimated size in MB
    - Redis keys count (if Redis mode)
    - Availability status
    """
    blacklist = await health_service.get_token_blacklist_stats(db)
    return TokenBlacklistStats(**blacklist)


@router.get("/health/thresholds", response_model=HealthThresholds)
async def get_health_thresholds(
    current_user: User = Depends(require_admin),
) -> HealthThresholds:
    """
    Get current health monitoring thresholds configuration.

    Returns all alert thresholds for:
    - System resources (CPU, memory, disk)
    - Redis memory usage
    - Security events (device mismatches, failed logins, new devices)
    - Database connection pool
    """
    return HealthThresholds(**health_service.THRESHOLDS)  # type: ignore[arg-type]
