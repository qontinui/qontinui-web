"""Automation cleanup tasks for session and data management.

This module handles cleanup and archival of automation data including:
- Orphaned automation sessions (stuck in active state)
- Old automation data archival to S3 (sessions, logs, screenshots, input events)
"""

from collections.abc import Sequence
from datetime import timedelta
from typing import Any

import pandas as pd  # type: ignore[import-untyped]
from app.worker.tasks.cleanup_utils import (CleanupResult, TaskTimer,
                                            create_error_result,
                                            create_partial_success_result,
                                            create_success_result,
                                            generate_archive_s3_keys, logger,
                                            upload_dataframes_to_s3)
from qontinui_schemas.common import utc_now


async def cleanup_orphaned_sessions(ctx: dict[str, Any]) -> CleanupResult:
    """Clean up orphaned automation sessions that were left active without proper closure.

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
    logger.info("cleanup_orphaned_sessions_started")

    with TaskTimer() as timer:
        try:
            from app.db.session import AsyncSessionLocal
            from app.models.automation_session import AutomationSession
            from sqlalchemy import and_, select

            # Find sessions active for more than 1 hour
            orphan_threshold_minutes = 60
            cutoff_time = utc_now() - timedelta(minutes=orphan_threshold_minutes)

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
                    logger.info(
                        "no_orphaned_sessions_found",
                        threshold_minutes=orphan_threshold_minutes,
                        execution_time_seconds=round(timer.elapsed, 2),
                    )
                    return create_success_result(
                        task_name="cleanup_orphaned_sessions",
                        execution_time=timer.elapsed,
                        sessions_aborted=0,
                        threshold_minutes=orphan_threshold_minutes,
                    )

                # Abort each orphaned session
                aborted_count = 0
                for session in orphaned_sessions:
                    session.status = "aborted"
                    session.ended_at = utc_now()
                    aborted_count += 1

                    logger.info(
                        "orphaned_session_aborted",
                        session_id=str(session.id),
                        user_id=str(session.user_id),
                        age_minutes=(utc_now() - session.created_at).total_seconds()
                        / 60,
                    )

                await db.commit()

            logger.info(
                "cleanup_orphaned_sessions_completed",
                sessions_aborted=aborted_count,
                threshold_minutes=orphan_threshold_minutes,
                execution_time_seconds=round(timer.elapsed, 2),
            )

            return create_success_result(
                task_name="cleanup_orphaned_sessions",
                execution_time=timer.elapsed,
                sessions_aborted=aborted_count,
                threshold_minutes=orphan_threshold_minutes,
            )

        except Exception as e:
            logger.exception(
                "cleanup_orphaned_sessions_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="cleanup_orphaned_sessions",
                error=e,
                execution_time=timer.elapsed,
            )


async def cleanup_old_automation_data(ctx: dict[str, Any]) -> CleanupResult:
    """Archive and clean up old automation session data.

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
    logger.info("cleanup_old_automation_data_started")

    with TaskTimer() as timer:
        try:
            from app.db.session import AsyncSessionLocal
            from app.models.automation import AutomationInputEvent
            from app.models.automation_log import AutomationLog
            from app.models.automation_screenshot import AutomationScreenshot
            from app.models.automation_session import AutomationSession
            from sqlalchemy import delete, select
            from sqlalchemy.orm import selectinload

            # Archive sessions older than 180 days
            days_to_keep = 180
            cutoff_date = utc_now() - timedelta(days=days_to_keep)

            sessions_archived = 0
            logs_archived = 0
            screenshots_archived = 0
            input_events_archived = 0

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
                    return create_success_result(
                        task_name="cleanup_old_automation_data",
                        execution_time=timer.elapsed,
                        sessions_archived=0,
                        records_deleted=0,
                    )

                logger.info(
                    "found_old_automation_sessions",
                    count=len(old_sessions),
                    cutoff_date=cutoff_date.isoformat(),
                )

                # Prepare data for archiving
                session_records = _prepare_session_records(old_sessions)
                log_records = _prepare_log_records(old_sessions)
                screenshot_records = _prepare_screenshot_records(old_sessions)
                input_event_records = _prepare_input_event_records(old_sessions)

                # Create dataframes
                dataframes = {
                    "sessions": pd.DataFrame(session_records),
                    "logs": (
                        pd.DataFrame(log_records) if log_records else pd.DataFrame()
                    ),
                    "screenshots": (
                        pd.DataFrame(screenshot_records)
                        if screenshot_records
                        else pd.DataFrame()
                    ),
                    "input_events": (
                        pd.DataFrame(input_event_records)
                        if input_event_records
                        else pd.DataFrame()
                    ),
                }

                # Generate S3 keys and upload
                archive_date = utc_now()
                s3_keys = generate_archive_s3_keys(
                    archive_type="automation",
                    data_types=["sessions", "logs", "screenshots", "input_events"],
                    archive_date=archive_date,
                )

                # Upload to S3 with retry logic
                upload_results, failed_uploads = upload_dataframes_to_s3(
                    dataframes=dataframes,
                    s3_keys=s3_keys,
                    archive_date=archive_date,
                    cutoff_date=cutoff_date,
                    skip_empty_except=["sessions"],
                )

                # Only delete from database if all uploads succeeded
                if failed_uploads == 0:
                    session_ids = [session.id for session in old_sessions]

                    # Delete in correct order (children first, then parent)
                    # Delete input events
                    delete_events_stmt = delete(AutomationInputEvent).where(
                        AutomationInputEvent.session_id.in_(session_ids)
                    )
                    events_result = await db.execute(delete_events_stmt)
                    input_events_archived = events_result.rowcount or 0  # type: ignore[attr-defined]

                    # Delete screenshots
                    delete_screenshots_stmt = delete(AutomationScreenshot).where(
                        AutomationScreenshot.session_id.in_(session_ids)
                    )
                    screenshots_result = await db.execute(delete_screenshots_stmt)
                    screenshots_archived = screenshots_result.rowcount or 0  # type: ignore[attr-defined]

                    # Delete logs
                    delete_logs_stmt = delete(AutomationLog).where(
                        AutomationLog.session_id.in_(session_ids)
                    )
                    logs_result = await db.execute(delete_logs_stmt)
                    logs_archived = logs_result.rowcount or 0  # type: ignore[attr-defined]

                    # Delete sessions
                    delete_sessions_stmt = delete(AutomationSession).where(
                        AutomationSession.id.in_(session_ids)
                    )
                    sessions_result = await db.execute(delete_sessions_stmt)
                    sessions_archived = sessions_result.rowcount or 0  # type: ignore[attr-defined]

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
                execution_time_seconds=round(timer.elapsed, 2),
            )

            if failed_uploads == 0:
                return create_success_result(
                    task_name="cleanup_old_automation_data",
                    execution_time=timer.elapsed,
                    sessions_archived=sessions_archived,
                    logs_archived=logs_archived,
                    screenshots_archived=screenshots_archived,
                    input_events_archived=input_events_archived,
                    total_records_deleted=total_records_deleted,
                    failed_uploads=failed_uploads,
                    upload_results=upload_results,
                    cutoff_date=cutoff_date.isoformat(),
                )
            else:
                return create_partial_success_result(
                    task_name="cleanup_old_automation_data",
                    execution_time=timer.elapsed,
                    sessions_archived=sessions_archived,
                    logs_archived=logs_archived,
                    screenshots_archived=screenshots_archived,
                    input_events_archived=input_events_archived,
                    total_records_deleted=total_records_deleted,
                    failed_uploads=failed_uploads,
                    upload_results=upload_results,
                    cutoff_date=cutoff_date.isoformat(),
                )

        except Exception as e:
            logger.exception(
                "cleanup_old_automation_data_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="cleanup_old_automation_data",
                error=e,
                execution_time=timer.elapsed,
            )


def _prepare_session_records(sessions: Sequence[Any]) -> list[dict[str, Any]]:
    """Prepare session records for archival."""
    records = []
    for session in sessions:
        records.append(
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
    return records


def _prepare_log_records(sessions: Sequence[Any]) -> list[dict[str, Any]]:
    """Prepare log records for archival."""
    records = []
    for session in sessions:
        for log in session.logs:
            records.append(
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
    return records


def _prepare_screenshot_records(sessions: Sequence[Any]) -> list[dict[str, Any]]:
    """Prepare screenshot records for archival."""
    records = []
    for session in sessions:
        for screenshot in session.screenshots:
            records.append(
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
    return records


def _prepare_input_event_records(sessions: Sequence[Any]) -> list[dict[str, Any]]:
    """Prepare input event records for archival."""
    records = []
    for session in sessions:
        for event in session.input_events:
            records.append(
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
                        str(event.drag_path_points) if event.drag_path_points else None
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
    return records


# Export all automation cleanup tasks
__all__ = [
    "cleanup_orphaned_sessions",
    "cleanup_old_automation_data",
]
