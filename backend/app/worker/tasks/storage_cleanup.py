"""Storage cleanup tasks for file and screenshot management.

This module handles cleanup of storage resources including:
- Old automation screenshots based on retention policy
- Orphaned files in object storage
"""

from datetime import timedelta
from typing import Any

from qontinui_schemas.common import utc_now

from app.core.config import settings
from app.worker.tasks.cleanup_utils import (
    CleanupResult,
    TaskTimer,
    create_error_result,
    create_partial_success_result,
    create_success_result,
    logger,
)


async def cleanup_old_screenshots(ctx: dict[str, Any]) -> CleanupResult:
    """Clean up old automation screenshots based on retention policy.

    Deletes screenshots older than the configured retention period. Performs S3
    deletion first, then database cleanup.

    Self-host: retention applies uniformly to all users; default 30 days,
    configurable via SCREENSHOT_RETENTION_DAYS environment variable. Operators
    who want no auto-deletion simply don't schedule this task.

    Cloud-control overrides this task with its own per-tier retention policy.

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
    logger.info("cleanup_old_screenshots_started")

    with TaskTimer() as timer:
        try:
            from sqlalchemy import select

            from app.db.session import AsyncSessionLocal
            from app.models.automation_screenshot import AutomationScreenshot
            from app.services.object_storage import object_storage

            # Get retention period from settings (default 30 days)
            retention_days = (
                settings.SCREENSHOT_RETENTION_DAYS_FREE
                if hasattr(settings, "SCREENSHOT_RETENTION_DAYS_FREE")
                else 30
            )
            cutoff_date = utc_now() - timedelta(days=retention_days)

            deleted_count = 0
            s3_delete_errors = 0
            db_delete_errors = 0

            async with AsyncSessionLocal() as db:
                # Query screenshots older than retention period (all users)
                query = select(AutomationScreenshot).where(
                    AutomationScreenshot.created_at < cutoff_date
                )

                result = await db.execute(query)
                old_screenshots = result.scalars().all()

                if not old_screenshots:
                    logger.info(
                        "no_old_screenshots_to_delete",
                        cutoff_date=cutoff_date.isoformat(),
                        retention_days=retention_days,
                        execution_time_seconds=round(timer.elapsed, 2),
                    )
                    return create_success_result(
                        task_name="cleanup_old_screenshots",
                        execution_time=timer.elapsed,
                        deleted_count=0,
                        s3_errors=0,
                        db_errors=0,
                        retention_days=retention_days,
                    )

                logger.info(
                    "found_old_screenshots",
                    count=len(old_screenshots),
                    cutoff_date=cutoff_date.isoformat(),
                    retention_days=retention_days,
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

                    # Step 2: Delete from database
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

            logger.info(
                "cleanup_old_screenshots_completed",
                deleted_count=deleted_count,
                s3_errors=s3_delete_errors,
                db_errors=db_delete_errors,
                retention_days=retention_days,
                execution_time_seconds=round(timer.elapsed, 2),
            )

            if s3_delete_errors == 0 and db_delete_errors == 0:
                return create_success_result(
                    task_name="cleanup_old_screenshots",
                    execution_time=timer.elapsed,
                    deleted_count=deleted_count,
                    s3_errors=s3_delete_errors,
                    db_errors=db_delete_errors,
                    retention_days=retention_days,
                    cutoff_date=cutoff_date.isoformat(),
                )
            else:
                return create_partial_success_result(
                    task_name="cleanup_old_screenshots",
                    execution_time=timer.elapsed,
                    deleted_count=deleted_count,
                    s3_errors=s3_delete_errors,
                    db_errors=db_delete_errors,
                    retention_days=retention_days,
                    cutoff_date=cutoff_date.isoformat(),
                )

        except Exception as e:
            logger.exception(
                "cleanup_old_screenshots_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="cleanup_old_screenshots",
                error=e,
                execution_time=timer.elapsed,
            )


# Export all storage cleanup tasks
__all__ = [
    "cleanup_old_screenshots",
]
