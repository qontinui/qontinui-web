"""coord.process_forecasts — process forecasts issued at state entry

Revision ID: coord_proclog_04
Revises: coord_proclog_03
Create Date: 2026-10-12

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics``; the
writer is Phase 9, which adds a process sub-space to twin fidelity. Applied in
production before any coord read (``[policy: alembic-sole-authorship]``).

What a row is
=============

One forecast per question per object, issued when the object enters the state
the question is about — ``land_within_t`` for a queued merge proposal,
``stall_within_t`` for a session entering ``working``, ``gate_clear_within_t``
for a registered gate (plan D13). ``p`` is the forecast probability. At
``issued_at + horizon_secs`` the worker resolves it from the event log,
writing ``resolved_at`` and ``observed``, and scores it with coord's shipped
ByteSized32 scorer (``twin_fidelity::score_transitions``) against a
majority-class baseline.

The question vocabulary is owned by coord's code, so it takes no CHECK (a new
question must not need a migration). ``p`` and ``horizon_secs`` are CHECKed:
a probability outside [0, 1] or a non-positive horizon is a writer bug, and
refusing it is cheaper than scoring it.

The unique key makes issuing idempotent. The partial index on unresolved rows
is the resolver's work queue: it stays proportional to what is outstanding,
not to every forecast ever issued.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_proclog_04"
down_revision: str | Sequence[str] | None = "coord_proclog_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the forecast table. Idempotent; no rows."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_forecasts (
            forecast_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            question      TEXT NOT NULL,
            object_type   TEXT NOT NULL,
            object_id     TEXT NOT NULL,
            issued_at     TIMESTAMPTZ NOT NULL,
            horizon_secs  INTEGER NOT NULL,
            p             DOUBLE PRECISION NOT NULL,
            predicted     JSONB NOT NULL DEFAULT '{}'::jsonb,
            resolved_at   TIMESTAMPTZ NULL,
            observed      JSONB NULL
        )
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_forecasts
            DROP CONSTRAINT IF EXISTS ck_process_forecasts_p
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_forecasts
            ADD CONSTRAINT ck_process_forecasts_p
            CHECK (p >= 0 AND p <= 1)
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_forecasts
            DROP CONSTRAINT IF EXISTS ck_process_forecasts_horizon_secs
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_forecasts
            ADD CONSTRAINT ck_process_forecasts_horizon_secs
            CHECK (horizon_secs > 0)
        """
    )
    # Issuing is idempotent: one forecast per question, object and entry time.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_process_forecasts_issue
            ON coord.process_forecasts
               (tenant_id, question, object_type, object_id, issued_at)
        """
    )
    # The resolver's queue: unresolved forecasts by age.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_forecasts_unresolved
            ON coord.process_forecasts (issued_at)
            WHERE resolved_at IS NULL
        """
    )


def downgrade() -> None:
    """Drop the forecast table."""
    op.execute("DROP TABLE IF EXISTS coord.process_forecasts")
