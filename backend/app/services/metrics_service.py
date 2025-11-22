from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from app.models.usage_metric import UsageMetric
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class MetricsService:
    """Service for tracking and managing usage metrics with batching support"""

    def __init__(self):
        self._batch_buffer: list[dict[str, Any]] = []
        self._batch_size = 10
        self._last_flush = datetime.utcnow()
        self._flush_interval = timedelta(seconds=30)

    async def track_api_call(
        self,
        db: AsyncSession,
        user_id: UUID,
        endpoint: str,
        method: str,
        response_time: float,
        status_code: int,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Track an API call with automatic batching"""
        # Merge all API call data into metadata
        full_metadata = {
            "endpoint": endpoint,
            "method": method,
            "response_time": response_time,
            "status_code": status_code,
        }
        if metadata:
            full_metadata.update(metadata)

        metric_data = {
            "user_id": user_id,
            "metric_type": "api_call",
            "value": 1,  # Count of API calls
            "metric_metadata": full_metadata,
            "timestamp": datetime.utcnow(),
        }

        self._batch_buffer.append(metric_data)

        # Check if we should flush
        if (
            len(self._batch_buffer) >= self._batch_size
            or datetime.utcnow() - self._last_flush >= self._flush_interval
        ):
            await self._flush_batch(db)

    async def track_event(
        self,
        db: AsyncSession,
        user_id: UUID,
        event_type: str,
        value: float = 1,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """
        Track custom events like project_created, state_created, image_uploaded

        Args:
            db: Database session
            user_id: User ID
            event_type: Type of event (project_created, state_created, image_uploaded)
            value: Numeric value for the metric (default 1 for count)
            metadata: Additional metadata
        """
        metric_data = {
            "user_id": user_id,
            "metric_type": event_type,
            "value": value,
            "metric_metadata": metadata,
            "timestamp": datetime.utcnow(),
        }

        self._batch_buffer.append(metric_data)

        # Check if we should flush
        if (
            len(self._batch_buffer) >= self._batch_size
            or datetime.utcnow() - self._last_flush >= self._flush_interval
        ):
            await self._flush_batch(db)

    async def _flush_batch(self, db: AsyncSession) -> None:
        """Flush the batch buffer to the database"""
        if not self._batch_buffer:
            return

        try:
            metrics = [UsageMetric(**data) for data in self._batch_buffer]
            db.add_all(metrics)
            await db.commit()
            logger.info(f"Flushed {len(self._batch_buffer)} metrics to database")
            self._batch_buffer.clear()
            self._last_flush = datetime.utcnow()
        except Exception as e:
            logger.error(f"Error flushing metrics batch: {e}")
            await db.rollback()

    async def force_flush(self, db: AsyncSession) -> None:
        """Force flush the batch buffer (useful for shutdown)"""
        await self._flush_batch(db)

    async def get_user_metrics(
        self,
        db: AsyncSession,
        user_id: UUID,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        metric_type: str | None = None,
    ) -> list[UsageMetric]:
        """
        Retrieve user metrics with optional filtering

        Args:
            db: Database session
            user_id: User ID to get metrics for
            start_date: Optional start date filter
            end_date: Optional end date filter
            metric_type: Optional metric type filter (api_call, project_created, etc.)

        Returns:
            List of UsageMetric objects
        """
        query = select(UsageMetric).filter(UsageMetric.user_id == user_id)

        if start_date:
            query = query.filter(UsageMetric.timestamp >= start_date)

        if end_date:
            query = query.filter(UsageMetric.timestamp <= end_date)

        if metric_type:
            query = query.filter(UsageMetric.metric_type == metric_type)

        result = await db.execute(query.order_by(UsageMetric.timestamp.desc()))
        return result.scalars().all()

    async def get_api_calls_count(
        self,
        db: AsyncSession,
        user_id: UUID,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> int:
        """Get count of API calls for a user in a time period"""
        query = select(func.count(UsageMetric.id)).filter(
            UsageMetric.user_id == user_id, UsageMetric.metric_type == "api_call"
        )

        if start_date:
            query = query.filter(UsageMetric.timestamp >= start_date)

        if end_date:
            query = query.filter(UsageMetric.timestamp <= end_date)

        result = await db.execute(query)
        return result.scalar() or 0

    async def get_event_count(
        self,
        db: AsyncSession,
        user_id: UUID,
        event_type: str,
        start_date: datetime | None = None,
    ) -> int:
        """Get count of specific events for a user"""
        query = select(func.count(UsageMetric.id)).filter(
            UsageMetric.user_id == user_id, UsageMetric.metric_type == event_type
        )

        if start_date:
            query = query.filter(UsageMetric.timestamp >= start_date)

        result = await db.execute(query)
        return result.scalar() or 0

    async def get_average_response_time(
        self, db: AsyncSession, user_id: UUID, endpoint: str | None = None
    ) -> float:
        """Get average API response time for a user or specific endpoint"""
        # Query metrics and calculate average from metadata
        result = await db.execute(
            select(UsageMetric).filter(
                UsageMetric.user_id == user_id, UsageMetric.metric_type == "api_call"
            )
        )
        metrics = result.scalars().all()

        response_times = []
        for metric in metrics:
            if metric.metric_metadata and "response_time" in metric.metric_metadata:
                if (
                    endpoint is None
                    or metric.metric_metadata.get("endpoint") == endpoint
                ):
                    response_times.append(
                        float(metric.metric_metadata["response_time"])
                    )

        if response_times:
            return sum(response_times) / len(response_times)
        return 0.0

    async def get_last_activity(
        self, db: AsyncSession, user_id: UUID
    ) -> datetime | None:
        """Get timestamp of user's last activity"""
        result = await db.execute(
            select(func.max(UsageMetric.timestamp)).filter(
                UsageMetric.user_id == user_id
            )
        )
        return result.scalar()


# Global instance for batching across requests
metrics_service = MetricsService()
