"""coord — agent_worktrees.dispatch_source + tenant_merge_settings.auto_fix_pr

Revision ID: pr_fixer_spawn_01
Revises: policy_rules_tombstone_01
Create Date: 2026-09-12

Plan 2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author
(Phase 1a "Discriminator — resolved: a column", vet findings 3, 4 and 14;
Phase 4b first bullet). This revision lands the COLUMNS ONLY. Served policy
``production-and-cost`` ``alembic-sole-authorship``: the qontinui-web migration
lands FIRST, and the coord reads follow it.

1. ``coord.agent_worktrees.dispatch_source TEXT NULL``
------------------------------------------------------
Records where an AUTONOMOUS coord dispatch came from. Vet finding 3:
``coord.agent_worktrees`` has no provenance column. The allocate INSERT writes
only ``agent_id, device_id, repo, branch, parent_sha, worktree_path, intent,
declared_overlap_paths, agent_session_id, tenant_id, work_unit_id``, so the only
discriminator today is the free-text ``intent``, which is fragile to parse.

Expected values: ``pr_fix``, ``red_main_fix``, ``next_step``, ``shepherd_t1``,
``shepherd_t2``, ``shepherd_t3``, ``gate_continuation``, ``unit_continuation``,
``work_plan``, ``condition_group``, ``stall_redispatch``. **NULL = an
interactive or operator allocation**, which never counts against the
autodispatch ceilings.

The column has no CHECK constraint on purpose. Later phases add dispatch sites,
and a new source should not need a DROP/ADD CONSTRAINT migration before coord
can write it. That is the same reasoning ``trigger_signal`` on this table
follows. It is NULLABLE with NO DEFAULT: every existing row is genuinely
unknown-provenance, and a non-null default would count every historical
worktree as an autonomous dispatch.

Index ``idx_agent_worktrees_dispatch_inflight`` is partial,
``(tenant_id, device_id, created_at) WHERE dispatch_source IS NOT NULL``. It
serves the Phase 1a in-flight count (vet finding 4):
``dispatch_source IS NOT NULL AND status IN (...) AND created_at > now() -
horizon``, grouped per target device and per tenant. Autonomous rows are a
small subset, and interactive rows never enter it. ``status`` is left out of
the key because the count ALSO admits ``abandoned`` rows until Phase 2a fixes
liveness, so the created-at horizon is what bounds the count, not the status.

2. ``coord.tenant_merge_settings.auto_fix_pr BOOLEAN NULL``
-----------------------------------------------------------
The tenant off-switch for PR-fixer spawns. Its shape is the exact parallel of
``auto_fix_red_main_01``. **NULL = no tenant-explicit value.** The default is
ON, per ``agent-spawn-authorization`` v11, and coord resolves that default in
code, so the column carries no DEFAULT. A ``NOT NULL DEFAULT true`` would turn
every tenant row into an explicit ON that could not be told apart from an
operator's choice.

Deploy order and degradation
----------------------------
coord's in-flight count treats a missing ``dispatch_source`` column as UNKNOWN,
and UNKNOWN defers. A coord deploy that lands ahead of this migration therefore
fails closed.

Idempotency: column adds are guarded by an inspector check, and the index uses
``IF NOT EXISTS``. ``downgrade()`` reverses both, in reverse order.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_fixer_spawn_01"
# `policy_rules_tombstone_01` is the single head on origin/main a765f7d1b.
down_revision: str = "policy_rules_tombstone_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add dispatch_source (+ in-flight index) and auto_fix_pr."""

    # 1. Provenance of an autonomous coord dispatch. NULL = interactive.
    if not _has_column("agent_worktrees", "dispatch_source"):
        op.add_column(
            "agent_worktrees",
            sa.Column("dispatch_source", sa.Text(), nullable=True),
            schema="coord",
        )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_worktrees_dispatch_inflight
            ON coord.agent_worktrees (tenant_id, device_id, created_at)
            WHERE dispatch_source IS NOT NULL
        """
    )

    # 2. Tenant-tier PR-fixer off-switch. NULL = default (ON, resolved in coord).
    if not _has_column("tenant_merge_settings", "auto_fix_pr"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("auto_fix_pr", sa.Boolean(), nullable=True),
            schema="coord",
        )


def downgrade() -> None:
    """Drop both columns and the index (reverse order)."""

    if _has_column("tenant_merge_settings", "auto_fix_pr"):
        op.drop_column("tenant_merge_settings", "auto_fix_pr", schema="coord")

    op.execute("DROP INDEX IF EXISTS coord.idx_agent_worktrees_dispatch_inflight")

    if _has_column("agent_worktrees", "dispatch_source"):
        op.drop_column("agent_worktrees", "dispatch_source", schema="coord")
