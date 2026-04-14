"""
Health monitoring service package.

Provides system health checks split into focused modules:
- redis_health: Redis status and token blacklist stats
- security_health: Security warnings and suspicious activity
- session_health: Session statistics and adoption metrics
- system_health: CPU, memory, and disk metrics
- database_health: Database connectivity and pool stats
- health_service: Facade composing all sub-services

All functions and the HealthService class are re-exported here.
"""

from app.services.health.database_health import get_database_health
from app.services.health.health_service import HealthService, health_service
from app.services.health.redis_health import (get_redis_status,
                                              get_token_blacklist_stats)
from app.services.health.security_health import get_security_warnings
from app.services.health.session_health import get_session_stats
from app.services.health.system_health import get_system_metrics
from app.services.health.thresholds import THRESHOLDS

__all__ = [
    "HealthService",
    "health_service",
    "THRESHOLDS",
    "get_redis_status",
    "get_token_blacklist_stats",
    "get_security_warnings",
    "get_session_stats",
    "get_system_metrics",
    "get_database_health",
]
