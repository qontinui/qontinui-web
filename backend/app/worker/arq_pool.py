"""ARQ connection pool for FastAPI integration."""

from typing import Any

import structlog
from app.worker.settings import get_arq_redis_settings
from arq import create_pool
from arq.connections import ArqRedis
from arq.jobs import Job

logger = structlog.get_logger(__name__)

# Global connection pool
_arq_pool: ArqRedis | None = None


async def get_arq_pool() -> ArqRedis:
    """
    Get or create ARQ Redis connection pool.

    Returns:
        ArqRedis connection pool
    """
    global _arq_pool

    if _arq_pool is None:
        redis_settings = get_arq_redis_settings()
        _arq_pool = await create_pool(redis_settings)
        logger.info("arq_redis_pool_created")

    return _arq_pool


async def close_arq_pool() -> None:
    """Close ARQ Redis connection pool."""
    global _arq_pool

    if _arq_pool is not None:
        await _arq_pool.close()
        _arq_pool = None
        logger.info("arq_redis_pool_closed")


async def enqueue_task(
    task_name: str,
    *args: Any,
    **kwargs: Any,
) -> str | None:
    """
    Enqueue a background task.

    Args:
        task_name: Name of the task function (e.g., 'send_email_task')
        *args: Positional arguments for the task
        **kwargs: Keyword arguments for the task

    Returns:
        Job ID if enqueued successfully, None otherwise
    """
    global _arq_pool

    # If pool was never initialized (Redis unavailable), skip silently
    if _arq_pool is None:
        logger.warning(
            "task_not_enqueued", task_name=task_name, reason="arq_pool_unavailable"
        )
        return None

    try:
        job = await _arq_pool.enqueue_job(task_name, *args, **kwargs)
        if job is None:
            logger.warning("task_enqueue_returned_none", task_name=task_name)
            return None
        logger.info("task_enqueued", task_name=task_name, job_id=job.job_id)
        return str(job.job_id) if job.job_id else None
    except Exception as e:
        logger.error(
            "task_enqueue_failed",
            task_name=task_name,
            error=str(e),
            error_type=type(e).__name__,
        )
        return None


async def get_job_result(job_id: str) -> Any:
    """
    Get result of a completed job.

    Args:
        job_id: Job ID returned from enqueue_task

    Returns:
        Job result if available, None otherwise
    """
    try:
        pool = await get_arq_pool()
        job = Job(job_id=job_id, redis=pool)
        return await job.result()
    except Exception as e:
        logger.error(
            "job_result_fetch_failed",
            job_id=job_id,
            error=str(e),
            error_type=type(e).__name__,
        )
        return None
