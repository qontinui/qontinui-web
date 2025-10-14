"""ARQ worker configuration and settings."""

from arq.connections import RedisSettings

from app.core.config import settings


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
    job_timeout = 300  # 5 minutes timeout per job
    keep_result = 3600  # Keep job results for 1 hour

    # Health check
    health_check_interval = 60  # Health check every 60 seconds

    # Task functions
    from app.worker.tasks import (
        cleanup_old_data_task,
        process_image_task,
        send_analytics_report_task,
        send_email_task,
        send_password_reset_email_task,
        send_verification_email_task,
    )

    functions = [
        send_email_task,
        send_verification_email_task,
        send_password_reset_email_task,
        process_image_task,
        send_analytics_report_task,
        cleanup_old_data_task,
    ]

    # Cron jobs (optional) - runs cleanup daily at 2 AM
    cron_jobs = [
        # ("cleanup_old_data_task", cleanup_old_data_task, hour=2, minute=0),
    ]
