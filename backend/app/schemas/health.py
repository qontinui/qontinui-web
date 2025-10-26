"""Health monitoring schemas for API responses."""

from typing import Literal

from pydantic import BaseModel, Field


class SecurityRecommendation(BaseModel):
    """Security recommendation for alerts."""

    type: str = Field(..., description="Type of recommendation")
    severity: Literal["info", "warning", "critical"] = Field(
        ..., description="Severity level"
    )
    message: str = Field(..., description="Recommendation message")


class RedisHealth(BaseModel):
    """Redis health status and metrics."""

    status: Literal["healthy", "degraded", "down", "disabled"] = Field(
        ..., description="Redis status"
    )
    available: bool = Field(..., description="Whether Redis is available")
    uptime_seconds: int | None = Field(None, description="Redis uptime in seconds")
    uptime_hours: float | None = Field(None, description="Redis uptime in hours")
    memory_used_mb: float | None = Field(None, description="Memory used by Redis in MB")
    memory_total_mb: float | None = Field(
        None, description="Total memory available to Redis in MB"
    )
    memory_percent: float | None = Field(None, description="Memory usage percentage")
    connected_clients: int | None = Field(
        None, description="Number of connected clients"
    )
    ops_per_second: int | None = Field(None, description="Operations per second")
    ping_time_ms: float | None = Field(
        None, description="Ping response time in milliseconds"
    )
    alert_level: Literal["healthy", "warning", "critical"] = Field(
        ..., description="Alert level"
    )
    redis_version: str | None = Field(None, description="Redis version")
    mode: str | None = Field(None, description="Redis mode (standalone/cluster)")
    message: str | None = Field(None, description="Status message")
    error: str | None = Field(None, description="Error message if failed")


class DatabaseHealth(BaseModel):
    """Database health status and metrics."""

    status: Literal["healthy", "degraded", "down"] = Field(
        ..., description="Database status"
    )
    connection_status: str = Field(..., description="Connection status")
    pool_size: int = Field(..., description="Total connection pool size")
    active_connections: int = Field(..., description="Active connections")
    idle_connections: int = Field(..., description="Idle connections")
    pool_usage_percent: float = Field(
        ..., description="Connection pool usage percentage"
    )
    alert_level: Literal["healthy", "warning", "critical"] = Field(
        ..., description="Alert level"
    )
    error: str | None = Field(None, description="Error message if failed")


class TokenBlacklistStats(BaseModel):
    """Token blacklist statistics."""

    mode: Literal["redis", "memory", "disabled"] = Field(
        ..., description="Blacklist storage mode"
    )
    count: int = Field(..., description="Number of blacklisted tokens")
    size_mb: float = Field(..., description="Estimated size in megabytes")
    redis_keys: int | None = Field(
        None, description="Number of Redis keys (if Redis mode)"
    )
    available: bool = Field(..., description="Whether blacklist service is available")
    note: str | None = Field(None, description="Additional notes")
    error: str | None = Field(None, description="Error message if failed")


class SecurityWarnings(BaseModel):
    """Security warnings and alerts."""

    device_mismatches_24h: int = Field(
        ..., description="Device fingerprint mismatches in last 24 hours"
    )
    new_devices_24h: int = Field(
        ..., description="New devices registered in last 24 hours"
    )
    failed_logins_24h: int = Field(
        ..., description="Failed login attempts in last 24 hours"
    )
    untrusted_devices_total: int = Field(
        ..., description="Total number of untrusted devices"
    )
    users_with_multiple_devices: int = Field(
        ..., description="Users with more than 3 devices"
    )
    alert_level: Literal["healthy", "warning", "critical", "unknown"] = Field(
        ..., description="Overall security alert level"
    )
    recommendations: list[SecurityRecommendation] = Field(
        default_factory=list, description="Security recommendations"
    )
    error: str | None = Field(None, description="Error message if failed")


