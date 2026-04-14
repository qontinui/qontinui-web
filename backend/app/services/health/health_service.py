"""
Health service facade.

Composes all health sub-services into a single overview endpoint.
"""

from datetime import UTC, datetime
from typing import Any

from app.services.health.database_health import get_database_health
from app.services.health.redis_health import (get_redis_status,
                                              get_token_blacklist_stats)
from app.services.health.security_health import get_security_warnings
from app.services.health.session_health import get_session_stats
from app.services.health.system_health import get_system_metrics
from app.services.health.thresholds import THRESHOLDS as _THRESHOLDS
from sqlalchemy.ext.asyncio import AsyncSession


class HealthService:
    """Service for monitoring system health and generating alerts."""

    THRESHOLDS = _THRESHOLDS

    async def get_redis_status(self) -> dict[str, Any]:
        """Get detailed Redis status and metrics."""
        return await get_redis_status()

    async def get_token_blacklist_stats(self, db: AsyncSession) -> dict[str, Any]:
        """Get token blacklist statistics."""
        return await get_token_blacklist_stats(db)

    async def get_security_warnings(self, db: AsyncSession) -> dict[str, Any]:
        """Get security warnings and suspicious activity."""
        return await get_security_warnings(db)

    async def get_session_stats(self, db: AsyncSession) -> dict[str, Any]:
        """Get session statistics and adoption metrics."""
        return await get_session_stats(db)

    async def get_system_metrics(self) -> dict[str, Any]:
        """Get system resource metrics."""
        return await get_system_metrics()

    async def get_database_health(self, db: AsyncSession) -> dict[str, Any]:
        """Get database health metrics."""
        return await get_database_health(db)

    async def get_health_overview(self, db: AsyncSession) -> dict[str, Any]:
        """
        Get comprehensive health overview with all metrics.

        Args:
            db: Database session

        Returns:
            Dictionary with complete health summary including:
            - overall_status: "healthy", "degraded", or "critical"
            - timestamp: Current timestamp
            - redis: Redis health metrics
            - database: Database health metrics
            - token_blacklist: Token blacklist stats
            - security: Security warnings
            - sessions: Session statistics
            - system: System resource metrics
        """
        timestamp = datetime.now(UTC)

        # Gather all health metrics
        redis_health = await get_redis_status()
        db_health = await get_database_health(db)
        blacklist_stats = await get_token_blacklist_stats(db)
        security_warnings = await get_security_warnings(db)
        session_stats_data = await get_session_stats(db)
        system_metrics_data = await get_system_metrics()

        # Determine overall status
        alert_levels = [
            redis_health.get("alert_level", "unknown"),
            db_health.get("alert_level", "unknown"),
            security_warnings.get("alert_level", "unknown"),
            system_metrics_data.get("alert_level", "unknown"),
        ]

        if "critical" in alert_levels:
            overall_status = "critical"
        elif "warning" in alert_levels:
            overall_status = "warning"
        elif "unknown" in alert_levels:
            overall_status = "degraded"
        else:
            overall_status = "healthy"

        return {
            "overall_status": overall_status,
            "timestamp": timestamp.isoformat(),
            "redis": redis_health,
            "database": db_health,
            "token_blacklist": blacklist_stats,
            "security": security_warnings,
            "sessions": session_stats_data,
            "system": system_metrics_data,
        }


# Global instance
health_service = HealthService()
