import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.usage_metric import UsageMetric

logger = logging.getLogger(__name__)


class MetricsService:
    """Service for tracking and managing usage metrics with batching support"""

    def __init__(self):
        self._batch_buffer: list[dict[str, Any]] = []
        self._batch_size = 10
        self._last_flush = datetime.utcnow()
        self._flush_interval = timedelta(seconds=30)

    def track_api_call(
        self,
        db: Session,
        user_id: int,
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
            self._flush_batch(db)

    def track_event(
        self,
        db: Session,
        user_id: int,
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
            self._flush_batch(db)

    def _flush_batch(self, db: Session) -> None:
        """Flush the batch buffer to the database"""
        if not self._batch_buffer:
            return

        try:
            metrics = [UsageMetric(**data) for data in self._batch_buffer]
            db.bulk_save_objects(metrics)
            db.commit()
            logger.info(f"Flushed {len(self._batch_buffer)} metrics to database")
            self._batch_buffer.clear()
            self._last_flush = datetime.utcnow()
        except Exception as e:
            logger.error(f"Error flushing metrics batch: {e}")
            db.rollback()

    def force_flush(self, db: Session) -> None:
        """Force flush the batch buffer (useful for shutdown)"""
        self._flush_batch(db)

    def get_user_metrics(
        self,
        db: Session,
        user_id: int,
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
        query = db.query(UsageMetric).filter(UsageMetric.user_id == user_id)

        if start_date:
            query = query.filter(UsageMetric.timestamp >= start_date)

        if end_date:
            query = query.filter(UsageMetric.timestamp <= end_date)

        if metric_type:
            query = query.filter(UsageMetric.metric_type == metric_type)

        return query.order_by(UsageMetric.timestamp.desc()).all()

    def get_api_calls_count(
        self,
        db: Session,
        user_id: int,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> int:
        """Get count of API calls for a user in a time period"""
        query = db.query(func.count(UsageMetric.id)).filter(
            UsageMetric.user_id == user_id, UsageMetric.metric_type == "api_call"
        )

        if start_date:
            query = query.filter(UsageMetric.timestamp >= start_date)

        if end_date:
            query = query.filter(UsageMetric.timestamp <= end_date)

        return query.scalar() or 0

    def get_event_count(
        self,
        db: Session,
        user_id: int,
        event_type: str,
        start_date: datetime | None = None,
    ) -> int:
        """Get count of specific events for a user"""
        query = db.query(func.count(UsageMetric.id)).filter(
            UsageMetric.user_id == user_id, UsageMetric.metric_type == event_type
        )

        if start_date:
            query = query.filter(UsageMetric.timestamp >= start_date)

        return query.scalar() or 0

    def get_average_response_time(
        self, db: Session, user_id: int, endpoint: str | None = None
    ) -> float:
        """Get average API response time for a user or specific endpoint"""
        # Query metrics and calculate average from metadata
        metrics = (
            db.query(UsageMetric)
            .filter(
                UsageMetric.user_id == user_id, UsageMetric.metric_type == "api_call"
            )
            .all()
        )

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

    def get_last_activity(self, db: Session, user_id: int) -> datetime | None:
        """Get timestamp of user's last activity"""
        result = (
            db.query(func.max(UsageMetric.timestamp))
            .filter(UsageMetric.user_id == user_id)
            .scalar()
        )
        return result


# Global instance for batching across requests
metrics_service = MetricsService()
