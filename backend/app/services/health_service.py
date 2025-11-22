"""
Health monitoring service for system diagnostics and alerts.

Provides comprehensive health checks for:
- Redis availability and performance
- Token blacklist statistics
- Security warnings and suspicious activity
- Session statistics
- System resource usage
"""

import time
from datetime import datetime, timedelta
from typing import Any

import psutil
import structlog
from app.config.redis_config import RedisConfig
from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.device_session import DeviceSession
from app.models.session_activity import SessionActivity
from redis.exceptions import RedisError
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class HealthService:
    """Service for monitoring system health and generating alerts."""

    # Alert thresholds
    THRESHOLDS = {
        # System resources
        "cpu_warning": 70.0,  # CPU usage %
        "cpu_critical": 90.0,
        "memory_warning": 80.0,  # Memory usage %
        "memory_critical": 95.0,
        "disk_warning": 80.0,  # Disk usage %
        "disk_critical": 95.0,
        # Redis
        "redis_memory_warning": 80.0,  # Redis memory usage %
        "redis_memory_critical": 95.0,
        # Security
        "device_mismatches_warning": 50,  # Per 24 hours
        "device_mismatches_critical": 100,
        "failed_logins_warning": 30,  # Per 24 hours
        "failed_logins_critical": 100,
        "new_devices_warning": 20,  # Per 24 hours
        "new_devices_critical": 50,
        # Database
        "db_connections_warning": 80.0,  # Pool usage %
        "db_connections_critical": 95.0,
    }

    async def get_redis_status(self) -> dict[str, Any]:
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
            if memory_percent >= self.THRESHOLDS["redis_memory_critical"]:
                alert_level = "critical"
                status = "degraded"
            elif memory_percent >= self.THRESHOLDS["redis_memory_warning"]:
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

    async def get_token_blacklist_stats(self, db: AsyncSession) -> dict[str, Any]:
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

    async def get_security_warnings(self, db: AsyncSession) -> dict[str, Any]:
        """
        Get security warnings and suspicious activity.

        Args:
            db: Database session

        Returns:
            Dictionary with security metrics:
            - device_mismatches_24h: Device fingerprint mismatches
            - new_devices_24h: New device registrations
            - failed_logins_24h: Failed login attempts
            - suspicious_activity: List of suspicious patterns
            - alert_level: "healthy", "warning", or "critical"
            - recommendations: List of recommended actions
        """
        now = datetime.utcnow()
        day_ago = now - timedelta(days=1)

        try:
            # Count new devices in last 24 hours
            result = await db.execute(
                select(func.count(DeviceSession.id)).where(
                    DeviceSession.created_at >= day_ago
                )
            )
            new_devices_24h = result.scalar() or 0

            # Count untrusted devices
            result = await db.execute(
                select(func.count(DeviceSession.id)).where(~DeviceSession.is_trusted)
            )
            untrusted_devices = result.scalar() or 0

            # Get failed login attempts from audit logs
            result = await db.execute(
                select(func.count(AuditLog.id)).where(
                    and_(
                        AuditLog.action == "login_failed",
                        AuditLog.created_at >= day_ago,
                    )
                )
            )
            failed_logins_24h = result.scalar() or 0

            # Device fingerprint mismatches (approximate from audit logs)
            result = await db.execute(
                select(func.count(AuditLog.id)).where(
                    and_(
                        AuditLog.action.in_(["device_mismatch", "suspicious_device"]),
                        AuditLog.created_at >= day_ago,
                    )
                )
            )
            device_mismatches_24h = result.scalar() or 0

            # Get users with multiple devices
            result = await db.execute(
                select(
                    DeviceSession.user_id,
                    func.count(DeviceSession.id).label("device_count"),
                )
                .group_by(DeviceSession.user_id)
                .having(func.count(DeviceSession.id) > 3)
            )
            users_multiple_devices = len(result.all())

            # Determine alert level
            alert_level = "healthy"
            if (
                device_mismatches_24h >= self.THRESHOLDS["device_mismatches_critical"]
                or failed_logins_24h >= self.THRESHOLDS["failed_logins_critical"]
                or new_devices_24h >= self.THRESHOLDS["new_devices_critical"]
            ):
                alert_level = "critical"
            elif (
                device_mismatches_24h >= self.THRESHOLDS["device_mismatches_warning"]
                or failed_logins_24h >= self.THRESHOLDS["failed_logins_warning"]
                or new_devices_24h >= self.THRESHOLDS["new_devices_warning"]
            ):
                alert_level = "warning"

            # Generate recommendations
            recommendations = []
            if failed_logins_24h > self.THRESHOLDS["failed_logins_warning"]:
                recommendations.append(
                    {
                        "type": "failed_logins",
                        "severity": (
                            "warning"
                            if failed_logins_24h
                            < self.THRESHOLDS["failed_logins_critical"]
                            else "critical"
                        ),
                        "message": f"{failed_logins_24h} failed login attempts in 24h - consider implementing rate limiting",
                    }
                )

            if new_devices_24h > self.THRESHOLDS["new_devices_warning"]:
                recommendations.append(
                    {
                        "type": "new_devices",
                        "severity": (
                            "warning"
                            if new_devices_24h < self.THRESHOLDS["new_devices_critical"]
                            else "critical"
                        ),
                        "message": f"{new_devices_24h} new devices registered in 24h - review for unusual activity",
                    }
                )

            if device_mismatches_24h > self.THRESHOLDS["device_mismatches_warning"]:
                recommendations.append(
                    {
                        "type": "device_mismatches",
                        "severity": (
                            "warning"
                            if device_mismatches_24h
                            < self.THRESHOLDS["device_mismatches_critical"]
                            else "critical"
                        ),
                        "message": f"{device_mismatches_24h} device mismatches in 24h - possible token theft attempts",
                    }
                )

            if untrusted_devices > 10:
                recommendations.append(
                    {
                        "type": "untrusted_devices",
                        "severity": "info",
                        "message": f"{untrusted_devices} untrusted devices - users should review their device list",
                    }
                )

            return {
                "device_mismatches_24h": device_mismatches_24h,
                "new_devices_24h": new_devices_24h,
                "failed_logins_24h": failed_logins_24h,
                "untrusted_devices_total": untrusted_devices,
                "users_with_multiple_devices": users_multiple_devices,
                "alert_level": alert_level,
                "recommendations": recommendations,
            }

        except Exception as e:
            logger.error("security_warnings_error", error=str(e))
            return {
                "device_mismatches_24h": 0,
                "new_devices_24h": 0,
                "failed_logins_24h": 0,
                "untrusted_devices_total": 0,
                "users_with_multiple_devices": 0,
                "alert_level": "unknown",
                "recommendations": [],
                "error": str(e),
            }

    async def get_session_stats(self, db: AsyncSession) -> dict[str, Any]:
        """
        Get session statistics and adoption metrics.

        Args:
            db: Database session

        Returns:
            Dictionary with session metrics:
            - total_active_sessions: Number of active sessions
            - remember_me_sessions: Sessions with remember_me enabled
            - standard_sessions: Standard session count
            - remember_me_adoption_rate: Percentage of sessions using remember_me
            - avg_session_age_hours: Average age of active sessions
            - sessions_expiring_soon: Sessions expiring in next hour
        """
        now = datetime.utcnow()

        try:
            # Total active sessions
            result = await db.execute(
                select(func.count(SessionActivity.id)).where(
                    SessionActivity.absolute_expiry_at > now
                )
            )
            total_active = result.scalar() or 0

            # Get session details for analysis
            result = await db.execute(
                select(
                    SessionActivity.first_login_at,
                    SessionActivity.absolute_expiry_at,
                    SessionActivity.last_activity_at,
                ).where(SessionActivity.absolute_expiry_at > now)
            )
            sessions = result.all()

            # Calculate remember_me vs standard based on expiry duration
            # Remember me: 90 days, Standard: 30 days
            remember_me_count = 0
            standard_count = 0
            total_age_hours = 0.0

            for session in sessions:
                session_duration = (
                    session.absolute_expiry_at - session.first_login_at
                ).total_seconds()
                session_age = (now - session.first_login_at).total_seconds() / 3600
                total_age_hours += session_age

                # Check if duration is closer to 90 days or 30 days
                if session_duration > (60 * 24 * 3600):  # > 60 days = remember_me
                    remember_me_count += 1
                else:
                    standard_count += 1

            # Calculate averages
            avg_session_age_hours = (
                round(total_age_hours / len(sessions), 2) if sessions else 0.0
            )
            remember_me_adoption_rate = (
                round((remember_me_count / total_active * 100), 2)
                if total_active > 0
                else 0.0
            )

            # Sessions expiring soon (within 1 hour)
            one_hour_ahead = now + timedelta(hours=1)
            result = await db.execute(
                select(func.count(SessionActivity.id)).where(
                    and_(
                        SessionActivity.absolute_expiry_at > now,
                        SessionActivity.absolute_expiry_at <= one_hour_ahead,
                    )
                )
            )
            expiring_soon = result.scalar() or 0

            # Sessions by activity (active in last hour)
            hour_ago = now - timedelta(hours=1)
            result = await db.execute(
                select(func.count(SessionActivity.id)).where(
                    and_(
                        SessionActivity.absolute_expiry_at > now,
                        SessionActivity.last_activity_at >= hour_ago,
                    )
                )
            )
            active_last_hour = result.scalar() or 0

            return {
                "total_active_sessions": total_active,
                "remember_me_sessions": remember_me_count,
                "standard_sessions": standard_count,
                "remember_me_adoption_rate": remember_me_adoption_rate,
                "avg_session_age_hours": avg_session_age_hours,
                "sessions_expiring_soon": expiring_soon,
                "sessions_active_last_hour": active_last_hour,
                "activity_rate": (
                    round((active_last_hour / total_active * 100), 2)
                    if total_active > 0
                    else 0.0
                ),
            }

        except Exception as e:
            logger.error("session_stats_error", error=str(e))
            return {
                "total_active_sessions": 0,
                "remember_me_sessions": 0,
                "standard_sessions": 0,
                "remember_me_adoption_rate": 0.0,
                "avg_session_age_hours": 0.0,
                "sessions_expiring_soon": 0,
                "sessions_active_last_hour": 0,
                "activity_rate": 0.0,
                "error": str(e),
            }

    async def get_system_metrics(self) -> dict[str, Any]:
        """
        Get system resource metrics.

        Returns:
            Dictionary with system metrics:
            - cpu_percent: CPU usage percentage
            - memory_total_mb: Total system memory
            - memory_used_mb: Used memory
            - memory_available_mb: Available memory
            - memory_percent: Memory usage percentage
            - disk_total_gb: Total disk space
            - disk_used_gb: Used disk space
            - disk_available_gb: Available disk space
            - disk_percent: Disk usage percentage
            - alert_level: "healthy", "warning", or "critical"
        """
        try:
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=0.1)

            # Memory usage
            memory = psutil.virtual_memory()
            memory_total_mb = round(memory.total / (1024 * 1024), 2)
            memory_used_mb = round(memory.used / (1024 * 1024), 2)
            memory_available_mb = round(memory.available / (1024 * 1024), 2)
            memory_percent = memory.percent

            # Disk usage
            disk = psutil.disk_usage("/")
            disk_total_gb = round(disk.total / (1024**3), 2)
            disk_used_gb = round(disk.used / (1024**3), 2)
            disk_available_gb = round(disk.free / (1024**3), 2)
            disk_percent = disk.percent

            # Determine alert level
            alert_level = "healthy"
            if (
                cpu_percent >= self.THRESHOLDS["cpu_critical"]
                or memory_percent >= self.THRESHOLDS["memory_critical"]
                or disk_percent >= self.THRESHOLDS["disk_critical"]
            ):
                alert_level = "critical"
            elif (
                cpu_percent >= self.THRESHOLDS["cpu_warning"]
                or memory_percent >= self.THRESHOLDS["memory_warning"]
                or disk_percent >= self.THRESHOLDS["disk_warning"]
            ):
                alert_level = "warning"

            return {
                "cpu_percent": round(cpu_percent, 2),
                "cpu_count": psutil.cpu_count(),
                "memory_total_mb": memory_total_mb,
                "memory_used_mb": memory_used_mb,
                "memory_available_mb": memory_available_mb,
                "memory_percent": round(memory_percent, 2),
                "disk_total_gb": disk_total_gb,
                "disk_used_gb": disk_used_gb,
                "disk_available_gb": disk_available_gb,
                "disk_percent": round(disk_percent, 2),
                "alert_level": alert_level,
            }

        except Exception as e:
            logger.error("system_metrics_error", error=str(e))
            return {
                "cpu_percent": 0.0,
                "cpu_count": 0,
                "memory_total_mb": 0.0,
                "memory_used_mb": 0.0,
                "memory_available_mb": 0.0,
                "memory_percent": 0.0,
                "disk_total_gb": 0.0,
                "disk_used_gb": 0.0,
                "disk_available_gb": 0.0,
                "disk_percent": 0.0,
                "alert_level": "unknown",
                "error": str(e),
            }

    async def get_database_health(self, db: AsyncSession) -> dict[str, Any]:
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
                pool = db.get_bind().pool
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
                if pool_usage_percent >= self.THRESHOLDS["db_connections_critical"]:
                    alert_level = "critical"
                    status = "degraded"
                elif pool_usage_percent >= self.THRESHOLDS["db_connections_warning"]:
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
        timestamp = datetime.utcnow()

        # Gather all health metrics
        redis_health = await self.get_redis_status()
        db_health = await self.get_database_health(db)
        blacklist_stats = await self.get_token_blacklist_stats(db)
        security_warnings = await self.get_security_warnings(db)
        session_stats = await self.get_session_stats(db)
        system_metrics = await self.get_system_metrics()

        # Determine overall status
        alert_levels = [
            redis_health.get("alert_level", "unknown"),
            db_health.get("alert_level", "unknown"),
            security_warnings.get("alert_level", "unknown"),
            system_metrics.get("alert_level", "unknown"),
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
            "sessions": session_stats,
            "system": system_metrics,
        }


# Global instance
health_service = HealthService()
