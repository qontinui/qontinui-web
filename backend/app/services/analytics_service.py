"""Service for user analytics and usage statistics."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from app.models.project import Project
from app.models.storage_usage import StorageUsage
from app.services.metrics_service import metrics_service
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class UsageAnalytics:
    """User usage analytics for a specific period."""

    api_calls_today: int
    projects_count: int
    storage_used: int
    last_active: datetime | None


@dataclass
class AnalyticsSummary:
    """Comprehensive analytics summary."""

    period_days: int
    period_start: datetime
    period_end: datetime
    api_calls: int
    projects_created: int
    states_created: int
    images_uploaded: int
    total_projects: int
    total_storage_bytes: int
    avg_response_time_seconds: float
    last_active: datetime | None


class AnalyticsService:
    """Handles analytics queries and aggregations."""

    async def get_user_usage_summary(
        self, user_id: UUID, db: AsyncSession
    ) -> UsageAnalytics:
        """
        Get comprehensive usage analytics for a user.

        Args:
            user_id: The user's ID
            db: Database session

        Returns:
            UsageAnalytics with current usage information
        """
        # Calculate start of today (UTC)
        today_start = datetime.utcnow().replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        # Get API calls count for today
        api_calls = await metrics_service.get_api_calls_count(
            db=db, user_id=user_id, start_date=today_start
        )

        # Get total projects count
        result = await db.execute(
            select(func.count(Project.id)).filter(Project.owner_id == user_id)
        )
        projects_count = result.scalar() or 0

        # Get total storage used
        result = await db.execute(
            select(func.sum(StorageUsage.file_size)).filter(
                StorageUsage.user_id == user_id
            )
        )
        storage_used = result.scalar() or 0

        # Get last activity timestamp
        last_active = await metrics_service.get_last_activity(db=db, user_id=user_id)

        return UsageAnalytics(
            api_calls_today=api_calls,
            projects_count=projects_count,
            storage_used=int(storage_used),
            last_active=last_active,
        )

    async def get_analytics_summary(
        self, user_id: UUID, days: int, db: AsyncSession
    ) -> AnalyticsSummary:
        """
        Get a comprehensive analytics summary for a user.

        Args:
            user_id: The user's ID
            days: Number of days to look back
            db: Database session

        Returns:
            AnalyticsSummary with comprehensive metrics
        """
        start_date = datetime.utcnow() - timedelta(days=days)
        end_date = datetime.utcnow()

        # Get various event counts for the period
        api_calls = await metrics_service.get_api_calls_count(
            db=db, user_id=user_id, start_date=start_date
        )

        projects_created = await metrics_service.get_event_count(
            db=db,
            user_id=user_id,
            event_type="project_created",
            start_date=start_date,
        )

        states_created = await metrics_service.get_event_count(
            db=db,
            user_id=user_id,
            event_type="state_created",
            start_date=start_date,
        )

        images_uploaded = await metrics_service.get_event_count(
            db=db,
            user_id=user_id,
            event_type="image_uploaded",
            start_date=start_date,
        )

        # Get average response time
        avg_response_time = await metrics_service.get_average_response_time(
            db=db, user_id=user_id
        )

        # Get total projects and storage (all-time, not just period)
        result = await db.execute(
            select(func.count(Project.id)).filter(Project.owner_id == user_id)
        )
        total_projects = result.scalar() or 0

        result = await db.execute(
            select(func.sum(StorageUsage.file_size)).filter(
                StorageUsage.user_id == user_id
            )
        )
        total_storage = result.scalar() or 0

        # Get last activity
        last_active = await metrics_service.get_last_activity(db=db, user_id=user_id)

        return AnalyticsSummary(
            period_days=days,
            period_start=start_date,
            period_end=end_date,
            api_calls=api_calls,
            projects_created=projects_created,
            states_created=states_created,
            images_uploaded=images_uploaded,
            total_projects=total_projects,
            total_storage_bytes=int(total_storage),
            avg_response_time_seconds=round(avg_response_time, 3),
            last_active=last_active,
        )


# Create singleton instance
analytics_service = AnalyticsService()
