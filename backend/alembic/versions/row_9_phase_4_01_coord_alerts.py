"""row 9 phase 4 01 coord.alerts fleet-health alert sink

Revision ID: row_9_phase_4_01_coord_alerts
Revises: wave_3_merge_phase_3_and_row_9_phase_3
Create Date: 2026-05-15

Row 9 Phase 4 of the failure-modes-at-scale design
(``D:/qontinui-root/plans/2026-05-14-failure-modes-at-scale-design.md``
§3.6 "Observability"). Phase 3 shipped the per-machine liveness state
machine on ``coord.machines``; this phase aggregates those signals
fleet-wide and records threshold breaches in ``coord.alerts`` for
dashboard display + structured-tracing emission.

Per §3.6 the *page-out* integration (PagerDuty / Slack webhook) is a
Wave 5+ refinement — this phase ships the **signal**: the alert is
written here with a severity tag and (for the partitioned→page-on-call
rule) the timestamp at which a page would be due, so a later phase can
wire the actual delivery without re-deriving the thresholds.

Schema choices (mirrors the conventions established by
``row_9_phase_3_01_machines_state``):

* ``severity`` is TEXT + CHECK rather than a PG enum — same rationale
  as ``coord.machines.state``: text+CHECK evolves without ``ALTER
  TYPE`` acrobatics.
* ``alert_key`` is the dedupe identity. The coord-side evaluator
  upserts: a still-firing condition bumps ``last_seen_at`` +
  ``occurrences`` on the existing active row rather than spamming new
  rows every 30s watcher tick. A partial unique index on
  ``alert_key WHERE resolved_at IS NULL`` enforces "at most one active
  alert per key" and is the ON CONFLICT target.
* ``machine_id`` is a plain indexed UUID, **not** a FK to
  ``coord.machines``. Alerts are an observability sink and must
  outlive the machine row (a machine that's deleted while partitioned
  should still leave an audit trail). Fleet-wide alerts (the
  >10%-partitioned and token-revocation-spike rules) carry NULL here.
* ``page_due_at`` materialises §3.6's "page on-call after 15 min
  sustained" for the single-machine ``partitioned`` rule. NULL for
  severities that page immediately or never. The signal-only contract:
  Wave 5's delivery worker reads ``WHERE page_due_at <= now() AND
  resolved_at IS NULL AND paged_at IS NULL``.
* ``detail`` JSONB carries the structured context the dashboard renders
  (observed ratio, threshold, contributing machine_ids, counts).

Index: a partial index on active rows (``resolved_at IS NULL``) keyed
by severity — the dashboard's hot query is "show me everything
currently firing, criticals first".
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "row_9_phase_4_01_coord_alerts"
down_revision: str = "wave_3_merge_phase_3_and_row_9_phase_3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed severities — keep in sync with the coord-side ``AlertSeverity``
# enum (``qontinui-coord/src/fleet_health.rs``) and the ensure_* mirror
# DDL in the same module.
_SEVERITIES = ("info", "warning", "critical")


def upgrade() -> None:
    op.create_table(
        "alerts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("alert_key", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("machine_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column(
            "detail",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "occurrences",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("page_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paged_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "severity IN ('info','warning','critical')",
            name="alerts_severity_chk",
        ),
        schema="coord",
    )

    # At most one *active* alert per key. This is the ON CONFLICT
    # target for the coord-side upsert — a still-firing condition
    # updates the active row instead of inserting a duplicate.
    op.create_index(
        "uq_alerts_active_key",
        "alerts",
        ["alert_key"],
        unique=True,
        schema="coord",
        postgresql_where=sa.text("resolved_at IS NULL"),
    )

    # Dashboard hot query: active alerts, criticals first.
    op.create_index(
        "idx_alerts_active_severity",
        "alerts",
        ["severity", "last_seen_at"],
        schema="coord",
        postgresql_where=sa.text("resolved_at IS NULL"),
    )

    # Per-machine drill-down + cascade-resolve when a machine recovers.
    op.create_index(
        "idx_alerts_machine",
        "alerts",
        ["machine_id"],
        schema="coord",
        postgresql_where=sa.text("machine_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_alerts_machine", table_name="alerts", schema="coord")
    op.drop_index(
        "idx_alerts_active_severity", table_name="alerts", schema="coord"
    )
    op.drop_index("uq_alerts_active_key", table_name="alerts", schema="coord")
    op.drop_table("alerts", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors
# the pattern in row_9_phase_3_01_machines_state.
_ = _SEVERITIES
