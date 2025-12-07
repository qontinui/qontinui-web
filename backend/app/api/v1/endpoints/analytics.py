from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.services.analytics_service import analytics_service
from app.services.metrics_service import metrics_service

router = APIRouter()


@router.post("/analytics/download")
async def track_download(request: Request, db: AsyncSession = Depends(get_async_db)):
    """
    Track runner download events (public endpoint, no auth required)

    Privacy-friendly: No PII collected, only platform and version info
    """
    try:
        data = await request.json()

        # Record download event using metrics service
        await metrics_service.track_event(
            db=db,
            user_id=None,  # type: ignore[arg-type]  # Public event, no user
            event_type="runner_download",
            value=1.0,
            metadata={
                "platform": data.get("platform"),
                "version": data.get("version"),
                "timestamp": data.get("timestamp"),
                # No IP, user agent, or other PII
            },
        )

        return {"success": True}
    except Exception as e:
        # Silent fail - don't block download
        print(f"Download tracking error: {e}")
        return {"success": False, "error": str(e)}


@router.get("/analytics/usage")
async def get_usage_analytics(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Get current user's usage analytics

    Returns:
        - api_calls_today: Number of API calls made today
        - projects_count: Total number of projects
        - storage_used: Total storage used in bytes
        - last_active: Timestamp of last activity
    """
    usage = await analytics_service.get_user_usage_summary(current_user.id, db)

    return {
        "api_calls_today": usage.api_calls_today,
        "projects_count": usage.projects_count,
        "storage_used": usage.storage_used,
        "last_active": usage.last_active.isoformat() if usage.last_active else None,
    }


@router.get("/analytics/metrics")
async def get_user_metrics(
    metric_type: str | None = None,
    days: int = 7,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Get detailed metrics for the current user

    Query params:
        - metric_type: Filter by metric type (api_call, project_created, etc.)
        - days: Number of days to look back (default 7)

    Returns:
        List of metrics with timestamps and values
    """
    start_date = datetime.utcnow() - timedelta(days=days)

    metrics = await metrics_service.get_user_metrics(
        db=db,
        user_id=current_user.id,
        start_date=start_date,
        metric_type=metric_type,
    )

    return {
        "metrics": [
            {
                "id": metric.id,
                "metric_type": metric.metric_type,
                "value": float(metric.value),
                "timestamp": metric.timestamp.isoformat(),
                "metadata": metric.metric_metadata,
            }
            for metric in metrics
        ],
        "count": len(metrics),
    }


@router.get("/analytics/summary")
async def get_analytics_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Get a comprehensive analytics summary for the current user

    Query params:
        - days: Number of days to look back (default 30)

    Returns:
        Summary of all metrics including API calls, projects, states, images, etc.
    """
    summary = await analytics_service.get_analytics_summary(current_user.id, days, db)

    return {
        "period_days": summary.period_days,
        "period_start": summary.period_start.isoformat(),
        "period_end": summary.period_end.isoformat(),
        "api_calls": summary.api_calls,
        "projects_created": summary.projects_created,
        "states_created": summary.states_created,
        "images_uploaded": summary.images_uploaded,
        "total_projects": summary.total_projects,
        "total_storage_bytes": summary.total_storage_bytes,
        "avg_response_time_seconds": summary.avg_response_time_seconds,
        "last_active": summary.last_active.isoformat() if summary.last_active else None,
    }
