"""coord.gate_corrections: index the replacement end of the lineage read.

Follow-up to plan
``qontinui-dev-notes/plans/2026-09-21-a-cleared-gate-is-uncorrectable-and-every-repair-mints-another-false-green-row.md``
(Phases 8-9), named in its status block as owed: *"an index on
``(tenant_id, replacement_gate_id)`` for the lineage read needs a qontinui-web
migration. Not added."* Additive, no data change.

What this adds
==========================================================================

A partial index::

    CREATE INDEX CONCURRENTLY idx_gate_corrections_tenant_replacement
    ON coord.gate_corrections (tenant_id, replacement_gate_id)
    WHERE replacement_gate_id IS NOT NULL

Why
==========================================================================

coord derives every gate read surface's ``correction`` block and ``lineage``
array from ONE loader (``gates::load_correction_entries``), which reads a
page of gates from BOTH ends of each row::

    SELECT ... FROM coord.gate_corrections
     WHERE tenant_id = $1
       AND (gate_id = ANY($2) OR replacement_gate_id = ANY($2))

The ``gate_id`` leg rides ``idx_gate_corrections_tenant_gate``
(``gatecorr_01``). The ``replacement_gate_id`` leg had no index, so the OR
degrades to a scan of the tenant's whole correction history on every
``coord_gate_list`` / ``GET /coord/gates`` page — and every reopen and
re-point now writes a lineage row (Phase 9), so that history grows with
ordinary gate traffic rather than with the rare hand correction.

Partial on ``replacement_gate_id IS NOT NULL`` because a ``mispredicated``
correction usually names no replacement; the ``= ANY($2)`` equality implies
the predicate, so the planner can use it for the OR leg.

Lock posture
==========================================================================

``CONCURRENTLY`` inside ``autocommit_block()`` with ``IF NOT EXISTS`` — the
only ``CREATE INDEX`` shape coord's migration classifier admits on an existing
table (``classify_create_index``). A failed earlier build leaves an INVALID
index that ``IF NOT EXISTS`` would keep, so it is dropped and rebuilt first —
the ``agent_questions_alert_id_idx_01`` idiom.

Revision ID: gatecorr_02_replacement_gate_index
Revises: spawnledger_01_spawn_requests
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "gatecorr_02_replacement_gate_index"
down_revision: str | Sequence[str] | None = "spawnledger_01_spawn_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Build the replacement-end index. Idempotent, and repairs a failed build."""
    with op.get_context().autocommit_block():
        if _index_is_invalid("idx_gate_corrections_tenant_replacement"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_gate_corrections_tenant_replacement"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook statically checks that every CREATE/DROP names its
        # schema.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_gate_corrections_tenant_replacement
            ON coord.gate_corrections (tenant_id, replacement_gate_id)
            WHERE replacement_gate_id IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop the index concurrently. The corrections are untouched."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_gate_corrections_tenant_replacement"
        )
