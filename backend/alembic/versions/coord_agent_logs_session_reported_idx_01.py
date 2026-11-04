"""coord.agent_logs — partial covering index on session_reported rows

Revision ID: coord_agent_logs_session_reported_idx_01
Revises: ci_job_res_02
Create Date: 2026-11-04

Adds ``idx_agent_logs_session_reported`` to ``coord.agent_logs``:

    (agent_id, occurred_at, log_id) INCLUDE (agent_session_id)
    WHERE event = 'session_reported' AND agent_session_id IS NOT NULL

Why
---
coord's ``main.agent_worktrees_sweeper`` runs ``BIND_REPORTED_SESSIONS_SQL``
(``qontinui-coord/crates/coord/src/agent_worktrees.rs``) every tick. For each
unbound live allocation it reads the EARLIEST ``session_reported`` row with a
session, ordered ``occurred_at ASC, log_id ASC``, ``LIMIT 1``.
qontinui-coord#3665 (landed as ``aafe24d3b``) moved that read into a
per-allocation ``LATERAL`` served by ``idx_agent_logs_agent (agent_id,
occurred_at DESC)``, which stopped the whole-table scan that pushed the tick
past the pool's 60 s ``statement_timeout``.

That index carries neither ``event`` nor ``log_id``, so each probe still
heap-reads EVERY log row of its allocation. ``coord.agent_logs`` has no
retention, so that cost grows with each allocation's history. This index
matches the probe exactly: the partial predicate is the probe's filter, the
key is its ``WHERE agent_id = ...`` plus its ``ORDER BY``, and the INCLUDE
column is what it returns. The probe becomes an index-only scan that stops at
the first entry.

Review measurement (coord finding ``7fe89149-90e7-436f-ba0c-09e4bccf569d``;
throwaway PostgreSQL 18.6, synthetic data, 5.26M log rows): the statement fell
from 38.7k buffers to 3.1k (Index Only Scan, Heap Fetches 0, 11.9 ms), and the
index was 976 kB for 12.8k reports. The index also removes a plan trap the
review found: if the ``agent_id`` n_distinct estimate collapses, the lateral
can flip to ``idx_agent_logs_recent`` plus an Incremental Sort that walks the
table.

Deploy order is FREE. coord needs no change; the planner picks the index up
when it exists, and the statement is correct (only slower) without it.

Locking — ``coord.agent_logs`` takes every agent event
------------------------------------------------------
The build uses ``CREATE INDEX CONCURRENTLY`` inside ``autocommit_block()``,
following ``pr_fixer_spawn_01``: its SHARE UPDATE EXCLUSIVE lock does not
block the event inserts. The SQL is a plain literal, never an f-string,
because ``check_alembic_schema_args.py`` audits only constant SQL.

Idempotency: ``IF NOT EXISTS``. That is not a full guard for a CONCURRENTLY
build: a killed build leaves an INVALID index under the name, and a re-run
would skip it and report success. ``_require_valid()`` checks
``pg_index.indisvalid`` after the build and raises instead. Drop the invalid
index and re-run.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_logs_session_reported_idx_01"
# `ci_job_res_02` is the single head on origin/main 5b2803fb5.
down_revision: str | Sequence[str] | None = "ci_job_res_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _require_valid(index_name: str) -> None:
    """Raise if a CONCURRENTLY build left ``coord.<index_name>`` INVALID.

    ``IF NOT EXISTS`` skips an invalid index left by a killed build and reports
    success; this turns that false success into a loud failure.
    """
    valid = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'coord' AND c.relname = :name"
            ),
            {"name": index_name},
        )
        .scalar()
    )
    if valid is not True:
        raise RuntimeError(
            f"coord.{index_name} is missing or INVALID after CREATE INDEX "
            "CONCURRENTLY; drop it and re-run the migration"
        )


def upgrade() -> None:
    """Build the partial covering index for the session-report probe."""

    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_logs_session_reported
                ON coord.agent_logs (agent_id, occurred_at, log_id)
                INCLUDE (agent_session_id)
                WHERE event = 'session_reported'
                  AND agent_session_id IS NOT NULL
            """
        )
        _require_valid("idx_agent_logs_session_reported")


def downgrade() -> None:
    """Drop the index."""

    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_logs_session_reported"
        )
