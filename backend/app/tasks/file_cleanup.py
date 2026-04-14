"""
Background task for cleaning up expired shared files.

Runs periodically to delete shared_files entries and their
corresponding files on disk whose expires_at has passed.
Default expiry is 7 days from creation.
"""

import asyncio
import os
from datetime import UTC, datetime

import structlog
from app.db.session import AsyncSessionLocal
from app.models.shared_file import SharedFile
from sqlalchemy import select

logger = structlog.get_logger(__name__)


async def cleanup_expired_files() -> dict[str, int]:
    """
    Delete all shared file entries and their disk files that have expired.

    Returns:
        Dictionary with cleanup statistics:
        - deleted: Number of entries removed
        - disk_errors: Number of filesystem delete failures
    """
    stats = {"deleted": 0, "disk_errors": 0}

    try:
        async with AsyncSessionLocal() as db:
            now = datetime.now(UTC)
            query = select(SharedFile).where(SharedFile.expires_at <= now)
            result = await db.execute(query)
            expired = list(result.scalars().all())

            for entry in expired:
                # Remove file from disk
                if os.path.exists(entry.storage_path):
                    try:
                        os.remove(entry.storage_path)
                    except OSError as e:
                        stats["disk_errors"] += 1
                        logger.warning(
                            "file_cleanup_disk_error",
                            file_id=str(entry.id),
                            path=entry.storage_path,
                            error=str(e),
                        )

                await db.delete(entry)
                stats["deleted"] += 1

            await db.commit()

            if stats["deleted"] > 0:
                logger.info(
                    "file_cleanup_completed",
                    deleted=stats["deleted"],
                    disk_errors=stats["disk_errors"],
                )
            else:
                logger.debug("file_cleanup_no_expired")

    except Exception as e:
        logger.error(
            "file_cleanup_error",
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )

    return stats


async def run_file_cleanup_loop(interval_seconds: int = 3600) -> None:
    """
    Background loop that periodically cleans up expired shared files.

    Args:
        interval_seconds: Time between cleanup runs (default: 3600 = 1 hour)
    """
    logger.info(
        "file_cleanup_loop_started",
        interval_seconds=interval_seconds,
    )

    while True:
        try:
            await cleanup_expired_files()
        except Exception as e:
            logger.error(
                "file_cleanup_loop_error",
                error=str(e),
                error_type=type(e).__name__,
            )

        await asyncio.sleep(interval_seconds)
