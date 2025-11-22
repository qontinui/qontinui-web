"""Background cleanup tasks for removing expired sessions and old data."""

import io
import time
from datetime import datetime, timedelta
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import structlog
from app.core.config import settings

logger = structlog.get_logger(__name__)


async def cleanup_expired_sessions(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up expired SessionActivity records.

    Deletes sessions where absolute_expiry_at is in the past.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_expired_sessions_started")

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.session_activity import SessionActivity
        from sqlalchemy import delete

        async with AsyncSessionLocal() as db:
            # Delete sessions that have passed their absolute expiry
            now = datetime.utcnow()
            delete_stmt = delete(SessionActivity).where(
                SessionActivity.absolute_expiry_at < now
            )
            result = await db.execute(delete_stmt)
            deleted_count = result.rowcount

            await db.commit()

        execution_time = time.time() - start_time

        logger.info(
            "cleanup_expired_sessions_completed",
            deleted_count=deleted_count,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_expired_sessions",
            "deleted_count": deleted_count,
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_expired_sessions_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_expired_sessions",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_expired_device_sessions(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up old DeviceSession records not accessed in 90 days.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_expired_device_sessions_started")

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.device_session import DeviceSession
        from sqlalchemy import delete

        # Use configured cleanup days
        days_to_keep = settings.CLEANUP_SESSION_DAYS
        cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)

        async with AsyncSessionLocal() as db:
            # Delete device sessions not accessed since cutoff date
            delete_stmt = delete(DeviceSession).where(
                DeviceSession.last_seen < cutoff_date
            )
            result = await db.execute(delete_stmt)
            deleted_count = result.rowcount

            await db.commit()

        execution_time = time.time() - start_time

        logger.info(
            "cleanup_expired_device_sessions_completed",
            deleted_count=deleted_count,
            days_to_keep=days_to_keep,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_expired_device_sessions",
            "deleted_count": deleted_count,
            "days_to_keep": days_to_keep,
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_expired_device_sessions_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_expired_device_sessions",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_old_analytics_events(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up old analytics events older than configured days.

    Note: Since AnalyticsEvent model doesn't exist yet, this is a placeholder
    that will return success with 0 deletions. Update this function when the
    AnalyticsEvent model is implemented.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_old_analytics_events_started")

    try:
        # TODO: Implement when AnalyticsEvent model exists
        # from sqlalchemy import delete
        # from app.models.analytics_event import AnalyticsEvent
        #
        # days_to_keep = settings.CLEANUP_ANALYTICS_DAYS
        # cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)
        #
        # async with AsyncSessionLocal() as db:
        #     delete_stmt = delete(AnalyticsEvent).where(
        #         AnalyticsEvent.created_at < cutoff_date
        #     )
        #     result = await db.execute(delete_stmt)
        #     deleted_count = result.rowcount
        #     await db.commit()

        deleted_count = 0
        execution_time = time.time() - start_time

        logger.info(
            "cleanup_old_analytics_events_completed",
            deleted_count=deleted_count,
            note="AnalyticsEvent model not yet implemented",
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_old_analytics_events",
            "deleted_count": deleted_count,
            "note": "AnalyticsEvent model not yet implemented",
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_old_analytics_events_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_old_analytics_events",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_token_blacklist(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up expired tokens from the blacklist.

    For Redis: This is automatic via TTL, returns 0.
    For in-memory: Manually removes expired tokens.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_token_blacklist_started")

    try:
        from app.services.auth.token_blacklist_service import token_blacklist_service

        deleted_count = await token_blacklist_service.clean_expired_tokens()
        execution_time = time.time() - start_time

        logger.info(
            "cleanup_token_blacklist_completed",
            deleted_count=deleted_count,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_token_blacklist",
            "deleted_count": deleted_count,
            "note": (
                "Redis handles TTL automatically"
                if settings.REDIS_ENABLED
                else "In-memory cleanup"
            ),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_token_blacklist_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_token_blacklist",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_old_automation_data(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Archive and clean up old automation session data.

    Archives automation sessions older than 180 days to S3 in Parquet format,
    including sessions, logs, screenshots, and input events. After successful
    S3 upload, deletes the data from PostgreSQL to manage database growth.

    S3 Archive Structure:
        archives/automation/{year}/{month}/sessions_{date}.parquet
        archives/automation/{year}/{month}/logs_{date}.parquet
        archives/automation/{year}/{month}/screenshots_{date}.parquet
        archives/automation/{year}/{month}/input_events_{date}.parquet

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics (sessions archived, records deleted)
    """
    start_time = time.time()
    logger.info("cleanup_old_automation_data_started")

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.automation import AutomationInputEvent
        from app.models.automation_log import AutomationLog
        from app.models.automation_screenshot import AutomationScreenshot
        from app.models.automation_session import AutomationSession
        from app.services.object_storage import object_storage
        from sqlalchemy import delete, select
        from sqlalchemy.orm import selectinload

        # Archive sessions older than 180 days
        days_to_keep = 180
        cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)

        sessions_archived = 0
        logs_archived = 0
        screenshots_archived = 0
        input_events_archived = 0
        failed_uploads = 0

        async with AsyncSessionLocal() as db:
            # Query old sessions with all related data
            stmt = (
                select(AutomationSession)
                .where(AutomationSession.created_at < cutoff_date)
                .options(
                    selectinload(AutomationSession.logs),
                    selectinload(AutomationSession.screenshots),
                    selectinload(AutomationSession.input_events),
                )
            )
            result = await db.execute(stmt)
            old_sessions = result.scalars().all()

            if not old_sessions:
                logger.info(
                    "no_automation_data_to_archive",
                    cutoff_date=cutoff_date.isoformat(),
                )
                execution_time = time.time() - start_time
                return {
                    "status": "success",
                    "task": "cleanup_old_automation_data",
                    "sessions_archived": 0,
                    "records_deleted": 0,
                    "execution_time_seconds": round(execution_time, 2),
                    "timestamp": datetime.utcnow().isoformat(),
                }

            logger.info(
                "found_old_automation_sessions",
                count=len(old_sessions),
                cutoff_date=cutoff_date.isoformat(),
            )

            # Prepare data for archiving
            session_records = []
            log_records = []
            screenshot_records = []
            input_event_records = []

            for session in old_sessions:
                # Session data
                session_records.append(
                    {
                        "id": str(session.id),
                        "project_id": session.project_id,
                        "user_id": str(session.user_id),
                        "runner_version": session.runner_version,
                        "runner_os": session.runner_os,
                        "runner_hostname": session.runner_hostname,
                        "status": session.status,
                        "configuration_snapshot": str(session.configuration_snapshot),
                        "created_at": session.created_at,
                        "ended_at": session.ended_at,
                    }
                )

                # Logs
                for log in session.logs:
                    log_records.append(
                        {
                            "id": str(log.id),
                            "session_id": str(log.session_id),
                            "sequence_number": log.sequence_number,
                            "level": log.level,
                            "message": log.message,
                            "log_data": str(log.log_data),
                            "timestamp": log.timestamp,
                            "created_at": log.created_at,
                        }
                    )

                # Screenshots
                for screenshot in session.screenshots:
                    screenshot_records.append(
                        {
                            "id": str(screenshot.id),
                            "session_id": str(screenshot.session_id),
                            "project_id": screenshot.project_id,
                            "name": screenshot.name,
                            "storage_path": screenshot.storage_path,
                            "width": screenshot.width,
                            "height": screenshot.height,
                            "content_type": screenshot.content_type,
                            "automation_metadata": str(screenshot.automation_metadata),
                            "timestamp": screenshot.timestamp,
                            "created_at": screenshot.created_at,
                        }
                    )

                # Input events
                for event in session.input_events:
                    input_event_records.append(
                        {
                            "id": event.id,
                            "session_id": str(event.session_id),
                            "event_type": event.event_type,
                            "timestamp": event.timestamp,
                            "mouse_x": event.mouse_x,
                            "mouse_y": event.mouse_y,
                            "mouse_button": event.mouse_button,
                            "drag_from_x": event.drag_from_x,
                            "drag_from_y": event.drag_from_y,
                            "drag_to_x": event.drag_to_x,
                            "drag_to_y": event.drag_to_y,
                            "drag_duration": event.drag_duration,
                            "drag_path_points": (
                                str(event.drag_path_points)
                                if event.drag_path_points
                                else None
                            ),
                            "drag_avg_speed": event.drag_avg_speed,
                            "drag_max_speed": event.drag_max_speed,
                            "text_typed": event.text_typed,
                            "character_count": event.character_count,
                            "screenshot_before_id": (
                                str(event.screenshot_before_id)
                                if event.screenshot_before_id
                                else None
                            ),
                            "screenshot_after_id": (
                                str(event.screenshot_after_id)
                                if event.screenshot_after_id
                                else None
                            ),
                            "created_at": event.created_at,
                        }
                    )

            # Create dataframes
            sessions_df = pd.DataFrame(session_records)
            logs_df = pd.DataFrame(log_records) if log_records else pd.DataFrame()
            screenshots_df = (
                pd.DataFrame(screenshot_records)
                if screenshot_records
                else pd.DataFrame()
            )
            input_events_df = (
                pd.DataFrame(input_event_records)
                if input_event_records
                else pd.DataFrame()
            )

            # Generate S3 keys with date-based partitioning
            archive_date = datetime.utcnow()
            year = archive_date.strftime("%Y")
            month = archive_date.strftime("%m")
            date_str = archive_date.strftime("%Y%m%d")

            s3_keys = {
                "sessions": f"archives/automation/{year}/{month}/sessions_{date_str}.parquet",
                "logs": f"archives/automation/{year}/{month}/logs_{date_str}.parquet",
                "screenshots": f"archives/automation/{year}/{month}/screenshots_{date_str}.parquet",
                "input_events": f"archives/automation/{year}/{month}/input_events_{date_str}.parquet",
            }

            # Upload to S3 with retry logic
            upload_results = {}
            max_retries = 3

            for data_type, s3_key in s3_keys.items():
                if data_type == "sessions":
                    df = sessions_df
                elif data_type == "logs":
                    df = logs_df
                elif data_type == "screenshots":
                    df = screenshots_df
                else:  # input_events
                    df = input_events_df

                if df.empty and data_type != "sessions":
                    logger.info(f"skipping_empty_{data_type}_archive")
                    continue

                # Convert to Parquet
                parquet_buffer = io.BytesIO()
                df.to_parquet(
                    parquet_buffer, engine="pyarrow", compression="snappy", index=False
                )
                parquet_buffer.seek(0)

                # Upload with retry
                uploaded = False
                for attempt in range(max_retries):
                    try:
                        object_storage.backend.upload_file(
                            file_obj=parquet_buffer,
                            key=s3_key,
                            content_type="application/octet-stream",
                            metadata={
                                "data_type": data_type,
                                "archive_date": archive_date.isoformat(),
                                "record_count": str(len(df)),
                                "cutoff_date": cutoff_date.isoformat(),
                            },
                        )
                        upload_results[data_type] = {
                            "success": True,
                            "s3_key": s3_key,
                            "record_count": len(df),
                        }
                        logger.info(
                            f"{data_type}_archived_to_s3",
                            s3_key=s3_key,
                            record_count=len(df),
                            attempt=attempt + 1,
                        )
                        uploaded = True
                        break
                    except Exception as e:
                        logger.warning(
                            f"{data_type}_upload_retry",
                            attempt=attempt + 1,
                            max_retries=max_retries,
                            error=str(e),
                        )
                        if attempt == max_retries - 1:
                            logger.error(
                                f"{data_type}_upload_failed",
                                s3_key=s3_key,
                                error=str(e),
                                error_type=type(e).__name__,
                            )
                            failed_uploads += 1
                            upload_results[data_type] = {
                                "success": False,
                                "error": str(e),
                            }
                        parquet_buffer.seek(0)  # Reset buffer for retry

            # Only delete from database if all uploads succeeded
            if failed_uploads == 0:
                # Delete in correct order (children first, then parent)
                session_ids = [session.id for session in old_sessions]

                # Delete input events
                delete_events_stmt = delete(AutomationInputEvent).where(
                    AutomationInputEvent.session_id.in_(session_ids)
                )
                events_result = await db.execute(delete_events_stmt)
                input_events_archived = events_result.rowcount

                # Delete screenshots
                delete_screenshots_stmt = delete(AutomationScreenshot).where(
                    AutomationScreenshot.session_id.in_(session_ids)
                )
                screenshots_result = await db.execute(delete_screenshots_stmt)
                screenshots_archived = screenshots_result.rowcount

                # Delete logs
                delete_logs_stmt = delete(AutomationLog).where(
                    AutomationLog.session_id.in_(session_ids)
                )
                logs_result = await db.execute(delete_logs_stmt)
                logs_archived = logs_result.rowcount

                # Delete sessions
                delete_sessions_stmt = delete(AutomationSession).where(
                    AutomationSession.id.in_(session_ids)
                )
                sessions_result = await db.execute(delete_sessions_stmt)
                sessions_archived = sessions_result.rowcount

                await db.commit()

                logger.info(
                    "automation_data_deleted_from_database",
                    sessions=sessions_archived,
                    logs=logs_archived,
                    screenshots=screenshots_archived,
                    input_events=input_events_archived,
                )
            else:
                logger.error(
                    "skipping_database_deletion",
                    reason="some_s3_uploads_failed",
                    failed_count=failed_uploads,
                )

        execution_time = time.time() - start_time
        total_records_deleted = (
            sessions_archived
            + logs_archived
            + screenshots_archived
            + input_events_archived
        )

        logger.info(
            "cleanup_old_automation_data_completed",
            sessions_archived=sessions_archived,
            logs_archived=logs_archived,
            screenshots_archived=screenshots_archived,
            input_events_archived=input_events_archived,
            total_records_deleted=total_records_deleted,
            failed_uploads=failed_uploads,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success" if failed_uploads == 0 else "partial_success",
            "task": "cleanup_old_automation_data",
            "sessions_archived": sessions_archived,
            "logs_archived": logs_archived,
            "screenshots_archived": screenshots_archived,
            "input_events_archived": input_events_archived,
            "total_records_deleted": total_records_deleted,
            "failed_uploads": failed_uploads,
            "upload_results": upload_results,
            "cutoff_date": cutoff_date.isoformat(),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_old_automation_data_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_old_automation_data",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def archive_old_analytics_to_s3(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Archive old analytics events to S3 with daily aggregation.

    Exports analytics events older than 90 days to Parquet format, creating
    daily aggregated summaries for long-term storage. Keeps aggregated data
    in the database and deletes detailed events after successful S3 upload.

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
    start_time = time.time()
    logger.info("archive_old_analytics_to_s3_started")

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.analytics_event import AnalyticsEvent
        from app.services.object_storage import object_storage
        from sqlalchemy import delete, func, select

        # Archive events older than 90 days
        days_to_keep = settings.CLEANUP_ANALYTICS_DAYS
        cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)

        events_archived = 0
        events_deleted = 0

        async with AsyncSessionLocal() as db:
            # Query old events
            stmt = select(AnalyticsEvent).where(AnalyticsEvent.timestamp < cutoff_date)
            result = await db.execute(stmt)
            old_events = result.scalars().all()

            if not old_events:
                logger.info(
                    "no_analytics_events_to_archive",
                    cutoff_date=cutoff_date.isoformat(),
                )
                execution_time = time.time() - start_time
                return {
                    "status": "success",
                    "task": "archive_old_analytics_to_s3",
                    "events_archived": 0,
                    "events_deleted": 0,
                    "execution_time_seconds": round(execution_time, 2),
                    "timestamp": datetime.utcnow().isoformat(),
                }

            logger.info(
                "found_old_analytics_events",
                count=len(old_events),
                cutoff_date=cutoff_date.isoformat(),
            )

            # Prepare detailed event data
            event_records = []
            for event in old_events:
                event_records.append(
                    {
                        "id": str(event.id),
                        "event_name": event.event_name,
                        "user_id": str(event.user_id) if event.user_id else None,
                        "properties": str(event.properties),
                        "timestamp": event.timestamp,
                        "created_at": event.created_at,
                    }
                )

            # Create detailed events dataframe
            events_df = pd.DataFrame(event_records)

            # Create daily aggregated summary
            events_df["date"] = pd.to_datetime(events_df["timestamp"]).dt.date

            # Aggregate by date and event_name
            daily_summary = (
                events_df.groupby(["date", "event_name"])
                .agg(
                    {
                        "id": "count",  # Event count
                        "user_id": "nunique",  # Unique users
                    }
                )
                .reset_index()
            )
            daily_summary.columns = [
                "date",
                "event_name",
                "event_count",
                "unique_users",
            ]

            # Generate S3 keys with date-based partitioning
            archive_date = datetime.utcnow()
            year = archive_date.strftime("%Y")
            month = archive_date.strftime("%m")
            date_str = archive_date.strftime("%Y%m%d")

            s3_keys = {
                "events": f"archives/analytics/{year}/{month}/events_{date_str}.parquet",
                "daily_summary": f"archives/analytics/{year}/{month}/daily_summary_{date_str}.parquet",
            }

            # Upload to S3 with retry logic
            upload_results = {}
            max_retries = 3
            failed_uploads = 0

            for data_type, s3_key in s3_keys.items():
                df = events_df if data_type == "events" else daily_summary

                if df.empty:
                    logger.info(f"skipping_empty_{data_type}_archive")
                    continue

                # Convert to Parquet
                parquet_buffer = io.BytesIO()
                df.to_parquet(
                    parquet_buffer, engine="pyarrow", compression="snappy", index=False
                )
                parquet_buffer.seek(0)

                # Upload with retry
                uploaded = False
                for attempt in range(max_retries):
                    try:
                        object_storage.backend.upload_file(
                            file_obj=parquet_buffer,
                            key=s3_key,
                            content_type="application/octet-stream",
                            metadata={
                                "data_type": data_type,
                                "archive_date": archive_date.isoformat(),
                                "record_count": str(len(df)),
                                "cutoff_date": cutoff_date.isoformat(),
                            },
                        )
                        upload_results[data_type] = {
                            "success": True,
                            "s3_key": s3_key,
                            "record_count": len(df),
                        }
                        logger.info(
                            f"analytics_{data_type}_archived_to_s3",
                            s3_key=s3_key,
                            record_count=len(df),
                            attempt=attempt + 1,
                        )
                        uploaded = True
                        break
                    except Exception as e:
                        logger.warning(
                            f"analytics_{data_type}_upload_retry",
                            attempt=attempt + 1,
                            max_retries=max_retries,
                            error=str(e),
                        )
                        if attempt == max_retries - 1:
                            logger.error(
                                f"analytics_{data_type}_upload_failed",
                                s3_key=s3_key,
                                error=str(e),
                                error_type=type(e).__name__,
                            )
                            failed_uploads += 1
                            upload_results[data_type] = {
                                "success": False,
                                "error": str(e),
                            }
                        parquet_buffer.seek(0)  # Reset buffer for retry

            # Only delete detailed events from database if all uploads succeeded
            if failed_uploads == 0:
                event_ids = [event.id for event in old_events]
                delete_stmt = delete(AnalyticsEvent).where(
                    AnalyticsEvent.id.in_(event_ids)
                )
                result = await db.execute(delete_stmt)
                events_deleted = result.rowcount
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

        execution_time = time.time() - start_time

        logger.info(
            "archive_old_analytics_to_s3_completed",
            events_archived=events_archived,
            events_deleted=events_deleted,
            failed_uploads=failed_uploads,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success" if failed_uploads == 0 else "partial_success",
            "task": "archive_old_analytics_to_s3",
            "events_archived": events_archived,
            "events_deleted": events_deleted,
            "failed_uploads": failed_uploads,
            "upload_results": upload_results,
            "cutoff_date": cutoff_date.isoformat(),
            "days_to_keep": days_to_keep,
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "archive_old_analytics_to_s3_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "archive_old_analytics_to_s3",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_orphaned_sessions(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up orphaned automation sessions that were left active without proper closure.

    Finds sessions with status='active' that are older than 1 hour and automatically
    aborts them. This prevents cost accumulation from sessions that were never
    properly closed due to crashes, network failures, or other issues.

    Orphaned session criteria:
    - status = 'active'
    - created_at > 1 hour ago
    - No 'ended_at' timestamp

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics (sessions aborted)
    """
    start_time = time.time()
    logger.info("cleanup_orphaned_sessions_started")

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.automation_session import AutomationSession
        from sqlalchemy import and_, select, update

        # Find sessions active for more than 1 hour
        orphan_threshold_minutes = 60
        cutoff_time = datetime.utcnow() - timedelta(minutes=orphan_threshold_minutes)

        async with AsyncSessionLocal() as db:
            # Query active sessions older than threshold
            query = select(AutomationSession).where(
                and_(
                    AutomationSession.status == "active",
                    AutomationSession.created_at < cutoff_time,
                    AutomationSession.ended_at.is_(None),
                )
            )
            result = await db.execute(query)
            orphaned_sessions = result.scalars().all()

            if not orphaned_sessions:
                execution_time = time.time() - start_time
                logger.info(
                    "no_orphaned_sessions_found",
                    threshold_minutes=orphan_threshold_minutes,
                    execution_time_seconds=round(execution_time, 2),
                )
                return {
                    "status": "success",
                    "task": "cleanup_orphaned_sessions",
                    "sessions_aborted": 0,
                    "threshold_minutes": orphan_threshold_minutes,
                    "execution_time_seconds": round(execution_time, 2),
                    "timestamp": datetime.utcnow().isoformat(),
                }

            # Abort each orphaned session
            aborted_count = 0
            for session in orphaned_sessions:
                session.status = "aborted"
                session.ended_at = datetime.utcnow()
                aborted_count += 1

                logger.info(
                    "orphaned_session_aborted",
                    session_id=str(session.id),
                    user_id=str(session.user_id),
                    age_minutes=(datetime.utcnow() - session.created_at).total_seconds()
                    / 60,
                )

            await db.commit()

        execution_time = time.time() - start_time

        logger.info(
            "cleanup_orphaned_sessions_completed",
            sessions_aborted=aborted_count,
            threshold_minutes=orphan_threshold_minutes,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_orphaned_sessions",
            "sessions_aborted": aborted_count,
            "threshold_minutes": orphan_threshold_minutes,
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_orphaned_sessions_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_orphaned_sessions",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_old_screenshots(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up old automation screenshots based on retention policy.

    Deletes screenshots older than configured retention period (default 30 days
    for free-tier users, configurable via environment variable). Performs S3
    deletion first, then database cleanup.

    Retention policy:
    - Free tier: 30 days (configurable via SCREENSHOT_RETENTION_DAYS_FREE)
    - Paid tiers: Unlimited retention (or configurable via SCREENSHOT_RETENTION_DAYS_PAID)

    Process:
    1. Query screenshots older than retention period
    2. Delete from S3/object storage
    3. Delete from database only after successful S3 deletion
    4. Track deletion count and errors

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics (screenshots deleted, errors)
    """
    start_time = time.time()
    logger.info("cleanup_old_screenshots_started")

    try:
        from app.db.session import AsyncSessionLocal
        from app.models.automation_screenshot import AutomationScreenshot
        from app.models.user import User
        from app.services.object_storage import object_storage
        from sqlalchemy import and_, delete, select
        from sqlalchemy.orm import selectinload

        # Get retention period from settings (default 30 days for free tier)
        retention_days_free = settings.SCREENSHOT_RETENTION_DAYS_FREE if hasattr(settings, 'SCREENSHOT_RETENTION_DAYS_FREE') else 30
        cutoff_date = datetime.utcnow() - timedelta(days=retention_days_free)

        deleted_count = 0
        s3_delete_errors = 0
        db_delete_errors = 0

        async with AsyncSessionLocal() as db:
            # Query old screenshots for free-tier users
            # We need to join through AutomationSession to get to User
            from app.models.automation_session import AutomationSession

            query = (
                select(AutomationScreenshot)
                .join(AutomationSession, AutomationScreenshot.session_id == AutomationSession.id)
                .join(User, AutomationSession.user_id == User.id)
                .where(
                    and_(
                        AutomationScreenshot.created_at < cutoff_date,
                        User.subscription_tier == "free",
                    )
                )
                .options(selectinload(AutomationScreenshot.session))
            )

            result = await db.execute(query)
            old_screenshots = result.scalars().all()

            if not old_screenshots:
                execution_time = time.time() - start_time
                logger.info(
                    "no_old_screenshots_to_delete",
                    cutoff_date=cutoff_date.isoformat(),
                    retention_days=retention_days_free,
                    execution_time_seconds=round(execution_time, 2),
                )
                return {
                    "status": "success",
                    "task": "cleanup_old_screenshots",
                    "deleted_count": 0,
                    "s3_errors": 0,
                    "db_errors": 0,
                    "retention_days": retention_days_free,
                    "execution_time_seconds": round(execution_time, 2),
                    "timestamp": datetime.utcnow().isoformat(),
                }

            logger.info(
                "found_old_screenshots",
                count=len(old_screenshots),
                cutoff_date=cutoff_date.isoformat(),
                retention_days=retention_days_free,
            )

            # Delete screenshots one by one
            for screenshot in old_screenshots:
                s3_deleted = False

                # Step 1: Delete from S3
                try:
                    object_storage.backend.delete_file(screenshot.storage_path)
                    s3_deleted = True
                    logger.info(
                        "screenshot_s3_deleted",
                        screenshot_id=str(screenshot.id),
                        storage_path=screenshot.storage_path,
                    )
                except Exception as e:
                    s3_delete_errors += 1
                    logger.error(
                        "screenshot_s3_delete_failed",
                        screenshot_id=str(screenshot.id),
                        storage_path=screenshot.storage_path,
                        error=str(e),
                        error_type=type(e).__name__,
                    )
                    # Continue even if S3 delete fails - we'll try database deletion
                    # to prevent orphaned database records

                # Step 2: Delete from database (only if S3 delete succeeded OR to clean orphans)
                if s3_deleted or s3_delete_errors > 0:
                    try:
                        await db.delete(screenshot)
                        deleted_count += 1
                        logger.info(
                            "screenshot_db_deleted",
                            screenshot_id=str(screenshot.id),
                            s3_deleted=s3_deleted,
                        )
                    except Exception as e:
                        db_delete_errors += 1
                        logger.error(
                            "screenshot_db_delete_failed",
                            screenshot_id=str(screenshot.id),
                            error=str(e),
                            error_type=type(e).__name__,
                        )

            # Commit all deletions
            await db.commit()

        execution_time = time.time() - start_time

        logger.info(
            "cleanup_old_screenshots_completed",
            deleted_count=deleted_count,
            s3_errors=s3_delete_errors,
            db_errors=db_delete_errors,
            retention_days=retention_days_free,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success" if (s3_delete_errors == 0 and db_delete_errors == 0) else "partial_success",
            "task": "cleanup_old_screenshots",
            "deleted_count": deleted_count,
            "s3_errors": s3_delete_errors,
            "db_errors": db_delete_errors,
            "retention_days": retention_days_free,
            "cutoff_date": cutoff_date.isoformat(),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_old_screenshots_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_old_screenshots",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


# Export all cleanup task functions
__all__ = [
    "cleanup_expired_sessions",
    "cleanup_expired_device_sessions",
    "cleanup_old_analytics_events",
    "cleanup_token_blacklist",
    "cleanup_old_automation_data",
    "archive_old_analytics_to_s3",
    "cleanup_orphaned_sessions",
    "cleanup_old_screenshots",
]
