"""Admin endpoints for analytics and user management."""

import uuid
from datetime import datetime, timedelta
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_user_async
from app.models.project import Project
from app.models.user import User

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
    result = await db.execute(select(User).filter(User.is_superuser))
    existing_admin = result.scalar_one_or_none()
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Admin already exists: {existing_admin.email}",
        )

    # Find user by email
    result = await db.execute(select(User).filter(User.email == email))
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
    result = await db.execute(select(func.count(User.id)))
    total_users = result.scalar()

    # Users registered in last 7 days
    week_ago = datetime.utcnow() - timedelta(days=7)
    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= week_ago)
    )
    new_users_week = result.scalar()

    # Users registered in last 30 days
    month_ago = datetime.utcnow() - timedelta(days=30)
    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= month_ago)
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


@router.get("/users")
async def get_users_list(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
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
            {
                "id": str(user.id),
                "email": user.email,
                "username": user.username,
                "full_name": user.full_name,
                "is_active": user.is_active,
                "is_verified": user.is_verified,  # Changed from email_verified
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "project_count": project_count or 0,
                "subscription_tier": user.subscription_tier,
                "last_login": None,  # Add last_login tracking in future
            }
        )

    return user_data


@router.get("/users/{user_id}")
async def get_user_details(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get detailed info about a specific user."""

    result = await db.execute(select(User).filter(User.id == user_id))
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


@router.get("/projects")
async def get_all_projects(
    skip: int = 0,
    limit: int = 1000,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get all projects across all users."""

    result = await db.execute(
        select(Project)
        .join(User, Project.owner_id == User.id)
        .order_by(Project.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    projects = result.scalars().all()

    project_data = []
    for project in projects:
        # Count states and transitions from configuration
        config = project.configuration or {}
        state_count = len(config.get("states", []))
        transition_count = sum(
            len(state.get("transitions", [])) for state in config.get("states", [])
        )

        project_data.append(
            {
                "id": project.id,
                "name": project.name,
                "description": project.description,
                "owner_id": str(project.owner_id),
                "owner_username": project.owner.username,
                "owner_email": project.owner.email,
                "created_at": project.created_at.isoformat()
                if project.created_at
                else None,
                "updated_at": project.updated_at.isoformat()
                if project.updated_at
                else None,
                "state_count": state_count,
                "transition_count": transition_count,
            }
        )

    return project_data


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
        select(func.count(User.id)).filter(User.created_at >= day_ago)
    )
    new_users_today = result.scalar() or 0

    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= week_ago)
    )
    new_users_week = result.scalar() or 0

    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at >= month_ago)
    )
    new_users_month = result.scalar() or 0

    # Active projects
    result = await db.execute(
        select(func.count(Project.id)).filter(Project.updated_at >= week_ago)
    )
    active_projects_week = result.scalar() or 0

    # Simple retention calculation (users who created project in first week and are still active)
    result = await db.execute(select(func.count(User.id)))
    total_users = result.scalar() or 1

    result = await db.execute(
        select(func.count(User.id))
        .filter(User.created_at <= week_ago)
        .filter(User.created_at >= month_ago)
    )
    users_7days_old = result.scalar() or 1

    result = await db.execute(
        select(func.count(func.distinct(User.id)))
        .join(Project, User.id == Project.owner_id)
        .filter(User.created_at <= week_ago)
        .filter(User.created_at >= month_ago)
        .filter(Project.updated_at >= day_ago)
    )
    retained_7day_users = result.scalar() or 0

    retention_7day = (
        (retained_7day_users / users_7days_old * 100) if users_7days_old > 0 else 0
    )

    result = await db.execute(
        select(func.count(User.id)).filter(User.created_at <= month_ago)
    )
    users_30days_old = result.scalar() or 1

    result = await db.execute(
        select(func.count(func.distinct(User.id)))
        .join(Project, User.id == Project.owner_id)
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
