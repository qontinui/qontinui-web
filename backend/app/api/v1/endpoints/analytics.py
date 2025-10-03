from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.models.project import Project
from app.models.storage_usage import StorageUsage
from app.models.user import User
from app.services.metrics_service import metrics_service

router = APIRouter()


@router.get("/analytics/usage")
def get_usage_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get current user's usage analytics

    Returns:
        - api_calls_today: Number of API calls made today
        - projects_count: Total number of projects
        - storage_used: Total storage used in bytes
        - last_active: Timestamp of last activity
    """
    # Calculate start of today (UTC)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Get API calls count for today
    api_calls_today = metrics_service.get_api_calls_count(
        db=db,
        user_id=current_user.id,
        start_date=today_start,
    )

    # Get total projects count
    projects_count = (
        db.query(func.count(Project.id))
        .filter(Project.owner_id == current_user.id)
        .scalar()
        or 0
    )

    # Get total storage used
    storage_used = (
        db.query(func.sum(StorageUsage.file_size))
        .filter(StorageUsage.user_id == current_user.id)
        .scalar()
        or 0
    )

    # Get last activity timestamp
    last_active = metrics_service.get_last_activity(db=db, user_id=current_user.id)

    return {
        "api_calls_today": api_calls_today,
        "projects_count": projects_count,
        "storage_used": int(storage_used),
        "last_active": last_active.isoformat() if last_active else None,
    }


@router.get("/analytics/metrics")
def get_user_metrics(
    metric_type: str | None = None,
    days: int = 7,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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

    metrics = metrics_service.get_user_metrics(
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
def get_analytics_summary(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get a comprehensive analytics summary for the current user

    Query params:
        - days: Number of days to look back (default 30)

    Returns:
        Summary of all metrics including API calls, projects, states, images, etc.
    """
    start_date = datetime.utcnow() - timedelta(days=days)

    # Get various event counts
    api_calls = metrics_service.get_api_calls_count(
        db=db, user_id=current_user.id, start_date=start_date
    )

    projects_created = metrics_service.get_event_count(
        db=db,
        user_id=current_user.id,
        event_type="project_created",
        start_date=start_date,
    )

    states_created = metrics_service.get_event_count(
        db=db,
        user_id=current_user.id,
        event_type="state_created",
        start_date=start_date,
    )

    images_uploaded = metrics_service.get_event_count(
        db=db,
        user_id=current_user.id,
        event_type="image_uploaded",
        start_date=start_date,
    )

    # Get average response time
    avg_response_time = metrics_service.get_average_response_time(
        db=db, user_id=current_user.id
    )

    # Get total projects and storage
    total_projects = (
        db.query(func.count(Project.id))
        .filter(Project.owner_id == current_user.id)
        .scalar()
        or 0
    )

    total_storage = (
        db.query(func.sum(StorageUsage.file_size))
        .filter(StorageUsage.user_id == current_user.id)
        .scalar()
        or 0
    )

    # Get last activity
    last_active = metrics_service.get_last_activity(db=db, user_id=current_user.id)

    return {
        "period_days": days,
        "period_start": start_date.isoformat(),
        "period_end": datetime.utcnow().isoformat(),
        "api_calls": api_calls,
        "projects_created": projects_created,
        "states_created": states_created,
        "images_uploaded": images_uploaded,
        "total_projects": total_projects,
        "total_storage_bytes": int(total_storage),
        "avg_response_time_seconds": round(avg_response_time, 3),
        "last_active": last_active.isoformat() if last_active else None,
    }
