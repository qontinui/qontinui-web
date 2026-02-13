"""
Alert threshold constants for health monitoring.

Defines warning and critical thresholds for system resources,
Redis, security metrics, and database connections.
"""

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
