"""coord.git_write_ledger: gate_id + evidence columns, admit initiator 'branch_reap'

Revision ID: coord_reap_ledger_01_gate_evidence_branch_reap
Revises: cireserve_01_devices_ci_reserved_gib
Create Date: 2026-11-15

Phase 1 (web DDL) of plan
``2026-11-15-reap-ledger-custody-index-and-census-read-surface``.

The branch-reap worker's delete already flows through coord's governed git
door (``outbound_git::write``); the ledger row it writes must record which
gate authorised the reap and the guard facts it acted on.

1. ``gate_id uuid NULL`` and ``evidence jsonb NULL`` — no defaults, so
   existing rows and old coord builds are unaffected (coord degrades on
   42703 until this migration is observed).
2. ``git_write_ledger_initiator_chk`` is a closed set; the new Rust
   ``Initiator::BranchReap`` writes ``'branch_reap'``, which the stale CHECK
   would refuse — and coord's ledger insert is best-effort, so that would
   SILENTLY drop the audit row. The CHECK is dropped and re-added with the
   widened set (pattern: ``coord_push_tool_01_widen_ledger_initiator``).

Hand-authored; never ``alembic revision --autogenerate``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_reap_ledger_01_gate_evidence_branch_reap"
down_revision: str | Sequence[str] | None = "cireserve_01_devices_ci_reserved_gib"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add gate_id/evidence and widen the initiator CHECK. Idempotent."""
    op.execute(
        "ALTER TABLE coord.git_write_ledger ADD COLUMN IF NOT EXISTS gate_id uuid"
    )
    op.execute(
        "ALTER TABLE coord.git_write_ledger ADD COLUMN IF NOT EXISTS evidence jsonb"
    )
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "DROP CONSTRAINT IF EXISTS git_write_ledger_initiator_chk"
    )
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "ADD CONSTRAINT git_write_ledger_initiator_chk "
        "CHECK (initiator IN ('outbound_mirror','merge_scheduler',"
        "'restack_engine','conflict_engine','agent_ref_migrate',"
        "'mcp_push_tool','branch_reap'))"
    )


def downgrade() -> None:
    # Reverting requires no 'branch_reap' rows to remain (they would violate
    # the narrower constraint); purge or reclassify them first. The two
    # columns are dropped with their data.
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "DROP CONSTRAINT IF EXISTS git_write_ledger_initiator_chk"
    )
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "ADD CONSTRAINT git_write_ledger_initiator_chk "
        "CHECK (initiator IN ('outbound_mirror','merge_scheduler',"
        "'restack_engine','conflict_engine','agent_ref_migrate',"
        "'mcp_push_tool'))"
    )
    op.execute("ALTER TABLE coord.git_write_ledger DROP COLUMN IF EXISTS evidence")
    op.execute("ALTER TABLE coord.git_write_ledger DROP COLUMN IF EXISTS gate_id")
