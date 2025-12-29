"""Admin endpoints for analytics and user management."""

import uuid
from datetime import datetime, timedelta
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.api.deps import get_async_db, get_current_user_async
from app.models.project import Project
from app.models.usage_metric import UsageMetric
from app.models.user import User
from app.schemas.admin import (
    AdminNotificationSettingsResponse,
    AdminNotificationSettingsUpdate,
    AdminProjectData,
    AdminUserData,
)
from app.schemas.health import (
    DatabaseHealth,
    HealthOverview,
    HealthThresholds,
    RedisHealth,
    SecurityWarnings,
    SessionStats,
    TokenBlacklistStats,
)
from app.services.admin_notification_service import admin_notification_service
from app.services.auth_analytics_service import auth_analytics_service
from app.services.health_service import health_service

router = APIRouter()
logger = structlog.get_logger(__name__)


# One-time bootstrap endpoint - remove after first use
@router.post("/bootstrap-first-admin")
async def bootstrap_first_admin(
    email: str,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """One-time endpoint to create the first admin. Remove after use!"""
    # Check if any admin exists
    result = await db.execute(select(User).filter(User.is_superuser))  # type: ignore[arg-type]
    existing_admin = result.scalar_one_or_none()
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Admin already exists: {existing_admin.email}",
        )

    # Find user by email
    result = await db.execute(select(User).filter(User.email == email))  # type: ignore[arg-type]
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email {email} not found",
        )

    # Make them admin
    user.is_superuser = True
    await db.commit()

    logger.info(f"Bootstrapped first admin: {user.email}")
    return {"success": True, "message": f"{user.email} is now an admin"}


async def require_admin(current_user: User = Depends(get_current_user_async)) -> User:
    """Dependency to require admin/superuser access."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized. Admin access required.",
        )
    return current_user


@router.get("/stats")
async def get_admin_stats(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get overall platform statistics."""

    # Total users
    result = await db.execute(select(func.count(User.id)))  # type: ignore[arg-type]
    total_users = result.scalar()

    # Users registered in last 7 days
    week_ago = datetime.utcnow() - timedelta(days=7)
    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= week_ago)  # type: ignore[arg-type]
    )
    new_users_week = result.scalar()

    # Users registered in last 30 days
    month_ago = datetime.utcnow() - timedelta(days=30)
    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= month_ago)  # type: ignore[arg-type]
    )
    new_users_month = result.scalar()

    # Total projects
    result = await db.execute(select(func.count(Project.id)))
    total_projects = result.scalar()

    # Projects created in last 7 days
    result = await db.execute(
        select(func.count(Project.id)).filter(Project.created_at >= week_ago)
    )
    projects_week = result.scalar()

    # Active users (created project in last 30 days)
    result = await db.execute(
        select(func.count(func.distinct(Project.owner_id))).filter(
            Project.created_at >= month_ago
        )
    )
    active_users = result.scalar()

    return {
        "total_users": total_users or 0,
        "new_users_week": new_users_week or 0,
        "new_users_month": new_users_month or 0,
        "total_projects": total_projects or 0,
        "projects_week": projects_week or 0,
        "active_users": active_users or 0,
    }


