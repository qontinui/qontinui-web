"""twin 01 coord.migration_observations — Φ_Schema observation oplog

Revision ID: twin_01_coord_migration_observations
Revises: coord_singleauthored_10_merge_heads
Create Date: 2026-05-30

Phase 2a of the digital-twin migrations + infra-layers plan
(``D:/qontinui-root/plans/2026-05-30-digital-twin-migrations-and-infra-layers.md``).

Creates ``coord.migration_observations`` — an **append-only oplog** of the
Φ_Schema (migration sub-space) evaluations. Each row is one observation of the
declared-vs-actual schema state: the stamped ``public.alembic_version`` head,
the computed migration-DAG head from the FS/Git view, the head count + a
single-head flag, the set of missing schema objects, and a classified drift
state. The D6 ``coverage`` / ``credibility`` columns carry the observation-space
confidence pair (both in ``[0,1]``).

Design notes (mirrors ``row_9_phase_4_01_coord_alerts`` conventions):

* ``drift_class`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.alerts.severity`` / ``coord.machines.state``: text+CHECK evolves
  without ``ALTER TYPE`` acrobatics. Keep the allowed set in sync with the
  coord-side classifier being built against this same contract.
* No unique constraint — this is intentionally a history oplog; the same
  ``(applied_head, chain_head, ...)`` tuple recurs every observation tick.
* The lone index is on ``observed_at DESC``: the hot lookup is "the latest
  observation" (``ORDER BY observed_at DESC LIMIT 1``).
* ``missing_objects`` is a JSONB array of ``{schema,table,column,reason}``
  records — the structured context the drift evaluator and dashboard render.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "twin_01_coord_migration_observations"
down_revision: str = "coord_singleauthored_10_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — keep in sync with the coord-side Φ_Schema
# classifier (built against this same contract).
_DRIFT_CLASSES = ("ok", "pending", "multi_head", "missing_object", "unknown")


def upgrade() -> None:
    op.create_table(
        "migration_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # The stamped revision in ``public.alembic_version``.
        sa.Column("applied_head", sa.Text(), nullable=True),
        # The computed migration-DAG head from the FS/Git view.
        sa.Column("chain_head", sa.Text(), nullable=True),
        sa.Column(
            "head_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "single_head",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # Array of ``{schema,table,column,reason}`` missing-object records.
        sa.Column(
            "missing_objects",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("drift_class", sa.Text(), nullable=False),
        # D6 coverage in [0,1].
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
        # Observer identity, e.g. ``'live_rds_catalog'``.
        sa.Column("provenance", sa.Text(), nullable=False),
        # D6 credibility in [0,1].
        sa.Column(
            "credibility",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        sa.CheckConstraint(
            "drift_class IN ('ok','pending','multi_head','missing_object','unknown')",
            name="migration_observations_drift_class_chk",
        ),
        schema="coord",
    )

    # Hot lookup: the latest observation (``ORDER BY observed_at DESC LIMIT 1``).
    op.create_index(
        "idx_migration_observations_observed_at",
        "migration_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_migration_observations_observed_at",
        table_name="migration_observations",
        schema="coord",
    )
    op.drop_table("migration_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in row_9_phase_4_01_coord_alerts.
_ = _DRIFT_CLASSES
