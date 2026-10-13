"""coord.twin_fidelity_observations — the twin's self-fidelity report, persisted

Revision ID: twin_fidelity_01_coord_twin_fidelity_observations
Revises: coord_proclog_01
Create Date: 2026-10-12

Phase 4a of plan ``2026-10-11-twin-honesty-and-reachability``.

The gap
=======

coord's twin-fidelity watcher (``twin_fidelity_watcher.rs``) computes a
``TwinFidelityReport`` every interval — how many twin sub-spaces are observed,
how many are blind, and how many assert a verdict their evidence does not
support — but keeps it only in a process-local cell. The report reaches the
outside only as ``/metrics`` gauges, so there is no history, no trend, and the
agent tool that should serve it (``coord_query_twin_fidelity``) recomputes
every sub-space live and times out at coord's 30 s per-tool cap. This table is
where the watcher persists each report (Phase 4b), and what the tool and the
gauges read back.

Shape
=====

One row per computed report. Rows are append-only. Phase 4b registers the
table in coord's ``table_retention`` registry (90-day default, newest row
kept); until then nothing writes it.

``computed_at TIMESTAMPTZ NOT NULL``
    When the report was computed. Indexed DESC for the newest-row read and
    the windowed trend read.

``replica_id TEXT NOT NULL``
    The coord replica that computed it (the leader, once Phase 4b moves the
    tick to leader-only).

``bound_secs INTEGER NOT NULL``
    The staleness bound the report judged against. CHECK ``> 0``.

``total`` / ``observed_count`` / ``blind_count`` / ``honesty_violations`` /
``stale_evidence_violations INTEGER NOT NULL``
    The report's aggregate counts. CHECK ``>= 0`` each, and
    ``observed_count + blind_count <= total``.

``stale_at_decision_violations INTEGER NULL``
    NULL when no decision surface was sampled in that cycle — an unsampled
    count is UNKNOWN, never 0. CHECK ``>= 0`` when present.

``observability_rate DOUBLE PRECISION NULL``
    ``observed_count / total``; NULL exactly when ``total`` is 0. CHECK in
    [0, 1], and ``(total = 0) = (observability_rate IS NULL)``.

``subspaces JSONB NOT NULL``
    The per-sub-space rows (observed, coverage, staleness, class, honesty,
    ``elapsed_ms``, ``timed_out``, reason). Generic on purpose, so a new
    sub-space (e.g. the process-twin plan's) adds entries without DDL.
    CHECK it is a JSON array.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "twin_fidelity_01_coord_twin_fidelity_observations"
# KEEP THIS ASSIGNMENT ON ONE LINE: coord's alembic-graph parser is
# line-scoped, so a formatter-wrapped down_revision reads as a second head.
down_revision: str = "coord_proclog_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.twin_fidelity_observations`` + its recency index. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.twin_fidelity_observations (
            id                            BIGSERIAL PRIMARY KEY,
            computed_at                   TIMESTAMPTZ NOT NULL,
            replica_id                    TEXT NOT NULL,
            bound_secs                    INTEGER NOT NULL,
            total                         INTEGER NOT NULL,
            observed_count                INTEGER NOT NULL,
            blind_count                   INTEGER NOT NULL,
            honesty_violations            INTEGER NOT NULL,
            stale_evidence_violations     INTEGER NOT NULL,
            stale_at_decision_violations  INTEGER NULL,
            observability_rate            DOUBLE PRECISION NULL,
            subspaces                     JSONB NOT NULL,
            CONSTRAINT ck_twin_fidelity_obs_bound_positive
                CHECK (bound_secs > 0),
            CONSTRAINT ck_twin_fidelity_obs_counts_nonneg
                CHECK (total >= 0
                       AND observed_count >= 0
                       AND blind_count >= 0
                       AND honesty_violations >= 0
                       AND stale_evidence_violations >= 0
                       AND (stale_at_decision_violations IS NULL
                            OR stale_at_decision_violations >= 0)),
            CONSTRAINT ck_twin_fidelity_obs_counts_within_total
                CHECK (observed_count + blind_count <= total),
            CONSTRAINT ck_twin_fidelity_obs_rate_range
                CHECK (observability_rate IS NULL
                       OR (observability_rate >= 0 AND observability_rate <= 1)),
            CONSTRAINT ck_twin_fidelity_obs_rate_iff_total
                CHECK ((total = 0) = (observability_rate IS NULL)),
            CONSTRAINT ck_twin_fidelity_obs_subspaces_array
                CHECK (jsonb_typeof(subspaces) = 'array')
        )
        """
    )
    # The newest-row read (gauges, the tool's default answer) and the
    # windowed trend read both walk this index.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_twin_fidelity_observations_computed_at
            ON coord.twin_fidelity_observations (computed_at DESC)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.twin_fidelity_observations IS
            'One row per twin-fidelity report coord computed: observed/blind '
            'sub-space counts, honesty violations and the per-sub-space rows. '
            'stale_at_decision_violations NULL means no decision surface was '
            'sampled (UNKNOWN), never zero. Append-only.'
        """
    )


def downgrade() -> None:
    """Drop the table + its index. Any recorded reports go with it."""
    op.execute("DROP INDEX IF EXISTS coord.ix_twin_fidelity_observations_computed_at")
    op.execute("DROP TABLE IF EXISTS coord.twin_fidelity_observations")
