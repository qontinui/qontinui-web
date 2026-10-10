"""The shared GitHub rate budget, persisted (``web.github_rate_budget``).

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``.

Both GitHub visibility readers — the publish route and the scheduled
re-check — write GitHub's last reported ``X-RateLimit-Remaining`` /
``X-RateLimit-Reset`` here, and both read it before spending calls:

* publish refuses while the budget is at or below :data:`PUBLISH_RESERVE`;
* the re-check stops at :data:`RECHECK_RESERVE`, which is HIGHER, so the band
  between the two is left for publishes — the re-check can no longer spend
  the calls a publish needs.

A reading is stale once its window has reset (``reset_at`` passed), or, when
GitHub sent no reset, an hour after it was observed; a stale reading reserves
nothing. Persisted because the backend runs several replicas and redeploys
often (revision ``build_records_01_export``).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.build_record import GithubRateBudget
from app.services.github_repo_visibility import VisibilityAnswer

#: Publish refuses at or below this many remaining calls.
PUBLISH_RESERVE: Final = 20
#: The scheduled re-check stops at or below this many — above
#: :data:`PUBLISH_RESERVE`, so the band in between is publish's alone.
RECHECK_RESERVE: Final = 30
_NO_RESET_STALE_AFTER: Final = timedelta(hours=1)


async def record(db: AsyncSession, answers: Iterable[VisibilityAnswer]) -> None:
    """Store the LOWEST remaining count these answers reported. No commit."""
    observed = [a for a in answers if a.rate_limit_remaining is not None]
    if not observed:
        return
    lowest = min(observed, key=lambda a: a.rate_limit_remaining or 0)
    values = {
        "id": True,
        "remaining": lowest.rate_limit_remaining,
        "reset_at": lowest.rate_limit_reset,
        "observed_at": datetime.now(UTC),
    }
    await db.execute(
        pg_insert(GithubRateBudget)
        .values(**values)
        .on_conflict_do_update(index_elements=["id"], set_=values)
    )


async def reserved(db: AsyncSession, reserve: int) -> bool:
    """Whether the last FRESH reading is at or below ``reserve``."""
    row = (
        await db.execute(
            select(GithubRateBudget).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None or row.remaining is None or row.remaining > reserve:
        return False
    now = datetime.now(UTC)
    if row.reset_at is not None:
        return row.reset_at > now
    return row.observed_at > now - _NO_RESET_STALE_AFTER
