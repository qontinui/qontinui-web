"""ARQ scheduler for periodic cleanup tasks."""

from typing import Any

import structlog
from app.core.config import settings

logger = structlog.get_logger(__name__)


async def run_all_cleanup_tasks(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Run all cleanup tasks in sequence.

    This is the main cleanup job scheduled to run daily.
    It executes all cleanup tasks and aggregates the results.

    Args:
        ctx: ARQ context

    Returns:
        Dict with aggregated cleanup results
    """
    logger.info("run_all_cleanup_tasks_started")

    # Import cleanup tasks
    from app.worker.tasks.cleanup_tasks import (
        archive_old_analytics_to_s3,
        cleanup_expired_device_sessions,
        cleanup_expired_sessions,
        cleanup_old_analytics_events,
        cleanup_old_automation_data,
        cleanup_token_blacklist,
    )

    results = {
        "status": "success",
        "tasks": {},
        "total_deleted": 0,
        "total_archived": 0,
    }

    # Run each cleanup task
    tasks = [
        ("sessions", cleanup_expired_sessions),
        ("device_sessions", cleanup_expired_device_sessions),
        ("analytics_events", cleanup_old_analytics_events),
        ("token_blacklist", cleanup_token_blacklist),
        ("automation_data", cleanup_old_automation_data),
        ("analytics_archive", archive_old_analytics_to_s3),
    ]

    for task_name, task_func in tasks:
        try:
            result = await task_func(ctx)
            results["tasks"][task_name] = result

            # Aggregate total deletions and archives
            if result.get("status") in ("success", "partial_success"):
                results["total_deleted"] += result.get("deleted_count", 0)
                results["total_deleted"] += result.get("total_records_deleted", 0)
                results["total_deleted"] += result.get("events_deleted", 0)

                results["total_archived"] += result.get("sessions_archived", 0)
                results["total_archived"] += result.get("events_archived", 0)

            if result.get("status") != "success":
                # Mark overall status as partial success if any task fails
                results["status"] = "partial_success"

        except Exception as e:
            logger.exception(
                "cleanup_task_failed",
                task_name=task_name,
                error=str(e),
                error_type=type(e).__name__,
            )
            results["tasks"][task_name] = {
                "status": "error",
                "error": str(e),
            }
            results["status"] = "partial_success"

    logger.info(
        "run_all_cleanup_tasks_completed",
        status=results["status"],
        total_deleted=results["total_deleted"],
        total_archived=results["total_archived"],
    )

    return results


def get_cleanup_cron_jobs() -> list[dict[str, Any]]:
    """
    Get cron job definitions for cleanup tasks.

    Returns:
        List of cron job definitions for ARQ
    """
    if not settings.CLEANUP_ENABLED:
        logger.info("cleanup_jobs_disabled", reason="CLEANUP_ENABLED=False")
        return []

    # Parse cron schedule (default: "0 2 * * *" = daily at 2 AM UTC)
    # Format: "minute hour day month weekday"
    schedule_parts = settings.CLEANUP_SCHEDULE.split()

    if len(schedule_parts) != 5:
        logger.error(
            "invalid_cron_schedule",
            schedule=settings.CLEANUP_SCHEDULE,
            expected_format="minute hour day month weekday",
        )
        return []

    minute, hour, day, month, weekday = schedule_parts

    cron_job = {
        "function": run_all_cleanup_tasks,
        "hour": int(hour) if hour != "*" else None,
        "minute": int(minute) if minute != "*" else None,
        "keep_result_forever": True,  # Keep cleanup results for audit
    }

    # Add optional day/month/weekday constraints if specified
    if day != "*":
        cron_job["day"] = int(day)
    if month != "*":
        cron_job["month"] = int(month)
    if weekday != "*":
        cron_job["weekday"] = int(weekday)

    logger.info(
        "cleanup_jobs_scheduled",
        schedule=settings.CLEANUP_SCHEDULE,
        cron_job=cron_job,
    )

    return [cron_job]


# Export for use in worker settings
__all__ = [
    "run_all_cleanup_tasks",
    "get_cleanup_cron_jobs",
]
