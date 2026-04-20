"""Metrics and analytics cleanup tasks.

This module handles cleanup and archival of analytics data including:
- Old analytics events deletion
- Analytics archival to S3 with daily aggregation
"""

from datetime import timedelta
from typing import Any

import pandas as pd  # type: ignore[import-untyped]
from qontinui_schemas.common import utc_now

from app.core.config import settings
from app.worker.tasks.cleanup_utils import (
    CleanupResult,
    TaskTimer,
    create_error_result,
    create_partial_success_result,
    create_success_result,
    generate_archive_s3_keys,
    logger,
    upload_dataframes_to_s3,
)


async def cleanup_old_analytics_events(ctx: dict[str, Any]) -> CleanupResult:
    """Clean up old analytics events older than configured days.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    logger.info("cleanup_old_analytics_events_started")

    with TaskTimer() as timer:
        try:
            from sqlalchemy import delete

            from app.db.session import AsyncSessionLocal
            from app.models.analytics_event import AnalyticsEvent

            # Use configured cleanup days
            days_to_keep = settings.CLEANUP_ANALYTICS_DAYS
            cutoff_date = utc_now() - timedelta(days=days_to_keep)

            async with AsyncSessionLocal() as db:
                # Delete analytics events older than cutoff date
                delete_stmt = delete(AnalyticsEvent).where(
                    AnalyticsEvent.timestamp < cutoff_date
                )
                result = await db.execute(delete_stmt)
                deleted_count = result.rowcount or 0  # type: ignore[attr-defined]

                await db.commit()

            logger.info(
                "cleanup_old_analytics_events_completed",
                deleted_count=deleted_count,
                days_to_keep=days_to_keep,
                execution_time_seconds=round(timer.elapsed, 2),
            )

            return create_success_result(
                task_name="cleanup_old_analytics_events",
                execution_time=timer.elapsed,
                deleted_count=deleted_count,
                days_to_keep=days_to_keep,
            )

        except Exception as e:
            logger.exception(
                "cleanup_old_analytics_events_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="cleanup_old_analytics_events",
                error=e,
                execution_time=timer.elapsed,
            )


async def archive_old_analytics_to_s3(ctx: dict[str, Any]) -> CleanupResult:
    """Archive old analytics events to S3 with daily aggregation.

    Exports analytics events older than configured days to Parquet format,
    creating daily aggregated summaries for long-term storage. Keeps aggregated
    data in the database and deletes detailed events after successful S3 upload.

    S3 Archive Structure:
        archives/analytics/{year}/{month}/events_{date}.parquet
        archives/analytics/{year}/{month}/daily_summary_{date}.parquet

    Aggregation includes:
        - Event counts by event_name and date
        - User activity metrics
        - Most common event properties

    Args:
        ctx: ARQ context

    Returns:
        Dict with archival statistics (events archived, records deleted)
    """
    logger.info("archive_old_analytics_to_s3_started")

    with TaskTimer() as timer:
        try:
            from sqlalchemy import delete, select

            from app.db.session import AsyncSessionLocal
            from app.models.analytics_event import AnalyticsEvent

            # Archive events older than configured days
            days_to_keep = settings.CLEANUP_ANALYTICS_DAYS
            cutoff_date = utc_now() - timedelta(days=days_to_keep)

            events_archived = 0
            events_deleted = 0

            async with AsyncSessionLocal() as db:
                # Query old events
                stmt = select(AnalyticsEvent).where(
                    AnalyticsEvent.timestamp < cutoff_date
                )
                result = await db.execute(stmt)
                old_events = result.scalars().all()

                if not old_events:
                    logger.info(
                        "no_analytics_events_to_archive",
                        cutoff_date=cutoff_date.isoformat(),
                    )
                    return create_success_result(
                        task_name="archive_old_analytics_to_s3",
                        execution_time=timer.elapsed,
                        events_archived=0,
                        events_deleted=0,
                    )

                logger.info(
                    "found_old_analytics_events",
                    count=len(old_events),
                    cutoff_date=cutoff_date.isoformat(),
                )

                # Prepare detailed event data
                event_records = [
                    {
                        "id": str(event.id),
                        "event_name": event.event_name,
                        "user_id": str(event.user_id) if event.user_id else None,
                        "properties": str(event.properties),
                        "timestamp": event.timestamp,
                        "created_at": event.created_at,
                    }
                    for event in old_events
                ]

                # Create detailed events dataframe
                events_df = pd.DataFrame(event_records)
                events_df["date"] = pd.to_datetime(events_df["timestamp"]).dt.date

                # Create daily aggregated summary
                daily_summary = (
                    events_df.groupby(["date", "event_name"])
                    .agg({"id": "count", "user_id": "nunique"})
                    .reset_index()
                )
                daily_summary.columns = [
                    "date",
                    "event_name",
                    "event_count",
                    "unique_users",
                ]

                # Generate S3 keys and upload
                archive_date = utc_now()
                s3_keys = generate_archive_s3_keys(
                    archive_type="analytics",
                    data_types=["events", "daily_summary"],
                    archive_date=archive_date,
                )

                dataframes = {"events": events_df, "daily_summary": daily_summary}
                upload_results, failed_uploads = upload_dataframes_to_s3(
                    dataframes=dataframes,
                    s3_keys=s3_keys,
                    archive_date=archive_date,
                    cutoff_date=cutoff_date,
                )

                # Only delete detailed events if all uploads succeeded
                if failed_uploads == 0:
                    event_ids = [event.id for event in old_events]
                    delete_stmt = delete(AnalyticsEvent).where(
                        AnalyticsEvent.id.in_(event_ids)
                    )
                    delete_result = await db.execute(delete_stmt)
                    events_deleted = delete_result.rowcount or 0  # type: ignore[attr-defined]
                    events_archived = len(old_events)

                    await db.commit()

                    logger.info(
                        "analytics_events_deleted_from_database",
                        events_deleted=events_deleted,
                    )
                else:
                    logger.error(
                        "skipping_database_deletion",
                        reason="some_s3_uploads_failed",
                        failed_count=failed_uploads,
                    )

            logger.info(
                "archive_old_analytics_to_s3_completed",
                events_archived=events_archived,
                events_deleted=events_deleted,
                failed_uploads=failed_uploads,
                execution_time_seconds=round(timer.elapsed, 2),
            )

            if failed_uploads == 0:
                return create_success_result(
                    task_name="archive_old_analytics_to_s3",
                    execution_time=timer.elapsed,
                    events_archived=events_archived,
                    events_deleted=events_deleted,
                    failed_uploads=failed_uploads,
                    upload_results=upload_results,
                    cutoff_date=cutoff_date.isoformat(),
                    days_to_keep=days_to_keep,
                )
            else:
                return create_partial_success_result(
                    task_name="archive_old_analytics_to_s3",
                    execution_time=timer.elapsed,
                    events_archived=events_archived,
                    events_deleted=events_deleted,
                    failed_uploads=failed_uploads,
                    upload_results=upload_results,
                    cutoff_date=cutoff_date.isoformat(),
                    days_to_keep=days_to_keep,
                )

        except Exception as e:
            logger.exception(
                "archive_old_analytics_to_s3_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="archive_old_analytics_to_s3",
                error=e,
                execution_time=timer.elapsed,
            )


# Export all metrics cleanup tasks
__all__ = [
    "cleanup_old_analytics_events",
    "archive_old_analytics_to_s3",
]
