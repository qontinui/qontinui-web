"""coord.process_conformance_verdicts — one verdict per (constraint, case)

Revision ID: coord_proclog_03
Revises: coord_proclog_02
Create Date: 2026-10-12

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics``; the
writer is Phase 8, coord's Declare-style conformance worker. Applied in
production before any coord read (``[policy: alembic-sole-authorship]``).

What a row is
=============

The plan encodes the declared process (``finished-criteria``,
``session-protocol``, ``plan-discipline``, ``planning-and-scope``) as Declare
templates — ``response(a, b, within)``, ``precedence``, ``existence`` … — each
citing its policy clause. A missing expected event is a first-class deviation:
a ``response`` whose window closed with no ``b`` is ``violated``.

Every case's verdict is exactly one of ``held``, ``violated`` or ``unknown``
(CHECKed here). An unobservable activity, an unresolved attribution, or a
window that has not closed plus its inputs' ingestion lag is ``unknown`` with
its ``reason`` — never ``held`` and never ``violated``
(``[policy: an-unknown-input-must-not-fire-a-detector]``). Verdicts observe;
none of them blocks, refuses or delays an agent action (plan D12).

The primary key makes the worker's write an upsert: re-evaluating a case
replaces its verdict. The read aggregates per ``(tenant_id, constraint_id)``,
which the key's prefix serves.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_proclog_03"
down_revision: str | Sequence[str] | None = "coord_proclog_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the verdict table. Idempotent; no rows."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_conformance_verdicts (
            tenant_id         UUID NOT NULL,
            constraint_id     TEXT NOT NULL,
            case_type         TEXT NOT NULL,
            case_id           TEXT NOT NULL,
            verdict           TEXT NOT NULL,
            reason            TEXT NULL,
            evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            window_closes_at  TIMESTAMPTZ NULL,
            evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (tenant_id, constraint_id, case_type, case_id),
            CONSTRAINT ck_process_conformance_verdicts_verdict
                CHECK (verdict IN ('held', 'violated', 'unknown'))
        )
        """
    )


def downgrade() -> None:
    """Drop the verdict table."""
    op.execute("DROP TABLE IF EXISTS coord.process_conformance_verdicts")
