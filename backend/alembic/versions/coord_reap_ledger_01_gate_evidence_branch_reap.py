"""coord.git_write_ledger: gate_id + evidence columns, admit initiator 'branch_reap'

Revision ID: coord_reap_ledger_01_gate_evidence_branch_reap
Revises: overview_06_cost_category_parent
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
down_revision: str | Sequence[str] | None = "overview_06_cost_category_parent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW = (
    "CHECK (initiator IN ('outbound_mirror','merge_scheduler',"
    "'restack_engine','conflict_engine','agent_ref_migrate',"
    "'mcp_push_tool','branch_reap'))"
)
_OLD = (
    "CHECK (initiator IN ('outbound_mirror','merge_scheduler',"
    "'restack_engine','conflict_engine','agent_ref_migrate',"
    "'mcp_push_tool'))"
)
_T = "ALTER TABLE coord.git_write_ledger "


def _swap_check(definition: str, *, pre_validate=None) -> None:
    """Replace the initiator CHECK; the validating scan runs outside the txn.

    alembic's env runs a batch in ONE transaction, so a plain VALIDATE would
    still hold the table's ACCESS EXCLUSIVE (taken by the ADD) for the whole
    scan. ``autocommit_block()`` commits first: the DROP + ``ADD ... NOT
    VALID`` commit having held the lock only briefly, then VALIDATE runs in its
    own transaction under SHARE UPDATE EXCLUSIVE (blocks neither reads nor
    writes). Precedent: ``coord_tenant_fk_01_repair_missing_tenant_fks``.

    ``pre_validate`` runs after the NOT VALID add and before the commit; if it
    raises, the whole transaction (DDL included) rolls back.

    What is guaranteed: ``lock_timeout`` bounds only the WAIT to acquire a
    lock, not how long the DDL then runs. ``SET LOCAL`` dies with the commit, so
    the block sets a session-level timeout and RESETs it in a ``finally``. The
    cost: earlier revisions in the same batch commit early (the batch is not
    all-or-nothing); every statement here is idempotent, so re-running recovers
    a partial batch.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_T + "DROP CONSTRAINT IF EXISTS git_write_ledger_initiator_chk")
    op.execute(
        _T + "ADD CONSTRAINT git_write_ledger_initiator_chk " + definition + " NOT VALID"
    )
    if pre_validate is not None:
        pre_validate()
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '3s'")
        try:
            op.execute(_T + "VALIDATE CONSTRAINT git_write_ledger_initiator_chk")
        finally:
            op.execute("RESET lock_timeout")


def upgrade() -> None:
    """Add gate_id/evidence and widen the initiator CHECK. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_T + "ADD COLUMN IF NOT EXISTS gate_id uuid")
    op.execute(_T + "ADD COLUMN IF NOT EXISTS evidence jsonb")
    _swap_check(_NEW)


def _refuse_if_branch_reap_rows() -> None:
    # The narrower NOT VALID CHECK already rejects NEW branch_reap rows, so an
    # existence probe (no explicit lock, stops at the first hit) is race-free.
    found = op.get_bind().exec_driver_sql(
        "SELECT EXISTS (SELECT 1 FROM coord.git_write_ledger "
        "WHERE initiator = 'branch_reap')"
    ).scalar()
    if found:
        # Raising rolls back the transaction, restoring the wider CHECK.
        raise RuntimeError(
            "cannot downgrade: coord.git_write_ledger has rows with "
            "initiator='branch_reap'; reclassify or archive them first "
            "(audit rows are never deleted by a migration)"
        )


def downgrade() -> None:
    # Deleting audit rows is destructive, so refuse instead.
    _swap_check(_OLD, pre_validate=_refuse_if_branch_reap_rows)
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_T + "DROP COLUMN IF EXISTS evidence")
    op.execute(_T + "DROP COLUMN IF EXISTS gate_id")
