"""
Database health check functions.

Monitors database connectivity, connection pool statistics,
and pool usage alerts.
"""

from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.health.thresholds import THRESHOLDS

logger = structlog.get_logger(__name__)


async def get_database_health(db: AsyncSession) -> dict[str, Any]:
    """
    Get database health metrics.

    Args:
        db: Database session

    Returns:
        Dictionary with database health:
        - status: "healthy" or "down"
        - connection_status: Connection test result
        - pool_size: Total pool size
        - active_connections: Current active connections
        - idle_connections: Current idle connections
        - alert_level: "healthy", "warning", or "critical"
    """
    try:
        from sqlalchemy import text

        # Test database connection
        await db.execute(text("SELECT 1"))
        connection_status = "connected"

        # Try to get pool statistics (may not be available in all environments)
        pool_size = 0
        active = 0
        idle = 0
        pool_usage_percent = 0.0
        pool_stats_available = False

        try:
            bind = db.get_bind()
            if hasattr(bind, "pool"):
                pool = bind.pool
                if hasattr(pool, "size") and hasattr(pool, "checked_out_connections"):
                    pool_size = pool.size()
                    checked_out = pool.checked_out_connections
                    active = checked_out
                    idle = pool_size - checked_out
                    pool_usage_percent = (
                        (active / pool_size * 100) if pool_size > 0 else 0.0
                    )
                    pool_stats_available = True
        except Exception as pool_error:
            # Pool statistics not available in this environment (e.g., AWS with async pools)
            logger.warning("pool_statistics_unavailable", error=str(pool_error))

        # Determine alert level based on pool usage (if available)
        alert_level = "healthy"
        status = "healthy"

        if pool_stats_available:
            if pool_usage_percent >= THRESHOLDS["db_connections_critical"]:
                alert_level = "critical"
                status = "degraded"
            elif pool_usage_percent >= THRESHOLDS["db_connections_warning"]:
                alert_level = "warning"
                status = "healthy"

        return {
            "status": status,
            "connection_status": connection_status,
            "pool_size": pool_size,
            "active_connections": active,
            "idle_connections": idle,
            "pool_usage_percent": round(pool_usage_percent, 2),
            "alert_level": alert_level,
            "pool_stats_available": pool_stats_available,
        }

    except Exception as e:
        logger.error("database_health_check_failed", error=str(e))
        return {
            "status": "down",
            "connection_status": "failed",
            "pool_size": 0,
            "active_connections": 0,
            "idle_connections": 0,
            "pool_usage_percent": 0.0,
            "alert_level": "critical",
            "error": str(e),
            "pool_stats_available": False,
        }
