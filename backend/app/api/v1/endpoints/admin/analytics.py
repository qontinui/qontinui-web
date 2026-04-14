"""Admin analytics endpoints."""

from typing import Any

from app.api.deps import get_async_db
from app.api.v1.endpoints.admin.dependencies import require_admin
from app.models.user import User
from app.repositories.admin_user import admin_user_repository
from app.services.auth_analytics_service import auth_analytics_service
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.get("/analytics")
async def get_analytics(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get analytics metrics including DAU, WAU, MAU, and retention."""
    return await admin_user_repository.get_user_activity_metrics(db)


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
    return await auth_analytics_service.get_comprehensive_summary(db, days)
