"""ARQ connection pool for FastAPI integration."""

import logging
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis

from app.worker.settings import get_arq_redis_settings

logger = logging.getLogger(__name__)

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
        logger.info("ARQ Redis pool created")

    return _arq_pool


async def close_arq_pool() -> None:
    """Close ARQ Redis connection pool."""
    global _arq_pool

    if _arq_pool is not None:
        await _arq_pool.close()
        _arq_pool = None
        logger.info("ARQ Redis pool closed")


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
    try:
        pool = await get_arq_pool()
        job = await pool.enqueue_job(task_name, *args, **kwargs)
        logger.info(f"Task {task_name} enqueued with job ID: {job.job_id}")
        return job.job_id
    except Exception as e:
        logger.error(f"Failed to enqueue task {task_name}: {e}")
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
        job = await pool.get_job(job_id)
        if job is None:
            return None
        return await job.result()
    except Exception as e:
        logger.error(f"Failed to get job result for {job_id}: {e}")
        return None
