"""
Security health check functions.

Monitors security warnings and suspicious activity patterns.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.device_session import DeviceSession
from app.services.health.thresholds import THRESHOLDS

logger = structlog.get_logger(__name__)


async def get_security_warnings(db: AsyncSession) -> dict[str, Any]:
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
    now = datetime.now(UTC)
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
            device_mismatches_24h >= THRESHOLDS["device_mismatches_critical"]
            or failed_logins_24h >= THRESHOLDS["failed_logins_critical"]
            or new_devices_24h >= THRESHOLDS["new_devices_critical"]
        ):
            alert_level = "critical"
        elif (
            device_mismatches_24h >= THRESHOLDS["device_mismatches_warning"]
            or failed_logins_24h >= THRESHOLDS["failed_logins_warning"]
            or new_devices_24h >= THRESHOLDS["new_devices_warning"]
        ):
            alert_level = "warning"

        # Generate recommendations
        recommendations = []
        if failed_logins_24h > THRESHOLDS["failed_logins_warning"]:
            recommendations.append(
                {
                    "type": "failed_logins",
                    "severity": (
                        "warning"
                        if failed_logins_24h < THRESHOLDS["failed_logins_critical"]
                        else "critical"
                    ),
                    "message": f"{failed_logins_24h} failed login attempts in 24h - consider implementing rate limiting",
                }
            )

        if new_devices_24h > THRESHOLDS["new_devices_warning"]:
            recommendations.append(
                {
                    "type": "new_devices",
                    "severity": (
                        "warning"
                        if new_devices_24h < THRESHOLDS["new_devices_critical"]
                        else "critical"
                    ),
                    "message": f"{new_devices_24h} new devices registered in 24h - review for unusual activity",
                }
            )

        if device_mismatches_24h > THRESHOLDS["device_mismatches_warning"]:
            recommendations.append(
                {
                    "type": "device_mismatches",
                    "severity": (
                        "warning"
                        if device_mismatches_24h
                        < THRESHOLDS["device_mismatches_critical"]
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
