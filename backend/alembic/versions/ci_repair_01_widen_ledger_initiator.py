"""widen coord.git_write_ledger initiator CHECK for 'ci_repair_lane'

Revision ID: ci_repair_01_widen_ledger_initiator
Revises: coordinput_01_operator_inputs
Create Date: 2026-09-30

Phase 1 of qontinui-coord plan
``2026-09-24-coord-deterministic-ci-repair-lane`` (recipe 4, the stray
``Cargo.lock``): coord's CI-repair lane fast-forwards an open PR's head
with one coord-authored repair commit, through the governed git door, and
every write that door makes self-attributes in the Xi_Git intent ledger
as ``initiator = 'ci_repair_lane'`` (Rust ``Initiator::CiRepairLane``).

``coord.git_write_ledger.initiator`` is a closed set enforced by
``git_write_ledger_initiator_chk`` (created in
``twin_git_02_coord_git_write_ledger``, last widened by
``coord_push_tool_01_widen_ledger_initiator``). coord's ledger insert is
best-effort — a stale CHECK does not fail the push, it silently drops the
audit row — so coord's armed arm reads this constraint's live definition
and refuses to write until it admits ``'ci_repair_lane'``. This migration
is what lets the armed arm run; the default ``shadow`` mode needs nothing.

``down_revision`` chains off the local head
(``coordinput_01_operator_inputs``); coord re-points at land time.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ci_repair_01_widen_ledger_initiator"
down_revision: str = "coordinput_01_operator_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Widen the initiator CHECK to admit 'ci_repair_lane'. Idempotent.

    coord writes a ledger row on every governed push, so the swap must not
    queue writers behind a full-table scan under ACCESS EXCLUSIVE: fail fast
    on the lock (a timeout is a retry, not a data problem), add the wider
    CHECK ``NOT VALID`` (no scan), then ``VALIDATE`` it, which scans under
    SHARE UPDATE EXCLUSIVE and so lets inserts proceed. Every existing row
    already satisfies the wider set.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "DROP CONSTRAINT IF EXISTS git_write_ledger_initiator_chk"
    )
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "ADD CONSTRAINT git_write_ledger_initiator_chk "
        "CHECK (initiator IN ('outbound_mirror','merge_scheduler',"
        "'restack_engine','conflict_engine','agent_ref_migrate',"
        "'mcp_push_tool','ci_repair_lane')) NOT VALID"
    )
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "VALIDATE CONSTRAINT git_write_ledger_initiator_chk"
    )


def downgrade() -> None:
    # Reverting requires no 'ci_repair_lane' rows to remain (they would
    # violate the narrower constraint); pair a downgrade with setting
    # COORD_CI_REPAIR_STRAY_CARGO_LOCK_MODE to shadow or off and
    # reclassifying/purging those rows first.
    op.execute("SET LOCAL lock_timeout = '3s'")
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
