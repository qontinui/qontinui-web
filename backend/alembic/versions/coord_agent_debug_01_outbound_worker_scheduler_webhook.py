"""coord agent-debug 01 — outbound budget / worker heartbeat / scheduler tick / webhook pulse

Revision ID: coord_agent_debug_01_outbound_worker_scheduler_webhook
Revises: devenv_05_canonical_change_log
Create Date: 2026-07-14

Lays down the four fleet-global coord observation tables that unblock the
A1/A2/C2/C3 phases of the coord agent-debug plan. coord is the sole CONSUMER of
these tables; alembic in qontinui-web is the sole AUTHOR of ``coord.*`` DDL, so
these tables must exist in RDS *before* any coord read-side code can merge —
authoring the migration first is the correct, safe order.

All four are **fleet-global**: they observe coord's OWN infrastructure (its
outbound dependencies, worker loops, per-repo merge-scheduler ticks, and inbound
webhook deliveries), not per-tenant state — so, like the sibling
``twin_*_coord_*_observations`` tables (``dependency_observations``,
``error_observations``, ``health_observations``, …), they carry NO ``tenant_id``.
The scheduler/webhook rows key on ``repo`` (already the natural fleet dimension).

Conventions match the sibling twin-observation migrations exactly:
``op.create_table`` + ``sa.Column``, ``schema="coord"``, ``sa.text("now()")``
server-defaults, ``sa.DateTime(timezone=True)`` for timestamptz,
``postgresql.JSONB()`` for jsonb, ``text + CHECK`` (never a PG enum) for closed
classification sets, and ``idx_<table>_<cols>`` index naming.

--------------------------------------------------------------------------------
Table 1 — ``coord.outbound_budget_observations`` (A1)
--------------------------------------------------------------------------------
Outbound-dependency budget/health twin. **Single-row upsert, one row per
``(dependency, resource)``** — NOT append-only (the plan's resolved
write-amplification decision): the observer UPSERTs the latest budget/health
snapshot for each dependency/resource pair. UNIQUE ``(dependency, resource)``
is the ON-CONFLICT target.

--------------------------------------------------------------------------------
Table 2 — ``coord.worker_heartbeats`` (A2)
--------------------------------------------------------------------------------
Worker-loop liveness ledger. **One row per ``(name, replica_id)``** — each
worker loop UPSERTs its liveness on every tick. ``last_decision_code`` links the
scheduler loop's heartbeat to its C2 decision trace.

--------------------------------------------------------------------------------
Table 3 — ``coord.scheduler_ticks`` (C2)
--------------------------------------------------------------------------------
Per-tick-per-repo merge-scheduler decision trace. **Append-per-tick**, ring
retention ~48h — ``tick_at`` is indexed on its own for retention pruning, and
``(repo, tick_at DESC)`` for the "recent ticks for this repo" read.

--------------------------------------------------------------------------------
Table 4 — ``coord.webhook_pulse`` (C3)
--------------------------------------------------------------------------------
Per-``(repo, event_type)`` inbound-delivery ledger. **Throttled upsert** — one
row per pair, ``received_count`` bumped and ``last_received_at`` refreshed on
delivery. UNIQUE ``(repo, event_type)`` is the ON-CONFLICT target.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_debug_01_outbound_worker_scheduler_webhook"
down_revision: str | Sequence[str] | None = "devenv_05_canonical_change_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Outbound budget drift classifications — text+CHECK (never a PG enum), same
# rationale as the sibling ``*_observations.drift_class`` columns: evolves
# without ``ALTER TYPE`` acrobatics. Keep in sync with the coord-side A1
# outbound-budget classifier (built against this same contract).
_DRIFT_CLASSES = (
    "nominal",
    "burning",
    "cooling_down",
    "exhausted",
    "unknown",
)


def upgrade() -> None:
    # coord schema is created by earlier coord migrations; guard anyway so this
    # file is self-contained.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ------------------------------------------------------------------
    # Table 1 — coord.outbound_budget_observations (A1)
    # Single-row upsert, one row per (dependency, resource).
    # ------------------------------------------------------------------
    op.create_table(
        "outbound_budget_observations",
        # e.g. 'github','vercel','aws','nats','npm','sentry'.
        sa.Column("dependency", sa.Text(), nullable=False),
        # e.g. 'core:install-123','api','cloudwatch:GetMetricData',
        # 'consumer:merge-landed'.
        sa.Column("resource", sa.Text(), nullable=False),
        # Remaining / total budget for this dependency+resource. 'limit' is a
        # reserved word → 'limit_total'.
        sa.Column("remaining", sa.BigInteger(), nullable=True),
        sa.Column("limit_total", sa.BigInteger(), nullable=True),
        # When the budget window resets.
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("burn_rate_per_min", sa.Float(precision=53), nullable=True),
        # Set while the dependency is in a rate-limit cool-down.
        sa.Column("cooldown_until", sa.DateTime(timezone=True), nullable=True),
        # Bounded top-N URL-template / operation histogram.
        sa.Column("top_consumers", postgresql.JSONB(), nullable=True),
        # Module / worker histogram (who is burning this budget).
        sa.Column("caller_breakdown", postgresql.JSONB(), nullable=True),
        # 'nominal'|'burning'|'cooling_down'|'exhausted'|'unknown'.
        sa.Column("drift_class", sa.Text(), nullable=True),
        # e.g. 'stale_service_risk'.
        sa.Column("drift_subclass", sa.Text(), nullable=True),
        # Count of stale cached reads served during the observation window.
        sa.Column("serving_stale_reads", sa.Integer(), nullable=True),
        sa.Column("replica_id", sa.Text(), nullable=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "drift_class IS NULL OR drift_class IN "
            "('nominal','burning','cooling_down','exhausted','unknown')",
            name="outbound_budget_observations_drift_class_chk",
        ),
        sa.UniqueConstraint(
            "dependency",
            "resource",
            name="outbound_budget_observations_dependency_resource_uq",
        ),
        schema="coord",
    )

    # ------------------------------------------------------------------
    # Table 2 — coord.worker_heartbeats (A2)
    # One row per (name, replica_id).
    # ------------------------------------------------------------------
    op.create_table(
        "worker_heartbeats",
        # Worker-loop name, e.g. 'merge_scheduler','mirror_reconciler',
        # 'landed_subscriber'.
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("replica_id", sa.Text(), nullable=False),
        sa.Column(
            "leader_gated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("interval_secs", sa.Integer(), nullable=True),
        sa.Column("last_tick_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_outcome", sa.Text(), nullable=True),
        sa.Column(
            "consecutive_errors",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        # The scheduler row carries its decision code — links to C2
        # (coord.scheduler_ticks.decision_code).
        sa.Column("last_decision_code", sa.Text(), nullable=True),
        sa.Column("last_detail_code", sa.Text(), nullable=True),
        sa.UniqueConstraint(
            "name",
            "replica_id",
            name="worker_heartbeats_name_replica_id_uq",
        ),
        schema="coord",
    )

    # ------------------------------------------------------------------
    # Table 3 — coord.scheduler_ticks (C2)
    # Append-per-tick, ring retention ~48h.
    # ------------------------------------------------------------------
    op.create_table(
        "scheduler_ticks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column(
            "tick_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("main_sha", sa.Text(), nullable=True),
        sa.Column("queue_depth", sa.Integer(), nullable=True),
        sa.Column("lease_state", sa.Text(), nullable=True),
        sa.Column("no_reap_verdict", sa.Text(), nullable=True),
        sa.Column("budget_state", sa.Text(), nullable=True),
        # 'landed'|'no_ready_prs'|'waiting_ci'|'lease_held'|'budget_backoff'|
        # 'tick_error:<class>'. Open-ended (the tick_error suffix varies) → no
        # CHECK, same posture as the open error-surface sets.
        sa.Column("decision_code", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        schema="coord",
    )

    # Recent ticks for this repo, newest-first.
    op.create_index(
        "idx_scheduler_ticks_repo_tick_at",
        "scheduler_ticks",
        ["repo", sa.text("tick_at DESC")],
        schema="coord",
    )
    # Retention pruning scans tick_at directly (ring retention ~48h).
    op.create_index(
        "idx_scheduler_ticks_tick_at",
        "scheduler_ticks",
        ["tick_at"],
        schema="coord",
    )

    # ------------------------------------------------------------------
    # Table 4 — coord.webhook_pulse (C3)
    # Throttled upsert, one row per (repo, event_type).
    # ------------------------------------------------------------------
    op.create_table(
        "webhook_pulse",
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column(
            "received_count",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("last_received_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "repo",
            "event_type",
            name="webhook_pulse_repo_event_type_uq",
        ),
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_table("webhook_pulse", schema="coord")

    op.drop_index(
        "idx_scheduler_ticks_tick_at",
        table_name="scheduler_ticks",
        schema="coord",
    )
    op.drop_index(
        "idx_scheduler_ticks_repo_tick_at",
        table_name="scheduler_ticks",
        schema="coord",
    )
    op.drop_table("scheduler_ticks", schema="coord")

    op.drop_table("worker_heartbeats", schema="coord")

    op.drop_table("outbound_budget_observations", schema="coord")


# Touch the unused-symbol constant so linters don't complain — mirrors the
# pattern in the sibling twin-observation migrations.
_ = _DRIFT_CLASSES
