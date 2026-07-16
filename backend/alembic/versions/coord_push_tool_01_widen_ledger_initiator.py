"""widen coord.git_write_ledger initiator CHECK for 'mcp_push_tool'

Revision ID: coord_push_tool_01_widen_ledger_initiator
Revises: cinode_01_dispatch_ledger
Create Date: 2026-07-15

Phase 1 (web DDL) of the coord push-to-branch MCP tool plan
(``D:/qontinui-root/plans/2026-07-15-coord-push-to-branch-mcp-tool.md``):
coord gains an MCP tool that pushes agent branches through the governed
git door, and every write it emits must self-attribute in the Xi_Git
intent ledger.

``coord.git_write_ledger.initiator`` is a closed set enforced by
``git_write_ledger_initiator_chk`` (created in
``twin_git_02_coord_git_write_ledger``); the new tool writes rows with
``initiator = 'mcp_push_tool'`` (Rust ``Initiator::McpPushTool``), so the
CHECK must admit that value. coord's ``insert_pending_ledger`` is
best-effort — a stale CHECK does not fail the push, it SILENTLY drops the
audit row — so this migration must deploy before the tool ships.

``down_revision`` chains off the local head
(``cinode_01_dispatch_ledger``); coord re-points at land time.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_push_tool_01_widen_ledger_initiator"
down_revision: str = "cinode_01_dispatch_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Widen the initiator CHECK to admit 'mcp_push_tool'. Idempotent."""
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


def downgrade() -> None:
    # Reverting requires no 'mcp_push_tool' rows to remain (they would
    # violate the narrower constraint); the MCP push tool writes that
    # value, so a downgrade should be paired with disabling the tool and
    # reclassifying/purging those rows first.
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "DROP CONSTRAINT IF EXISTS git_write_ledger_initiator_chk"
    )
    op.execute(
        "ALTER TABLE coord.git_write_ledger "
        "ADD CONSTRAINT git_write_ledger_initiator_chk "
        "CHECK (initiator IN ('outbound_mirror','merge_scheduler',"
        "'restack_engine','conflict_engine','agent_ref_migrate'))"
    )
