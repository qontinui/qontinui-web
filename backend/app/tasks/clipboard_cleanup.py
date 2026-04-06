"""
Background task for cleaning up expired clipboard entries.

Runs periodically to delete clipboard_entries whose expires_at has passed.
Default expiry is 24 hours from creation.
"""

import asyncio
from datetime import UTC, datetime

import structlog
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.models.clipboard import ClipboardEntry

logger = structlog.get_logger(__name__)


async def cleanup_expired_clipboard() -> dict[str, int]:
    """
    Delete all clipboard entries that have expired.

    Returns:
        Dictionary with cleanup statistics:
        - deleted: Number of entries removed
    """
    stats = {"deleted": 0}

    try:
        async with AsyncSessionLocal() as db:
            now = datetime.now(UTC)
            stmt = delete(ClipboardEntry).where(ClipboardEntry.expires_at <= now)
            result = await db.execute(stmt)
            stats["deleted"] = result.rowcount
            await db.commit()

            if stats["deleted"] > 0:
                logger.info(
                    "clipboard_cleanup_completed",
                    deleted=stats["deleted"],
                )
            else:
                logger.debug("clipboard_cleanup_no_expired")

    except Exception as e:
        logger.error(
            "clipboard_cleanup_error",
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )

    return stats


async def run_clipboard_cleanup_loop(interval_seconds: int = 3600) -> None:
    """
    Background loop that periodically cleans up expired clipboard entries.

    Args:
        interval_seconds: Time between cleanup runs (default: 3600 = 1 hour)
    """
    logger.info(
        "clipboard_cleanup_loop_started",
        interval_seconds=interval_seconds,
    )

    while True:
        try:
            await cleanup_expired_clipboard()
        except Exception as e:
            logger.error(
                "clipboard_cleanup_loop_error",
                error=str(e),
                error_type=type(e).__name__,
            )

        await asyncio.sleep(interval_seconds)
