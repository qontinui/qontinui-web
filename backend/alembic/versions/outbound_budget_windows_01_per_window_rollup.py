"""coord.outbound_budget_windows — a per-window history of coord's outbound budget

Revision ID: outbound_budget_windows_01
Revises: topcons_01
Create Date: 2026-11-06

Phase 3, row 1.5 of plan
``2026-10-31-merge-train-checkpoint-3-misses-with-no-owning-plan``.

## Why a second table

``coord.outbound_budget_observations``
(``coord_agent_debug_01_outbound_worker_scheduler_webhook``) keeps ONE row per
``(dependency, resource)``, upserted by coord's leader-gated 30 s
``outbound_budget_observer``. It only ever knows the latest reading, so the
merge-train success metric "GitHub App budget never dry" (M6: ``remaining`` > 0
at every sample) has read UNKNOWN at every checkpoint: nothing can answer "did
``remaining`` reach 0 in the last N hours".

This table is the bounded history that answers it. It is a ROLLUP, not an
append-only sample log: ONE row per ``(dependency, resource, reset_at)``, i.e.
per rate-limit window of each bucket. Every observer reading for that window
folds into the row:

* ``min_remaining`` = ``LEAST`` of every reading — the figure the "dry"
  question needs;
* ``last_remaining`` = the reading with the latest ``last_observed_at``;
* ``sample_count`` = how many readings were folded in;
* ``first_observed_at`` / ``last_observed_at`` = the span the readings cover.

A GitHub ``core`` window is one hour, so a bucket adds about 24 rows a day,
against about 2 880 for a per-tick sample log. The snapshot table is left
exactly as it is.

## Columns

* ``id`` is a surrogate identity primary key. It gives the table a replica
  identity (the logical-replication guard,
  ``tests/test_replica_identity_published_schemas.py``) and the single-column key
  coord's batched retention prune deletes by.
* ``(dependency, resource, reset_at)`` is UNIQUE
  (``outbound_budget_windows_dependency_resource_reset_uq``) and is the
  observer's ``ON CONFLICT`` target. ``resource`` is the same key coord's
  observer writes to ``coord.outbound_budget_observations.resource``
  (``<resource>:<installation_id>``, built in
  ``outbound_budget_observer::derive_budget_row``, e.g. ``core:134903706``), so
  a tenant-scoped reader filters both tables by the same parse.
* ``reset_at`` is NOT NULL: a reading with no known window is not written here
  (its window cannot be named).
* ``min_remaining`` / ``last_remaining`` are NOT NULL: a reading with no
  ``remaining`` is not written either. A missing reading is UNKNOWN, and
  storing it as a row would let a reader take it for a sample.
* ``limit_total`` is nullable (GitHub omits it on some responses).
* No ``tenant_id``: like the snapshot table, the budget twin is fleet-global and
  readers scope it by the installation id in ``resource``.

## Retention

The paired qontinui-coord change (not merged when this revision was
authored) registers a ``table_retention.rs`` sweep on ``last_observed_at``,
default 90 days, so ``last_observed_at`` is indexed alone for it. The same
index serves the read door's "observed since T" scan. Until that change
deploys nothing writes the table, so nothing needs sweeping.

## Two-repo ordering: this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``). The paired coord
change is built to be table-tolerant: its writer checks
``to_regclass('coord.outbound_budget_windows')`` and skips the history write,
with one warning, while the table is absent, and its read door
(``coord_query_outbound_budget`` ``history_hours``) reports
``reached_zero: null`` (UNKNOWN) with the reason, never a "never dry"
verdict.

## Safety

Additive: one ``CREATE TABLE IF NOT EXISTS`` on a new name, one index on it,
and ``COMMENT ON``. No existing table is touched, so there is no lock on a hot
table and nothing to backfill. ``downgrade`` drops only what ``upgrade``
created.

## Head choice

``down_revision`` is the repo's single alembic head on ``origin/main`` at
authoring time (``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=topcons_01``, 2026-11-06).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "outbound_budget_windows_01"
down_revision: str | Sequence[str] | None = "topcons_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the rollup table, its retention index, and document it. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.outbound_budget_windows (
            id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            dependency         TEXT NOT NULL,
            resource           TEXT NOT NULL,
            reset_at           TIMESTAMPTZ NOT NULL,
            limit_total        BIGINT NULL,
            min_remaining      BIGINT NOT NULL,
            last_remaining     BIGINT NOT NULL,
            sample_count       INTEGER NOT NULL DEFAULT 1,
            first_observed_at  TIMESTAMPTZ NOT NULL,
            last_observed_at   TIMESTAMPTZ NOT NULL,
            CONSTRAINT outbound_budget_windows_dependency_resource_reset_uq
                UNIQUE (dependency, resource, reset_at),
            CONSTRAINT ck_outbound_budget_windows_remaining_nonneg
                CHECK (min_remaining >= 0 AND last_remaining >= 0),
            CONSTRAINT ck_outbound_budget_windows_min_le_last
                CHECK (min_remaining <= last_remaining),
            CONSTRAINT ck_outbound_budget_windows_sample_count_pos
                CHECK (sample_count >= 1),
            CONSTRAINT ck_outbound_budget_windows_span_ordered
                CHECK (first_observed_at <= last_observed_at)
        )
        """
    )
    # The retention sweep and the read door's "observed since T" scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_outbound_budget_windows_last_observed
            ON coord.outbound_budget_windows (last_observed_at)
        """
    )

    # Document the table. Each statement is a complete static literal.
    op.execute(
        """
        COMMENT ON TABLE coord.outbound_budget_windows IS
            'Per-window rollup of coord''s outbound budget readings: one row per (dependency, resource, reset_at), written by coord''s outbound_budget_observer, which folds each reading of a window into its row. coord.outbound_budget_observations keeps only the latest reading per bucket; this is the history that answers whether remaining reached 0 in a window. Plan 2026-10-31-merge-train-checkpoint-3-misses-with-no-owning-plan.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.outbound_budget_windows.min_remaining IS
            'LEAST of every remaining reading folded into this window. 0 = the budget ran dry in this window. Replica registries can lag after a leader handover; a lagging (higher) reading cannot raise the minimum, so the lag is harmless for the dry question.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.outbound_budget_windows.last_remaining IS
            'The remaining reading with the latest last_observed_at. Not monotonic: after a leader handover it can come from a registry that lags the previous leader''s.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.outbound_budget_windows.sample_count IS
            'Observer readings folded into this row. A gap between two windows'' observed spans is a period with no readings: UNKNOWN, never not-dry.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.outbound_budget_windows.resource IS
            'Bucket key, the same string coord writes to coord.outbound_budget_observations.resource: <resource>:<installation_id>, e.g. core:134903706.'
        """
    )


def downgrade() -> None:
    """Drop the table; its index and constraints go with it."""
    op.execute("DROP TABLE IF EXISTS coord.outbound_budget_windows")