class SessionStats(BaseModel):
    """Session statistics and metrics."""

    total_active_sessions: int = Field(..., description="Total active sessions")
    remember_me_sessions: int = Field(
        ..., description="Sessions with remember_me enabled"
    )
    standard_sessions: int = Field(..., description="Standard sessions")
    remember_me_adoption_rate: float = Field(
        ..., description="Percentage of sessions using remember_me"
    )
    avg_session_age_hours: float = Field(
        ..., description="Average age of active sessions in hours"
    )
    sessions_expiring_soon: int = Field(
        ..., description="Sessions expiring in next hour"
    )
    sessions_active_last_hour: int = Field(
        ..., description="Sessions active in last hour"
    )
    activity_rate: float = Field(
        ..., description="Percentage of sessions active in last hour"
    )
    error: str | None = Field(None, description="Error message if failed")


class SystemMetrics(BaseModel):
    """System resource metrics."""

    cpu_percent: float = Field(..., description="CPU usage percentage")
    cpu_count: int = Field(..., description="Number of CPU cores")
    memory_total_mb: float = Field(..., description="Total system memory in MB")
    memory_used_mb: float = Field(..., description="Used memory in MB")
    memory_available_mb: float = Field(..., description="Available memory in MB")
    memory_percent: float = Field(..., description="Memory usage percentage")
    disk_total_gb: float = Field(..., description="Total disk space in GB")
    disk_used_gb: float = Field(..., description="Used disk space in GB")
    disk_available_gb: float = Field(..., description="Available disk space in GB")
    disk_percent: float = Field(..., description="Disk usage percentage")
    alert_level: Literal["healthy", "warning", "critical", "unknown"] = Field(
        ..., description="System health alert level"
    )
    error: str | None = Field(None, description="Error message if failed")


class HealthOverview(BaseModel):
    """Comprehensive health overview."""

    overall_status: Literal["healthy", "warning", "degraded", "critical"] = Field(
        ..., description="Overall system health status"
    )
    timestamp: str = Field(..., description="Timestamp of health check (ISO format)")
    redis: RedisHealth = Field(..., description="Redis health metrics")
    database: DatabaseHealth = Field(..., description="Database health metrics")
    token_blacklist: TokenBlacklistStats = Field(
        ..., description="Token blacklist statistics"
    )
    security: SecurityWarnings = Field(..., description="Security warnings and alerts")
    sessions: SessionStats = Field(..., description="Session statistics")
    system: SystemMetrics = Field(..., description="System resource metrics")


class HealthThresholds(BaseModel):
    """Health monitoring thresholds configuration."""

    cpu_warning: float = Field(70.0, description="CPU warning threshold (%)")
    cpu_critical: float = Field(90.0, description="CPU critical threshold (%)")
    memory_warning: float = Field(80.0, description="Memory warning threshold (%)")
    memory_critical: float = Field(95.0, description="Memory critical threshold (%)")
    disk_warning: float = Field(80.0, description="Disk warning threshold (%)")
    disk_critical: float = Field(95.0, description="Disk critical threshold (%)")
    redis_memory_warning: float = Field(
        80.0, description="Redis memory warning threshold (%)"
    )
    redis_memory_critical: float = Field(
        95.0, description="Redis memory critical threshold (%)"
    )
    device_mismatches_warning: int = Field(
        50, description="Device mismatches warning threshold (per 24h)"
    )
    device_mismatches_critical: int = Field(
        100, description="Device mismatches critical threshold (per 24h)"
    )
    failed_logins_warning: int = Field(
        30, description="Failed logins warning threshold (per 24h)"
    )
    failed_logins_critical: int = Field(
        100, description="Failed logins critical threshold (per 24h)"
    )
    new_devices_warning: int = Field(
        20, description="New devices warning threshold (per 24h)"
    )
    new_devices_critical: int = Field(
        50, description="New devices critical threshold (per 24h)"
    )
    db_connections_warning: float = Field(
        80.0, description="Database connections warning threshold (%)"
    )
    db_connections_critical: float = Field(
        95.0, description="Database connections critical threshold (%)"
    )


class AlertColorScheme(BaseModel):
    """Color coding for health alerts."""

    healthy: str = Field("green", description="Color for healthy status")
    warning: str = Field("yellow", description="Color for warning status")
    critical: str = Field("red", description="Color for critical status")
    unknown: str = Field("gray", description="Color for unknown status")
    degraded: str = Field("orange", description="Color for degraded status")
