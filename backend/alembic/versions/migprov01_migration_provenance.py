"""migprov 01 coord migration-provenance — revisions + applications + drift events

Revision ID: migprov01_migration_provenance
Revises: coord_wip_attribution
Create Date: 2026-06-15

Phase 3 of the coord-first-party migration / drift / provenance plan
(``D:/qontinui-root/plans/2026-06-15-coord-first-party-migration-drift-and-provenance.md``).

Creates three ``coord.*`` tables forming the first-party migration provenance
substrate. The migrate workflow self-reports into these (DAG snapshot + apply
events); the coord-side Φ_Schema classifier writes drift transitions/gate-evals:

* ``coord.migration_revisions`` — one upserted row per alembic revision: the
  full authored DAG (``down_revisions`` is an array so merge points are first
  class), the structured ``objects_touched``, reversibility, and the snapshot
  ``source_sha`` that last upserted it.
* ``coord.migration_applications`` — append-only time-series of applies, one
  row per ``alembic upgrade head`` against a named database.
* ``coord.schema_drift_events`` — drift transitions + gate evaluations, the
  history the dashboard renders.

Design notes (mirror ``twin_01_coord_migration_observations`` conventions):

* All classification columns are TEXT + CHECK rather than PG enums — same
  rationale as ``coord.alerts.severity`` / ``coord.machines.state``: text+CHECK
  evolves without ``ALTER TYPE`` acrobatics. Keep the allowed sets in sync with
  the coord-side classifier + ingest handlers being built against this same
  contract.
* Schema ``coord`` is assumed to already exist (every twin migration relies on
  this) — this migration does NOT create or drop it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "migprov01_migration_provenance"
down_revision: str = "coord_wip_attribution"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed drift classifications — keep in sync with the coord-side Φ_Schema
# classifier (built against this same contract) and twin_01's
# ``migration_observations.drift_class``.
_DRIFT_CLASSES = ("ok", "pending", "multi_head", "missing_object", "unknown")
# Allowed databases for an apply event.
_APPLICATION_DATABASES = ("prod-rds", "canonical-pg", "test")
# Allowed drift-event kinds.
_DRIFT_EVENT_KINDS = ("transition", "gate_eval")


def upgrade() -> None:
    # ── coord.migration_revisions — one upserted row per alembic revision ──
    op.create_table(
        "migration_revisions",
        sa.Column("revision", sa.Text(), primary_key=True),
        # Parents — array so merge points (multiple down_revisions) are first
        # class. Empty array == base revision.
        sa.Column(
            "down_revisions",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column("authored_in_sha", sa.Text(), nullable=True),
        sa.Column("authored_at", sa.DateTime(timezone=True), nullable=True),
        # Array of ``{op,object_type,name}`` records.
        sa.Column(
            "objects_touched",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("reversible", sa.Boolean(), nullable=True),
        sa.Column(
            "is_merge_point",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "repo",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'qontinui/qontinui-web'"),
        ),
        # main sha of the snapshot that last upserted this row.
        sa.Column("source_sha", sa.Text(), nullable=True),
        sa.Column(
            "first_observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    op.create_index(
        "idx_migration_revisions_repo",
        "migration_revisions",
        ["repo"],
        schema="coord",
    )

    # ── coord.migration_applications — append-only time-series of applies ──
    op.create_table(
        "migration_applications",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("revision", sa.Text(), nullable=False),
        sa.Column("database", sa.Text(), nullable=False),
        sa.Column(
            "applied_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("applied_by", sa.Text(), nullable=True),
        sa.Column("source_sha", sa.Text(), nullable=True),
        sa.Column(
            "repo",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'qontinui/qontinui-web'"),
        ),
        sa.CheckConstraint(
            "database IN ('prod-rds','canonical-pg','test')",
            name="migration_applications_database_chk",
        ),
        schema="coord",
    )
    # Hot lookup: latest apply per database (``WHERE database=? ORDER BY
    # applied_at DESC LIMIT 1``).
    op.create_index(
        "idx_migration_applications_db_applied_at",
        "migration_applications",
        ["database", sa.text("applied_at DESC")],
        schema="coord",
    )
    op.create_index(
        "idx_migration_applications_revision",
        "migration_applications",
        ["revision"],
        schema="coord",
    )

    # ── coord.schema_drift_events — drift transitions + gate evals ─────────
    op.create_table(
        "schema_drift_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "event_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("event_kind", sa.Text(), nullable=False),
        sa.Column("drift_class", sa.Text(), nullable=False),
        sa.Column("prev_drift_class", sa.Text(), nullable=True),
        sa.Column("applied_head", sa.Text(), nullable=True),
        sa.Column("declared_head", sa.Text(), nullable=True),
        sa.Column(
            "head_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "dangling_down_revisions",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("blocked_deploy_run", sa.Text(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "event_kind IN ('transition','gate_eval')",
            name="schema_drift_events_event_kind_chk",
        ),
        sa.CheckConstraint(
            "drift_class IN ('ok','pending','multi_head','missing_object','unknown')",
            name="schema_drift_events_drift_class_chk",
        ),
        sa.CheckConstraint(
            "prev_drift_class IS NULL OR prev_drift_class IN "
            "('ok','pending','multi_head','missing_object','unknown')",
            name="schema_drift_events_prev_drift_class_chk",
        ),
        schema="coord",
    )
    # Hot lookup: the latest drift events (``ORDER BY event_at DESC``).
    op.create_index(
        "idx_schema_drift_events_event_at",
        "schema_drift_events",
        [sa.text("event_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_schema_drift_events_event_at",
        table_name="schema_drift_events",
        schema="coord",
    )
    op.drop_table("schema_drift_events", schema="coord")

    op.drop_index(
        "idx_migration_applications_revision",
        table_name="migration_applications",
        schema="coord",
    )
    op.drop_index(
        "idx_migration_applications_db_applied_at",
        table_name="migration_applications",
        schema="coord",
    )
    op.drop_table("migration_applications", schema="coord")

    op.drop_index(
        "idx_migration_revisions_repo",
        table_name="migration_revisions",
        schema="coord",
    )
    op.drop_table("migration_revisions", schema="coord")


# Touch the unused-symbol constants so linters don't complain — mirrors the
# pattern in twin_01_coord_migration_observations / row_9_phase_4_01_coord_alerts.
_ = (_DRIFT_CLASSES, _APPLICATION_DATABASES, _DRIFT_EVENT_KINDS)
