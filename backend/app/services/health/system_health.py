"""
System resource health metrics.

Monitors CPU, memory, and disk usage with alert thresholds.
"""

from typing import Any

import psutil
import structlog

from app.services.health.thresholds import THRESHOLDS

logger = structlog.get_logger(__name__)


async def get_system_metrics() -> dict[str, Any]:
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
            cpu_percent >= THRESHOLDS["cpu_critical"]
            or memory_percent >= THRESHOLDS["memory_critical"]
            or disk_percent >= THRESHOLDS["disk_critical"]
        ):
            alert_level = "critical"
        elif (
            cpu_percent >= THRESHOLDS["cpu_warning"]
            or memory_percent >= THRESHOLDS["memory_warning"]
            or disk_percent >= THRESHOLDS["disk_warning"]
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
