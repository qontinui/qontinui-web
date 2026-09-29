"""Journey edge ledger retention.

Scheduled job ``journey_edge_retention`` (``app.core.scheduler``, hourly and at
boot) deletes ``project.journey_edge_observations`` rows whose ``observed_at``
is older than ``JOURNEY_EDGE_RETENTION_DAYS`` (default 90). Modelled on
``app.jobs.render_log_retention``: committed chunks, so a pass that is
interrupted keeps the chunks it finished.

Scope: THIS BACKEND'S DATABASE ONLY. The runner writes journey edges to its
own embedded Postgres (the vendored copy of this schema), which this job can
never reach; the runner prunes its own embedded database, and that prune is
added in the runner half of the same Phase 1. Rows here are those that reach
the web backend's Postgres — this job says nothing about a runner's ledger.

Every pass logs ``duration_seconds``. The ledger deliberately has no
``observed_at``-only index (see the ``journey_01_edge_ledger`` docstring); a
pass exceeding 60 s is one of that decision's two named revisit triggers.

``project.journey_frontier`` needs no retention — its primary key
``(app_id, node_key, affordance_fingerprint)`` bounds it.

The table has no SQLAlchemy model, matching its precedent
``project.co_occurrence_observations`` (written by the runner, read by nothing
in this backend), so the job speaks plain SQL through ``sqlalchemy.text``.

A missing table is a normal state, not a crash: the scheduler boots on any
database the alembic chain has not yet reached (a dev box behind ``main``, a
fresh test database built from the models). The pass then logs
``journey_edge_observations absent — migration not applied`` once per pass
(so once per hourly run, for as long as the table is absent) and returns
``table_present: False`` — reported as absent, never as "deleted 0 rows".
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

logger = structlog.get_logger(__name__)

TABLE = "project.journey_edge_observations"

# Rows per retention chunk; each chunk commits on its own.
RETENTION_CHUNK_ROWS = 1000

_TABLE_PRESENT_SQL = text("SELECT to_regclass(:table) IS NOT NULL")

# No ORDER BY: which expired rows go first is immaterial (they all go), and the
# ledger carries no observed_at-only index to make an ordered scan cheap.
_DELETE_CHUNK_SQL = text(
    f"""
    DELETE FROM {TABLE}
     WHERE id IN (
        SELECT id FROM {TABLE}
         WHERE observed_at < :cutoff
         LIMIT :chunk
     )
    """
)


@dataclass(frozen=True)
class JourneyEdgeDeletion:
    """What one retention pass did.

    ``table_present`` False means the pass did not run at all (the migration
    is not applied); ``deleted_edges`` is then 0 because nothing was measured,
    not because nothing had expired.
    """

    table_present: bool
    deleted_edges: int
    cutoff: datetime


async def journey_edge_table_present(db: AsyncSession) -> bool:
    """True when ``project.journey_edge_observations`` exists in this database."""
    result = await db.execute(_TABLE_PRESENT_SQL, {"table": TABLE})
    return bool(result.scalar_one())


async def delete_journey_edges_older_than_retention(
    db: AsyncSession, *, now: datetime | None = None
) -> JourneyEdgeDeletion:
    """Delete expired journey edge observations in committed chunks.

    Invalidated rows are deleted by the same age rule as live ones: the
    invalidation columns withdraw a row from reads, they do not extend its
    life.
    """
    started = time.monotonic()
    retention_days = settings.JOURNEY_EDGE_RETENTION_DAYS
    cutoff = (now or datetime.now(UTC)) - timedelta(days=retention_days)

    if not await journey_edge_table_present(db):
        logger.warning(
            "journey_edge_observations absent — migration not applied",
            table=TABLE,
            retention_days=retention_days,
        )
        return JourneyEdgeDeletion(table_present=False, deleted_edges=0, cutoff=cutoff)

    deleted = 0
    while True:
        result = await db.execute(
            _DELETE_CHUNK_SQL, {"cutoff": cutoff, "chunk": RETENTION_CHUNK_ROWS}
        )
        chunk_deleted = int(result.rowcount)  # type: ignore[attr-defined]
        if chunk_deleted == 0:
            break
        await db.commit()
        deleted += chunk_deleted
        if chunk_deleted < RETENTION_CHUNK_ROWS:
            break

    logger.info(
        "Cleaned up old journey edge observations",
        deleted_edges=deleted,
        duration_seconds=round(time.monotonic() - started, 3),
        cutoff=cutoff.isoformat(),
        retention_days=retention_days,
    )
    return JourneyEdgeDeletion(table_present=True, deleted_edges=deleted, cutoff=cutoff)


async def run_journey_edge_retention(db: AsyncSession) -> dict[str, Any]:
    """Scheduler core: one retention pass (it commits per chunk)."""
    outcome = await delete_journey_edges_older_than_retention(db)
    return {
        "table_present": outcome.table_present,
        "deleted_edges": outcome.deleted_edges,
        "cutoff": outcome.cutoff.isoformat(),
    }
