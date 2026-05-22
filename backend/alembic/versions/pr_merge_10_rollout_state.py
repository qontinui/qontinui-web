"""pr_merge phase 9 — tri-state rollout substrate

Revision ID: pr_merge_10_rollout_state
Revises: pr_merge_09_device_claude_capability
Create Date: 2026-05-22

Phase 9 D9.1 of the PR Merge Orchestrator
(``D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md``).

Three schema deltas land here:

1. **``coord.tenant_repo_profiles.rollout_state``** (TEXT NULL, CHECK
   IN ('dry_run','shadow','live')). The canonical per-(tenant, repo)
   enablement state going forward. ``NULL`` = inherit from
   ``coord.tenant_merge_settings.rollout_state``. Backfilled from the
   existing ``dry_run_override`` BOOLEAN: true→'dry_run', false→'live',
   NULL stays NULL.

2. **``coord.tenant_merge_settings.rollout_state``** (TEXT NULL, CHECK
   IN ('dry_run','shadow','live')). The tenant-wide enablement state.
   Backfilled from the existing ``dry_run`` BOOLEAN: true→'dry_run',
   false→'live'; NULL → 'dry_run' (conservative default).

3. **``coord.merge_decisions.executed``** (BOOLEAN NOT NULL DEFAULT
   true). Discriminates shadow-mode decisions (``executed=false``;
   pipeline ran, no merge fired) from live decisions (``executed=true``;
   would-have-merged actually merged). Existing rows are all live so
   ``DEFAULT true`` is the correct backfill.

The original ``dry_run`` / ``dry_run_override`` BOOLEAN columns are
**kept** for backward-compat — any consumer that hasn't migrated to
reading ``rollout_state`` continues to work. The Phase 9 resolver in
``qontinui-coord/src/pr_merge/settings.rs::EffectiveProfile`` reads
``rollout_state`` as canonical and treats the BOOLEAN columns as
fallback-only when the new column is NULL.

Idempotency: ``ADD COLUMN IF NOT EXISTS`` + idempotent backfill
(``UPDATE`` only when ``rollout_state IS NULL``). Re-running against
an already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_merge_10_rollout_state"
down_revision: str = "pr_merge_09_device_claude_capability"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three Phase 9 columns + backfill from existing BOOLEANs."""

    # ------------------------------------------------------------------
    # 1. coord.tenant_repo_profiles.rollout_state
    # ------------------------------------------------------------------
    # NULL = inherit from tenant. CHECK enforces the three-state enum.
    # The CHECK is added as a separate ALTER so the ADD COLUMN can be
    # idempotent (CHECK constraints don't have an IF NOT EXISTS form,
    # so we drop+add to keep the migration re-runnable).
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            ADD COLUMN IF NOT EXISTS rollout_state TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            DROP CONSTRAINT IF EXISTS tenant_repo_profiles_rollout_state_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            ADD CONSTRAINT tenant_repo_profiles_rollout_state_check
            CHECK (rollout_state IS NULL
                   OR rollout_state IN ('dry_run', 'shadow', 'live'))
        """
    )

    # ------------------------------------------------------------------
    # 2. coord.tenant_merge_settings.rollout_state
    # ------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD COLUMN IF NOT EXISTS rollout_state TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            DROP CONSTRAINT IF EXISTS tenant_merge_settings_rollout_state_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD CONSTRAINT tenant_merge_settings_rollout_state_check
            CHECK (rollout_state IS NULL
                   OR rollout_state IN ('dry_run', 'shadow', 'live'))
        """
    )

    # ------------------------------------------------------------------
    # 3. coord.merge_decisions.executed
    # ------------------------------------------------------------------
    # DEFAULT true so existing rows backfill in-place as live decisions.
    # NOT NULL because every decision is unambiguously one or the other.
    op.execute(
        """
        ALTER TABLE coord.merge_decisions
            ADD COLUMN IF NOT EXISTS executed BOOLEAN NOT NULL DEFAULT true
        """
    )
    # Lookup index for the SLO endpoint's shadow_vs_live_agreement_rate
    # computation: filtered scan over the last 7/30 days by tenant + repo.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_merge_decisions_tenant_executed_recent
            ON coord.merge_decisions (tenant_id, executed, decided_at DESC)
        """
    )

    # ------------------------------------------------------------------
    # 4. Backfill — only touch rows whose rollout_state is NULL (idempotency).
    # ------------------------------------------------------------------
    # Tenant tier: true→'dry_run', false→'live'; if dry_run IS NULL, default
    # to 'dry_run' (the conservative posture matching `Defaults::DRY_RUN`).
    op.execute(
        """
        UPDATE coord.tenant_merge_settings
           SET rollout_state = CASE
               WHEN dry_run = true  THEN 'dry_run'
               WHEN dry_run = false THEN 'live'
               ELSE 'dry_run'
           END
         WHERE rollout_state IS NULL
        """
    )

    # Per-repo tier: true→'dry_run', false→'live'; NULL stays NULL
    # (= inherit from tenant). Per the plan's three-tier resolution.
    op.execute(
        """
        UPDATE coord.tenant_repo_profiles
           SET rollout_state = CASE
               WHEN dry_run_override = true  THEN 'dry_run'
               WHEN dry_run_override = false THEN 'live'
               ELSE NULL
           END
         WHERE rollout_state IS NULL
           AND dry_run_override IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the three Phase 9 columns + the supporting index.

    No data preservation. The BOOLEAN ``dry_run`` / ``dry_run_override``
    columns remain populated through the Phase 2 + Phase 9 lifecycle, so
    a downgrade returns to the pre-Phase 9 behaviour without loss of
    enablement state. Shadow-mode decisions ``executed=false`` collapse
    back into the audit log without the discriminator — operators
    needing that distinction must re-apply this migration.
    """
    op.execute("DROP INDEX IF EXISTS coord.idx_merge_decisions_tenant_executed_recent")
    op.execute(
        "ALTER TABLE coord.merge_decisions DROP COLUMN IF EXISTS executed"
    )

    op.execute(
        "ALTER TABLE coord.tenant_merge_settings "
        "DROP CONSTRAINT IF EXISTS tenant_merge_settings_rollout_state_check"
    )
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP COLUMN IF EXISTS rollout_state"
    )

    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP CONSTRAINT IF EXISTS tenant_repo_profiles_rollout_state_check"
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles DROP COLUMN IF EXISTS rollout_state"
    )
