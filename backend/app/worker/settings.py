"""ARQ worker configuration and settings."""

from arq.connections import RedisSettings

from app.core.config import settings
from app.worker.scheduler import get_cleanup_cron_jobs, run_all_cleanup_tasks
from app.worker.tasks import (
    process_uploaded_image,
    send_analytics_report_task,
    send_email_task,
    send_password_reset_email_task,
    send_verification_email_task,
)
from app.worker.tasks.cleanup_tasks import (
    archive_old_analytics_to_s3,
    cleanup_expired_device_sessions,
    cleanup_expired_sessions,
    cleanup_old_analytics_events,
    cleanup_old_automation_data,
    cleanup_token_blacklist,
)
from app.worker.tasks.partition_tasks import (
    auto_create_partitions,
    cleanup_old_partitions,
    get_partition_cron_jobs,
    get_partition_statistics,
)
from app.worker.tasks.recording_processing_tasks import process_recording_task


def get_arq_redis_settings() -> RedisSettings:
    """Get Redis settings for ARQ worker."""
    return RedisSettings(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        database=settings.REDIS_DB,
    )


class WorkerSettings:
    """ARQ worker configuration."""

    # Redis connection
    redis_settings = get_arq_redis_settings()

    # Worker behavior
    max_jobs = 10  # Maximum concurrent jobs
    job_timeout = (
        1800  # 30 minutes timeout per job (recording processing can take time)
    )
    keep_result = 3600  # Keep job results for 1 hour

    # Health check
    health_check_interval = 60  # Health check every 60 seconds

    # Task functions
    functions = [
        # Email tasks
        send_email_task,
        send_verification_email_task,
        send_password_reset_email_task,
        send_analytics_report_task,
        # Image processing tasks
        process_uploaded_image,
        # Cleanup tasks
        cleanup_expired_sessions,
        cleanup_expired_device_sessions,
        cleanup_old_analytics_events,
        cleanup_token_blacklist,
        cleanup_old_automation_data,
        archive_old_analytics_to_s3,
        run_all_cleanup_tasks,
        # Partition management tasks
        auto_create_partitions,
        cleanup_old_partitions,
        get_partition_statistics,
        # Recording processing tasks
        process_recording_task,
    ]

    # Cron jobs - Dynamically loaded from scheduler
    # The scheduler will enable/disable jobs based on CLEANUP_ENABLED setting
    # Default schedule: daily at 2 AM UTC (configurable via CLEANUP_SCHEDULE)
    cron_jobs = get_cleanup_cron_jobs()

    # Add partition management cron jobs
    # Schedule: Weekly on Sundays (1 AM and 3 AM UTC)
    cron_jobs.extend(get_partition_cron_jobs())

    # Example: Commented out old cron jobs for reference
    # Weekly analytics report for admin (user_id=1)
    # cron_jobs.extend([
    #     {
    #         "function": send_analytics_report_task,
    #         "kwargs": {"user_id": 1, "report_type": "weekly"},
    #         "weekday": 1,  # Monday
    #         "hour": 9,
    #         "minute": 0,
    #     },
    # ])
