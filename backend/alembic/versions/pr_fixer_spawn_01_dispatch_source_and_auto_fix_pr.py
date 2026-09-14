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

Two partial indexes serve the Phase 1a in-flight count (vet finding 4):
``dispatch_source IS NOT NULL AND status IN (...) AND created_at > now() -
horizon``, counted once per target device and once per tenant.

- ``idx_agent_worktrees_dispatch_inflight_device``:
  ``(device_id, created_at) WHERE dispatch_source IS NOT NULL``.
- ``idx_agent_worktrees_dispatch_inflight_tenant``:
  ``(tenant_id, created_at) WHERE dispatch_source IS NOT NULL``.

Each count gets an equality prefix plus a range on ``created_at``. Autonomous
rows are a small subset, and interactive rows never enter either index.
``status`` is left out of the key because the count ALSO admits ``abandoned``
rows until Phase 2a fixes liveness, so the created-at horizon bounds the count,
not the status.

2. ``coord.tenant_merge_settings.auto_fix_pr BOOLEAN NULL``
-----------------------------------------------------------
The tenant off-switch for PR-fixer spawns. Its shape is the exact parallel of
``auto_fix_red_main_01``. **NULL = no tenant-explicit value.** The default is
ON, per ``agent-spawn-authorization`` v11, and coord resolves that default in
code, so the column carries no DEFAULT. A ``NOT NULL DEFAULT true`` would turn
every tenant row into an explicit ON that could not be told apart from an
operator's choice.

Locking — ``coord.agent_worktrees`` is on coord's allocate hot path
-------------------------------------------------------------------
- ``SET LOCAL lock_timeout = '3s'`` runs in each transactional DDL step (the
  CONCURRENTLY statements run without it; their SHARE UPDATE EXCLUSIVE lock does
  not queue readers or writers), following
  ``coord_wu_authored_at_01`` and ``coord_sessions_work_unit_slug``. A column
  add that queues behind a long query fails fast instead of stalling every
  later reader behind its ACCESS EXCLUSIVE request.
- Both column adds run first. The indexes are built LAST, with
  ``CREATE INDEX CONCURRENTLY`` inside ``autocommit_block()``, following
  ``coord_alerts_pagedidx_01``. Entering the block commits the column adds and
  releases their lock before the index scan starts, so the build never holds
  ACCESS EXCLUSIVE.

Deploy order and degradation
----------------------------
coord's in-flight count treats a missing ``dispatch_source`` column as UNKNOWN,
and UNKNOWN defers. A coord deploy that lands ahead of this migration therefore
fails closed.

Idempotency: column adds are guarded by an inspector check, and index builds
use ``IF NOT EXISTS``. **``IF NOT EXISTS`` is not a full guard for a
CONCURRENTLY build.** A killed build leaves an INVALID index under that name,
and a re-run would then skip it and report success. ``_require_valid()`` checks
``pg_index.indisvalid`` after each build and raises instead (the trap
``coord_alerts_pagedidx_01`` records; the helper follows
``coord_test_results_idx_01``). Drop the invalid index and re-run. ``downgrade()`` reverses
everything in reverse order.
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


def _require_valid(index_name: str) -> None:
    """Raise if a CONCURRENTLY build left ``coord.<index_name>`` INVALID.

    ``IF NOT EXISTS`` skips an invalid index left by a killed build and reports
    success; this turns that false success into a loud failure.
    """
    valid = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'coord' AND c.relname = :name"
            ),
            {"name": index_name},
        )
        .scalar()
    )
    if valid is not True:
        raise RuntimeError(
            f"coord.{index_name} is missing or INVALID after CREATE INDEX "
            "CONCURRENTLY; drop it and re-run the migration"
        )


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add dispatch_source and auto_fix_pr, then build the in-flight indexes."""

    op.execute("SET LOCAL lock_timeout = '3s'")

    # 1. Provenance of an autonomous coord dispatch. NULL = interactive.
    if not _has_column("agent_worktrees", "dispatch_source"):
        op.add_column(
            "agent_worktrees",
            sa.Column("dispatch_source", sa.Text(), nullable=True),
            schema="coord",
        )

    # 2. Tenant-tier PR-fixer off-switch. NULL = default (ON, resolved in coord).
    if not _has_column("tenant_merge_settings", "auto_fix_pr"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("auto_fix_pr", sa.Boolean(), nullable=True),
            schema="coord",
        )

    # 3. LAST: the in-flight indexes, built CONCURRENTLY outside the DDL
    #    transaction so the hot table is never locked for the scan. Plain
    #    literals, never f-strings: check_alembic_schema_args.py audits only
    #    constant SQL, so an f-string would silently escape the schema gate.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_worktrees_dispatch_inflight_device
                ON coord.agent_worktrees (device_id, created_at)
                WHERE dispatch_source IS NOT NULL
            """
        )
        _require_valid("idx_agent_worktrees_dispatch_inflight_device")
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_worktrees_dispatch_inflight_tenant
                ON coord.agent_worktrees (tenant_id, created_at)
                WHERE dispatch_source IS NOT NULL
            """
        )
        _require_valid("idx_agent_worktrees_dispatch_inflight_tenant")


def downgrade() -> None:
    """Drop the indexes, then both columns (reverse order)."""

    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_agent_worktrees_dispatch_inflight_tenant"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_agent_worktrees_dispatch_inflight_device"
        )

    op.execute("SET LOCAL lock_timeout = '3s'")

    if _has_column("tenant_merge_settings", "auto_fix_pr"):
        op.drop_column("tenant_merge_settings", "auto_fix_pr", schema="coord")

    if _has_column("agent_worktrees", "dispatch_source"):
        op.drop_column("agent_worktrees", "dispatch_source", schema="coord")
