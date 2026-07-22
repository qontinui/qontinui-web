"""Scheduled job — clean up expired clipboard entries.

Runs on the scheduler's ``clipboard_cleanup`` cadence (hourly) to delete
``clipboard_entries`` whose ``expires_at`` has passed. Default expiry is 24
hours from creation.
"""

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
            stats["deleted"] = result.rowcount or 0  # type: ignore[attr-defined, assignment]
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
        # Re-raise: the scheduler records `last_status="failed"` on /health and
        # keeps looping. Swallowing here (needed by the old `while True` loop, which
        # would have died) would make every failed run report `"ok"` — the exact
        # silent-no-op blindness this scheduler exists to end.
        raise

    return stats