@router.get("/users", response_model=list[AdminUserData])
async def get_users_list(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> list[AdminUserData]:
    """Get list of users with basic info."""

    result = await db.execute(
        select(User).order_by(User.created_at.desc()).offset(skip).limit(limit)
    )
    users = result.scalars().all()

    # Get project counts for each user
    user_data = []
    for user in users:
        result = await db.execute(
            select(func.count(Project.id)).filter(Project.owner_id == user.id)
        )
        project_count = result.scalar()

        user_data.append(
            AdminUserData(
                id=str(user.id),
                email=user.email,
                username=user.username,
                full_name=user.full_name,
                is_active=user.is_active,
                is_verified=user.is_verified,
                email_verified=user.is_verified,  # Alias for frontend compatibility
                created_at=user.created_at.isoformat() if user.created_at else None,  # type: ignore[arg-type]
                project_count=project_count or 0,
                subscription_tier=user.subscription_tier,
                last_login=None,  # Add last_login tracking in future
            )
        )

    return user_data


@router.get("/users/{user_id}")
async def get_user_details(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get detailed info about a specific user."""

    result = await db.execute(select(User).filter(User.id == user_id))  # type: ignore[arg-type]
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Get user's projects
    result = await db.execute(
        select(Project)
        .filter(Project.owner_id == user_id)
        .order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()

    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "is_verified": user.is_verified,  # Changed from email_verified
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "created_at": p.created_at,
                "updated_at": p.updated_at,
            }
            for p in projects
        ],
    }


@router.get("/projects", response_model=list[AdminProjectData])
async def get_all_projects(
    skip: int = 0,
    limit: int = 1000,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> list[AdminProjectData]:
    """Get all projects across all users."""

    result = await db.execute(
        select(Project)
        .options(joinedload(Project.owner))
        .order_by(Project.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    projects = result.unique().scalars().all()

    project_data = []
    for project in projects:
        # Count states and transitions from configuration
        config: dict[str, Any] = project.configuration or {}  # type: ignore[assignment]
        state_count = len(config.get("states", []))
        transition_count = sum(
            len(state.get("transitions", [])) for state in config.get("states", [])
        )

        project_data.append(
            AdminProjectData(
                id=str(project.id),
                name=str(project.name),
                description=project.description,  # type: ignore[arg-type]
                owner_id=str(project.owner_id),
                owner_username=project.owner.username,
                owner_email=project.owner.email,
                created_at=(
                    project.created_at.isoformat() if project.created_at else None
                ),
                updated_at=(
                    project.updated_at.isoformat() if project.updated_at else None
                ),
                state_count=state_count,
                transition_count=transition_count,
            )
        )

    return project_data


@router.get("/projects/{project_id}")
async def get_project_details(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get detailed information about a specific project including full configuration."""

    result = await db.execute(
        select(Project)
        .options(joinedload(Project.owner))
        .filter(Project.id == project_id)
    )
    project = result.unique().scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Get full configuration
    config: dict[str, Any] = project.configuration or {}  # type: ignore[assignment]
    states = config.get("states", [])

    # Extract image library from two sources:
    # 1. Images from the general image library (configuration.images)
    # 2. Images attached to specific states (state.image)
    image_library = []

    # Add images from the general image library
    for image_asset in config.get("images", []):
        if image_asset:
            image_library.append(
                {
                    "source": "image_library",
                    "image": image_asset,
                }
            )

    # Add images from states
    for state in states:
        if "image" in state and state["image"]:
            image_library.append(
                {
                    "source": "state",
                    "state_id": state.get("id"),
                    "state_name": state.get("name"),
                    "image": state["image"],
                }
            )

    return {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "owner_id": str(project.owner_id),
        "owner_username": project.owner.username,
        "owner_email": project.owner.email,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        "configuration": config,
        "states": states,
        "state_count": len(states),
        "transition_count": sum(len(state.get("transitions", [])) for state in states),
        "image_library": image_library,
    }


@router.get("/analytics")
async def get_analytics(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get analytics metrics."""

    now = datetime.utcnow()
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    # Active users (users with at least one project update)
    result = await db.execute(
        select(func.count(func.distinct(Project.owner_id))).filter(
            Project.updated_at >= day_ago
        )
    )
    dau = result.scalar() or 0

    result = await db.execute(
        select(func.count(func.distinct(Project.owner_id))).filter(
            Project.updated_at >= week_ago
        )
    )
    wau = result.scalar() or 0

    result = await db.execute(
        select(func.count(func.distinct(Project.owner_id))).filter(
            Project.updated_at >= month_ago
        )
    )
    mau = result.scalar() or 0

    # New users
    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= day_ago)  # type: ignore[arg-type]
    )
    new_users_today = result.scalar() or 0

    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= week_ago)  # type: ignore[arg-type]
    )
    new_users_week = result.scalar() or 0

    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= month_ago)  # type: ignore[arg-type]
    )
    new_users_month = result.scalar() or 0

    # Active projects
    result = await db.execute(
        select(func.count(Project.id)).filter(Project.updated_at >= week_ago)
    )
    active_projects_week = result.scalar() or 0

    # Simple retention calculation (users who created project in first week and are still active)
    result = await db.execute(select(func.count(User.id)))  # type: ignore[arg-type]
    total_users = result.scalar() or 1

    result = await db.execute(
        select(func.count(User.id))  # type: ignore[arg-type]
        .filter(User.created_at <= week_ago)
        .filter(User.created_at >= month_ago)
    )
    users_7days_old = result.scalar() or 1

    result = await db.execute(
        select(func.count(func.distinct(User.id)))
        .join(Project, User.id == Project.owner_id)  # type: ignore[arg-type]
        .filter(User.created_at <= week_ago)
        .filter(User.created_at >= month_ago)
        .filter(Project.updated_at >= day_ago)
    )
    retained_7day_users = result.scalar() or 0

    retention_7day = (
        (retained_7day_users / users_7days_old * 100) if users_7days_old > 0 else 0
    )

    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at <= month_ago)  # type: ignore[arg-type]
    )
    users_30days_old = result.scalar() or 1

    result = await db.execute(
        select(func.count(func.distinct(User.id)))
        .join(Project, User.id == Project.owner_id)  # type: ignore[arg-type]
        .filter(User.created_at <= month_ago)
        .filter(Project.updated_at >= day_ago)
    )
    retained_30day_users = result.scalar() or 0

    retention_30day = (
        (retained_30day_users / users_30days_old * 100) if users_30days_old > 0 else 0
    )

    # Placeholder values for metrics we don't track yet
    avg_session_duration = 45  # minutes (placeholder)
    total_sessions_today = dau * 2  # rough estimate
    conversion_rate = (total_users / max(total_users * 1.5, 1)) * 100  # placeholder

    return {
        "dau": dau,
        "wau": wau,
        "mau": mau,
        "retention_7day": retention_7day,
        "retention_30day": retention_30day,
        "avg_session_duration": avg_session_duration,
        "new_users_today": new_users_today,
        "new_users_week": new_users_week,
        "new_users_month": new_users_month,
        "active_projects_week": active_projects_week,
        "total_sessions_today": total_sessions_today,
        "conversion_rate": conversion_rate,
    }


@router.get("/analytics/summary")
async def get_analytics_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """
    Get comprehensive analytics summary for remember_me usage and user behavior.

    This endpoint provides detailed insights into:
    - Login statistics (last 7/30 days)
    - Remember me adoption rate
    - Active sessions count
    - Device mismatch count
    - Top users by activity
    - Session and security metrics

    Args:
        days: Number of days to look back for trends (default: 30)

    Returns:
        Comprehensive analytics summary with login stats, remember_me adoption,
        active sessions, security events, and top user activity
    """
    summary = await auth_analytics_service.get_comprehensive_summary(db, days)
    return summary


@router.get("/system/health")
async def get_system_health(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get system health metrics."""

    # API and database status
    try:
        from sqlalchemy import text

        await db.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as e:
        logger.warning(f"Database health check failed: {e}")
        db_status = "down"

    # Database connection info (simplified for now)
    db_connections = {
        "active": 1,
        "idle": 5,
        "max": 20,
    }

    # Try to get system resources, but don't fail if psutil is unavailable
    try:
        import psutil

        disk = psutil.disk_usage("/")
        memory = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(
            interval=0.1
        )  # Short interval to avoid blocking

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
        logger.warning(f"Failed to get system metrics: {e}")
        # Return placeholder values if psutil is unavailable
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

    # Uptime (placeholder - would need to track app start time)
    uptime_hours = 24.0

    return {
        "api_status": "healthy",
        "database_status": db_status,
        "database_connections": db_connections,
        "storage": storage,
        "memory": memory_info,
        "cpu_usage": cpu_usage,
        "uptime_hours": uptime_hours,
        "last_backup": None,
        "recent_errors": [],
    }


@router.post("/cleanup/run")
async def run_cleanup_manually(
    current_user: User = Depends(require_admin),
) -> Any:
    """
    Manually trigger cleanup of expired sessions and old data.

    This endpoint allows admins to run cleanup tasks on-demand without
    waiting for the scheduled cron job. Useful for testing or immediate cleanup needs.

    Requires superuser authentication.

    Returns:
        Dict with cleanup results including count of deleted records per task
    """
    logger.info(
        "manual_cleanup_triggered",
        user_id=str(current_user.id),
        user_email=current_user.email,
    )

    try:
        # Import cleanup tasks
        from app.worker.scheduler import run_all_cleanup_tasks

        # Run all cleanup tasks
        # Pass empty context since we're not running via ARQ
        ctx: dict[str, Any] = {}
        results = await run_all_cleanup_tasks(ctx)

        logger.info(
            "manual_cleanup_completed",
            user_id=str(current_user.id),
            status=results.get("status"),
            total_deleted=results.get("total_deleted", 0),
        )

        return results

    except Exception as e:
        logger.exception(
            "manual_cleanup_failed",
            user_id=str(current_user.id),
            error=str(e),
            error_type=type(e).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cleanup failed: {str(e)}",
        )


# ==================== Health Monitoring Endpoints ====================


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

    Requires superuser authentication.
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

    Requires superuser authentication.
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

    Requires superuser authentication.
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

    Alert thresholds:
    - Warning: 50+ device mismatches, 30+ failed logins, 20+ new devices
    - Critical: 100+ device mismatches, 100+ failed logins, 50+ new devices

    Requires superuser authentication.
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

    Useful for understanding:
    - User engagement patterns
    - Feature adoption (remember me)
    - Session lifecycle management

    Requires superuser authentication.
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

    Useful for:
    - Monitoring blacklist growth
    - Memory usage tracking
    - Performance optimization

    Requires superuser authentication.
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

    Thresholds define when alerts transition from:
    - Healthy (green) -> Warning (yellow) -> Critical (red)

    Requires superuser authentication.
    """
    return HealthThresholds(**health_service.THRESHOLDS)  # type: ignore[arg-type]


# ==================== Download Analytics Endpoints ====================


@router.get("/download-analytics")
async def get_download_analytics(
    days: int = 30,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """
    Get runner download analytics.

    Returns aggregated download statistics including:
    - Total downloads and unique downloaders
    - Downloads by country, platform, browser
    - Daily download trends
    - UTM campaign attribution

    Query params:
        - days: Number of days to look back (default 30)

    Requires superuser authentication.
    """

    start_date = datetime.utcnow() - timedelta(days=days)

    # Get all download metrics
    result = await db.execute(
        select(UsageMetric)
        .filter(UsageMetric.metric_type == "runner_download")
        .filter(UsageMetric.timestamp >= start_date)
        .order_by(UsageMetric.timestamp.desc())
    )
    metrics = result.scalars().all()

    # Aggregate the data
    total_downloads = len(metrics)

    # Count unique downloads by ip_hash
    unique_hashes = set()
    downloads_by_country: dict[str, int] = {}
    downloads_by_platform: dict[str, int] = {}
    downloads_by_browser: dict[str, int] = {}
    downloads_by_day: dict[str, int] = {}
    downloads_by_utm_source: dict[str, int] = {}
    recent_downloads: list[dict[str, Any]] = []

    for metric in metrics:
        metadata: dict[str, Any] = (
            dict(metric.metric_metadata) if metric.metric_metadata else {}
        )

        # Unique downloads
        ip_hash = metadata.get("ip_hash")
        if ip_hash:
            unique_hashes.add(ip_hash)

        # By country
        country = (
            metadata.get("country_code") or metadata.get("country_name") or "Unknown"
        )
        downloads_by_country[country] = downloads_by_country.get(country, 0) + 1

        # By platform
        platform = metadata.get("platform") or "Unknown"
        downloads_by_platform[platform] = downloads_by_platform.get(platform, 0) + 1

        # By browser
        browser = metadata.get("browser_family") or "Unknown"
        downloads_by_browser[browser] = downloads_by_browser.get(browser, 0) + 1

        # By day
        day = metric.timestamp.strftime("%Y-%m-%d") if metric.timestamp else "Unknown"
        downloads_by_day[day] = downloads_by_day.get(day, 0) + 1

        # By UTM source
        utm_source = metadata.get("utm_source")
        if utm_source:
            downloads_by_utm_source[utm_source] = (
                downloads_by_utm_source.get(utm_source, 0) + 1
            )

        # Recent downloads (last 20)
        if len(recent_downloads) < 20:
            recent_downloads.append(
                {
                    "timestamp": (
                        metric.timestamp.isoformat() if metric.timestamp else None
                    ),
                    "platform": metadata.get("platform"),
                    "country_code": metadata.get("country_code"),
                    "country_name": metadata.get("country_name"),
                    "city": metadata.get("city"),
                    "region": metadata.get("region"),
                    "browser": metadata.get("browser_family"),
                    "os": metadata.get("os_family"),
                    "version": metadata.get("version"),
                    "utm_source": metadata.get("utm_source"),
                    "utm_medium": metadata.get("utm_medium"),
                    "utm_campaign": metadata.get("utm_campaign"),
                    "referrer": metadata.get("referrer")
                    or metadata.get("referer_header"),
                }
            )

    # Sort aggregations by count (descending)
    def sort_dict(d: dict[str, int]) -> list[dict[str, Any]]:
        return [
            {"name": k, "count": v}
            for k, v in sorted(d.items(), key=lambda x: x[1], reverse=True)
        ]

    # Sort daily downloads by date (ascending for chart)
    daily_trend = [{"date": k, "count": v} for k, v in sorted(downloads_by_day.items())]

    return {
        "period_days": days,
        "total_downloads": total_downloads,
        "unique_downloads": len(unique_hashes),
        "downloads_by_country": sort_dict(downloads_by_country)[:20],  # Top 20
        "downloads_by_platform": sort_dict(downloads_by_platform),
        "downloads_by_browser": sort_dict(downloads_by_browser),
        "downloads_by_utm_source": sort_dict(downloads_by_utm_source)[:10],  # Top 10
        "daily_trend": daily_trend,
        "recent_downloads": recent_downloads,
    }


# ==================== Admin Notification Settings Endpoints ====================


@router.get("/notifications/settings", response_model=AdminNotificationSettingsResponse)
async def get_notification_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> AdminNotificationSettingsResponse:
    """
    Get admin notification settings.

    Returns the current configuration for admin email notifications including:
    - Email address for notifications
    - Which events trigger notifications (user signup, project creation)
    - Whether notifications are enabled

    If no settings exist, creates default settings using the current user's email.

    Requires superuser authentication.
    """
    settings = await admin_notification_service.get_or_create_settings(
        db, default_email=current_user.email
    )

    return AdminNotificationSettingsResponse(
        id=str(settings.id),
        notification_email=str(settings.notification_email),
        notify_on_user_signup=bool(settings.notify_on_user_signup),
        notify_on_project_created=bool(settings.notify_on_project_created),
        notifications_enabled=bool(settings.notifications_enabled),
        created_at=settings.created_at,  # type: ignore[arg-type]
        updated_at=settings.updated_at,  # type: ignore[arg-type]
    )


@router.put("/notifications/settings", response_model=AdminNotificationSettingsResponse)
async def update_notification_settings(
    settings_update: AdminNotificationSettingsUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> AdminNotificationSettingsResponse:
    """
    Update admin notification settings.

    Allows updating:
    - notification_email: Email address to receive notifications
    - notify_on_user_signup: Enable/disable user signup notifications
    - notify_on_project_created: Enable/disable project creation notifications
    - notifications_enabled: Master toggle for all notifications

    Only provided fields will be updated.

    Requires superuser authentication.
    """
    # Convert Pydantic model to dict, excluding None values
    updates = settings_update.model_dump(exclude_none=True)

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid fields to update",
        )

    settings = await admin_notification_service.update_settings(db, updates)

    logger.info(
        "admin_notification_settings_updated",
        admin_id=str(current_user.id),
        admin_email=current_user.email,
        updated_fields=list(updates.keys()),
    )

    return AdminNotificationSettingsResponse(
        id=str(settings.id),
        notification_email=str(settings.notification_email),
        notify_on_user_signup=bool(settings.notify_on_user_signup),
        notify_on_project_created=bool(settings.notify_on_project_created),
        notifications_enabled=bool(settings.notifications_enabled),
        created_at=settings.created_at,  # type: ignore[arg-type]
        updated_at=settings.updated_at,  # type: ignore[arg-type]
    )


@router.post("/notifications/test")
async def send_test_notification(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """
    Send a test notification email to verify settings are working.

    Sends a test email to the configured notification email address.
    Returns success or failure status.

    Requires superuser authentication.
    """
    from app.services.email.email_transport_service import EmailTransportService

    settings = await admin_notification_service.get_or_create_settings(
        db, default_email=current_user.email
    )

    if not settings.notifications_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin notifications are disabled. Enable them first.",
        )

    email_transport = EmailTransportService()

    success = await email_transport.send_email(
        to_email=str(settings.notification_email),
        subject="Qontinui Admin Notification Test",
        text_body=(
            f"This is a test notification from Qontinui.\n\n"
            f"Your admin notification settings are configured correctly.\n\n"
            f"Sent by: {current_user.username} ({current_user.email})"
        ),
        html_body=None,
    )

    if success:
        logger.info(
            "admin_test_notification_sent",
            admin_id=str(current_user.id),
            to_email=settings.notification_email,
        )
        return {
            "success": True,
            "message": f"Test notification sent to {settings.notification_email}",
        }
    else:
        logger.error(
            "admin_test_notification_failed",
            admin_id=str(current_user.id),
            to_email=settings.notification_email,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send test notification. Check email configuration.",
        )
