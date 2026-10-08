"""coord.capacity_advice_log — every capacity recommendation, and what happened next

Revision ID: fcap_03
Revises: fcap_02
Create Date: 2026-10-08

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``
(Decision 4, and the store Phase 6 closes the loop in).

coord's pure ``capacity_advice(window) -> Vec<Advice>`` emits typed, sized,
explainable recommendations (``add_ci_runner_service``, ``restore_runner``,
``acquire_host``, ``use_idle_hardware``, ``move_workload``, ``hosted_ceiling``,
``measure_first``). This table is the append-only record of every advice
emitted, whether and by whom it was acted on, and the **realised** effect
measured afterwards — so a wrong prediction is falsifiable rather than
forgotten. coord authors zero DDL ``[policy: alembic-sole-authorship]``; this
revision lands before the coord PR that writes it, and coord must degrade on a
missing relation (SQLSTATE 42P01) until it does.

Column contract — shared with coord's Rust code
===============================================

``id UUID PRIMARY KEY DEFAULT gen_random_uuid()``.

``tenant_id UUID NOT NULL`` — from coord's verified tenant context. **No FK**,
the same choice ``spawnadm_01`` made for its ledger: an append-only log must
never fail an insert for referential bookkeeping.

``emitted_at TIMESTAMPTZ NOT NULL DEFAULT now()``.

``kind TEXT NOT NULL`` — deliberately **not** CHECK-constrained. The v1 set is
listed above, and the plan already expects it to grow (``measure_first`` was
added during vetting); coord and this schema deploy independently, so a CHECK
would turn every new advice kind into a lockstep migration and, worse, a
failed log write. coord owns the vocabulary.

``target TEXT NOT NULL`` — what the advice is about: a repo, a computer, a pool.
Text, because the target kinds differ per advice kind.

``computer_id UUID NULL`` — **no FK yet**. ``coord.computers`` is created by
web#1598, which has not landed; the FK is added by a later revision once it
has. Until then this is an unenforced reference and readers must tolerate an
id that resolves to nothing.

``window_secs INTEGER NULL`` — the analysis window the advice was computed over.

``bottleneck``, ``evidence``, ``expected_effect`` (``JSONB NULL``) — the
bottleneck metric with its value and window; the evidence (row counts, sample
coverage, links to the reads it came from); the expected effect **with its
arithmetic** (queue minutes saved per day, lands per day). JSONB because each
advice kind carries a different shape; coord's ``Advice`` type is the schema.

``confidence TEXT NOT NULL`` — CHECK ``high`` | ``medium`` | ``low`` |
``unknown``. ``unknown`` is a value (Decision 5), not an absence: an advice
whose deciding input is UNKNOWN is recorded as such, never dropped. CHECKed,
unlike ``kind``, because the plan fixes this set and a consumer ranks on it.

``actor TEXT NOT NULL`` — CHECK ``agent`` | ``operator``: who is expected to act.

``acted_on_at TIMESTAMPTZ NULL`` / ``acted_by TEXT NULL`` — set when the advice
was acted on. NULL = not acted on (yet), never "rejected"; this table records
no rejection state.

``realised_effect JSONB NULL`` / ``realised_at TIMESTAMPTZ NULL`` — Phase 6's
measured outcome of an acted-on advice, comparable field-for-field with
``expected_effect``. NULL = not yet measured.

Append-only, and what that means for UPDATE
===========================================

Rows are never deleted except by retention, and the advice columns are never
rewritten. The four outcome columns (``acted_on_at``, ``acted_by``,
``realised_effect``, ``realised_at``) are the ONLY columns that are UPDATEd,
each set once, when the event happens. That is enforced by coord's writer, not
by a trigger — the same posture every other coord ledger takes.

Retention — 90 days, handled by coord
=====================================

The plan bounds this table at 90 days. Pruning is coord's job (a periodic
``DELETE … WHERE emitted_at < now() - interval '90 days'``). Emission is a
handful of advices per analysis window per tenant, so the table stays small and
a sequential scan serves the prune; no dedicated ``emitted_at`` index is added
for it.

Index
=====

``ix_capacity_advice_log_tenant_emitted_at (tenant_id, emitted_at DESC)`` — the
tenant feed, newest first: the console's Capacity section and the
``coord_query_fleet_capacity`` history read.

Grants
======

No per-table GRANT and no RLS: the ``coord`` schema's privileges are granted at
the schema level, and no sibling ``coord.*`` table migration (``mdroles_01``,
``cmtland_01``, ``spawnadm_01``) issues per-table grants.

Shape
=====

HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here. Raw,
static, ``coord.``-qualified ``op.execute`` with ``IF NOT EXISTS`` — the house
convention for coord tables, and the only shape coord's merge-train migration
classifier can inspect. Pure DDL, no app imports.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fcap_03"
down_revision: str | Sequence[str] | None = "fcap_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.capacity_advice_log and its tenant feed index. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.capacity_advice_log (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            emitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            kind             TEXT NOT NULL,
            target           TEXT NOT NULL,
            computer_id      UUID NULL,
            window_secs      INTEGER NULL,
            bottleneck       JSONB NULL,
            evidence         JSONB NULL,
            expected_effect  JSONB NULL,
            confidence       TEXT NOT NULL,
            actor            TEXT NOT NULL,
            acted_on_at      TIMESTAMPTZ NULL,
            acted_by         TEXT NULL,
            realised_effect  JSONB NULL,
            realised_at      TIMESTAMPTZ NULL,
            CONSTRAINT ck_capacity_advice_log_confidence
                CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
            CONSTRAINT ck_capacity_advice_log_actor
                CHECK (actor IN ('agent', 'operator'))
        )
        """
    )
    # Tenant feed, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_capacity_advice_log_tenant_emitted_at
            ON coord.capacity_advice_log (tenant_id, emitted_at DESC)
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.capacity_advice_log IS
            'Append-only record of every capacity recommendation coord''s '
            'capacity_advice() emitted (plan '
            '2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware), '
            'whether it was acted on, and the realised effect measured '
            'afterwards, so a wrong prediction is falsifiable. Only the four '
            'outcome columns (acted_on_at, acted_by, realised_effect, '
            'realised_at) are ever UPDATEd, each set once; nothing else is '
            'rewritten. Retained 90 days by coord on emitted_at. Written by '
            'coord only.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.kind IS
            'Advice kind (add_ci_runner_service, restore_runner, acquire_host, '
            'use_idle_hardware, move_workload, hosted_ceiling, measure_first, '
            '…). Deliberately NOT CHECKed: coord owns the vocabulary and it '
            'grows; a CHECK would make each new kind a lockstep migration and '
            'a failed log write.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.computer_id IS
            'The coord.computers row the advice targets, when it targets one. '
            'NO FOREIGN KEY YET: coord.computers is created by web#1598 and the '
            'FK is added by a later revision once it lands. Until then a '
            'reader must tolerate an id that resolves to nothing. NULL = the '
            'advice does not target a single computer.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.confidence IS
            'high | medium | low | unknown, derived from sample coverage and '
            'model fit. unknown is a VALUE, not an absence: an advice whose '
            'deciding input is UNKNOWN is recorded with it, never dropped.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.expected_effect IS
            'Predicted effect WITH its arithmetic (e.g. queue p90 minutes '
            'saved per day, lands per day), shaped per advice kind by coord''s '
            'Advice type. Compared field-for-field with realised_effect. NULL '
            '= no effect could be sized (never a predicted zero).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.acted_on_at IS
            'When the advice was acted on (by acted_by). NULL = not acted on '
            'yet — NOT "rejected"; this table records no rejection state. Set '
            'once.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.realised_effect IS
            'Measured effect of an acted-on advice (Phase 6), in the shape of '
            'expected_effect, stamped at realised_at. NULL = not yet measured, '
            'never a realised zero. Set once.'
        """
    )


def downgrade() -> None:
    """Drop the index and the table. Any recorded advice goes with it."""
    op.execute("DROP INDEX IF EXISTS coord.ix_capacity_advice_log_tenant_emitted_at")
    # DROP TABLE takes both CHECK constraints and every comment with it.
    op.execute("DROP TABLE IF EXISTS coord.capacity_advice_log")
