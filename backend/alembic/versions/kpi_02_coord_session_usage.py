"""coord.session_usage — per-session, per-model token and cost totals

Revision ID: kpi_02_coord_session_usage
Revises: kpi_01_phase_token_usage_cost_precision
Create Date: 2026-10-09

Phase 1 of plan ``2026-10-09-kpi-telemetry-and-dashboards``.

The gap
=======

``project.phase_token_usage`` records spend for workflow task-run phases only.
An interactive or spawned Claude Code session — most of the fleet's spend —
has no usage record in coord at all, so "what did this session cost", "what
did this PR cost" (via ``coord.commit_lineage``) and "spend per tenant per
day" are unanswerable. This table is the session-scoped usage fact the KPI
dashboards read.

Shape
=====

One row per ``(tenant_id, agent_session_id, model)``. A session that used two
models has two rows. The writer UPSERTs on the primary key, accumulating the
token counters and ``turn_count`` and widening ``first_turn_at`` /
``last_turn_at``; ``updated_at`` is stamped by the writer on every UPSERT.

``tenant_id UUID NOT NULL``
    From the caller's verified credential, never the request body. No FK to
    ``coord.tenants``, matching ``coord.operator_touches`` and
    ``coord.overlord_interventions``: a telemetry write must never fail on
    referential bookkeeping.

``agent_session_id UUID NOT NULL``
    The Claude Code session id — the same identity, and the same type, as
    ``coord.commit_lineage.agent_session_id``, so the per-PR cost join needs
    no cast and no translation. No FK to ``coord.agent_sessions``: usage must
    be recordable for a session coord has not (yet) registered, and must
    outlive the closed-session prune.

``model TEXT NOT NULL``
    The model id as reported (e.g. ``claude-opus-4-1``).

``input_tokens`` / ``output_tokens`` / ``cache_creation_input_tokens`` /
``cache_read_input_tokens BIGINT NOT NULL DEFAULT 0``
    Running totals. The column names follow the Anthropic API usage field
    names so the writer maps them one-to-one. CHECK ``>= 0`` each
    (``ck_session_usage_tokens_nonneg``).

``cost_microusd BIGINT NULL``
    Cost in millionths of a US dollar — the same unit as
    ``project.phase_token_usage.cost_microusd`` (``kpi_01``). Integer, so sums
    are exact; coord converts the wire's ``cost_usd`` to micros at the write
    boundary. NULL means "not known", never zero. CHECK ``>= 0`` when present
    (``ck_session_usage_cost_microusd_nonneg``).

``cost_source TEXT NULL`` — CHECK ``reported`` | ``estimated``
    ``reported`` — the provider reported it; ``estimated`` — computed from
    token counts against a price table; NULL — no cost recorded. Named
    ``ck_session_usage_cost_source``.

``first_turn_at`` / ``last_turn_at TIMESTAMPTZ NULL``
    The earliest and latest turn this row aggregates. CHECK
    ``first_turn_at <= last_turn_at`` when both are present
    (``ck_session_usage_turn_order``).

``turn_count INTEGER NOT NULL DEFAULT 0``
    Turns aggregated into this row. CHECK ``>= 0``
    (``ck_session_usage_turn_count_nonneg``).

``created_at`` / ``updated_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    Row bookkeeping.

Indexes
=======

* Primary key ``pk_session_usage (tenant_id, agent_session_id, model)`` — the
  UPSERT target, and the per-session read.
* ``ix_session_usage_tenant_last_turn_at (tenant_id, last_turn_at DESC NULLS
  LAST)`` —
  the tenant's recent-usage feed and time-windowed rollups.

Mechanics
=========

* Raw ``op.execute`` with ``CREATE ... IF NOT EXISTS`` throughout — the
  ``coord.*`` house style; a re-run is harmless. Every statement is
  ``coord.``-qualified, which the ``alembic-schema-arg-gate`` hook audits.
* No per-table GRANT: the ``coord`` schema's privileges are granted at the
  schema level and no sibling ``coord.*`` table migration issues per-table
  grants.
* HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here. Pure
  DDL, no app imports — the prod migrator lacks app deps.
* coord authors zero DDL (``[policy: alembic-sole-authorship]``), so this
  revision must land BEFORE any coord or runner PR that reads or writes the
  table.

The re-point rule
=================

``down_revision`` chains off ``kpi_01_phase_token_usage_cost_precision``,
authored in the same commit. If another revision lands ahead of the pair,
re-point ``kpi_01``'s ``down_revision`` at the new head; this line stays.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "kpi_02_coord_session_usage"
down_revision: str | Sequence[str] | None = "kpi_01_phase_token_usage_cost_precision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.session_usage`` + its feed index. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_usage (
            tenant_id                    UUID NOT NULL,
            agent_session_id             UUID NOT NULL,
            model                        TEXT NOT NULL,
            input_tokens                 BIGINT NOT NULL DEFAULT 0,
            output_tokens                BIGINT NOT NULL DEFAULT 0,
            cache_creation_input_tokens  BIGINT NOT NULL DEFAULT 0,
            cache_read_input_tokens      BIGINT NOT NULL DEFAULT 0,
            cost_microusd                BIGINT NULL,
            cost_source                  TEXT NULL,
            first_turn_at                TIMESTAMPTZ NULL,
            last_turn_at                 TIMESTAMPTZ NULL,
            turn_count                   INTEGER NOT NULL DEFAULT 0,
            created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT pk_session_usage
                PRIMARY KEY (tenant_id, agent_session_id, model),
            CONSTRAINT ck_session_usage_cost_source
                CHECK (cost_source IN ('reported', 'estimated')),
            CONSTRAINT ck_session_usage_tokens_nonneg
                CHECK (input_tokens >= 0
                       AND output_tokens >= 0
                       AND cache_creation_input_tokens >= 0
                       AND cache_read_input_tokens >= 0),
            CONSTRAINT ck_session_usage_turn_count_nonneg
                CHECK (turn_count >= 0),
            CONSTRAINT ck_session_usage_cost_microusd_nonneg
                CHECK (cost_microusd IS NULL OR cost_microusd >= 0),
            CONSTRAINT ck_session_usage_turn_order
                CHECK (first_turn_at IS NULL
                       OR last_turn_at IS NULL
                       OR first_turn_at <= last_turn_at)
        )
        """
    )
    # The tenant's recent-usage feed and time-windowed rollups.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_usage_tenant_last_turn_at
            ON coord.session_usage (tenant_id, last_turn_at DESC NULLS LAST)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.session_usage IS
            'Per-session, per-model Claude token and cost totals, one row per '
            '(tenant_id, agent_session_id, model), UPSERTed by the writer. '
            'agent_session_id is the Claude Code session id, a UUID of the same '
            'identity and type as coord.commit_lineage.agent_session_id (no FK). cost_microusd (millionths of a USD) NULL '
            'means not known, never zero; cost_source says whether a cost was '
            'reported by the provider or estimated from token counts.'
        """
    )


def downgrade() -> None:
    """Drop the table + its index. Any recorded rows go with it."""
    op.execute("DROP INDEX IF EXISTS coord.ix_session_usage_tenant_last_turn_at")
    # DROP TABLE takes the primary key and every CHECK constraint with it.
    op.execute("DROP TABLE IF EXISTS coord.session_usage")
