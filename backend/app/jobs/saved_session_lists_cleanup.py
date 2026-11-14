"""Scheduled job — delete expired saved session lists.

Runs on the scheduler's ``saved_session_lists_cleanup`` cadence (hourly, and
at boot) to delete ``project.saved_session_lists`` rows whose ``expires_at``
has passed. Every read already hides an expired row (``expires_at > now``), so
expiry is exact without this job. The job is what makes an expired list
actually GONE (plan
``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``,
D5). Modelled on ``app.jobs.clipboard_cleanup``.

A failure is re-raised: the scheduler then records ``last_status="failed"``
on ``/health`` and keeps looping. Swallowing it would make every failed run
report ``"ok"``.

A missing table is a normal state, not a failure, as in
``app.jobs.journey_edge_retention``: a deploy whose scheduler starts before
this table's migration is applied logs the absence and returns
``table_present: False``. That is reported as absent, never as "deleted 0
rows".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models.saved_session_list import SavedSessionList

logger = structlog.get_logger(__name__)

TABLE = "project.saved_session_lists"

_TABLE_PRESENT_SQL = text("SELECT to_regclass(:table) IS NOT NULL")


@dataclass(frozen=True)
class SavedSessionListPurge:
    """What one purge pass did.

    ``table_present`` False means the pass did not run at all (the migration
    is not applied). ``deleted`` is then 0 because nothing was measured, not
    because nothing had expired.
    """

    table_present: bool
    deleted: int
    now: datetime


async def delete_expired_saved_session_lists(
    db: AsyncSession, *, now: datetime | None = None
) -> SavedSessionListPurge:
    """Delete every saved list whose ``expires_at`` is at or before ``now``.

    The boundary agrees with the reads: a row is visible while
    ``now < expires_at`` and deletable from ``expires_at`` on. Does not
    commit; the caller owns the transaction.
    """
    at = now or datetime.now(UTC)
    present = (await db.execute(_TABLE_PRESENT_SQL, {"table": TABLE})).scalar_one()
    if not present:
        logger.warning(
            "saved_session_lists absent — migration not applied",
            table=TABLE,
        )
        return SavedSessionListPurge(table_present=False, deleted=0, now=at)

    result = await db.execute(
        delete(SavedSessionList).where(SavedSessionList.expires_at <= at)
    )
    deleted = int(result.rowcount or 0)  # type: ignore[attr-defined]
    return SavedSessionListPurge(table_present=True, deleted=deleted, now=at)


async def cleanup_expired_saved_session_lists() -> dict[str, Any]:
    """Scheduler entry: one purge pass in its own committed session."""
    try:
        async with AsyncSessionLocal() as db:
            outcome = await delete_expired_saved_session_lists(db)
            await db.commit()
    except Exception as e:
        logger.error(
            "saved_session_lists_cleanup_error",
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )
        raise

    if outcome.deleted > 0:
        logger.info("saved_session_lists_cleanup_completed", deleted=outcome.deleted)
    elif outcome.table_present:
        logger.debug("saved_session_lists_cleanup_no_expired")
    return {
        "table_present": outcome.table_present,
        "deleted": outcome.deleted,
        "now": outcome.now.isoformat(),
    }
