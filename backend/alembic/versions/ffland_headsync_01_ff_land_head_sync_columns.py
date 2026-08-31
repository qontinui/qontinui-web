"""pr_merge — per-tenant + per-repo ff_land_head_sync opt-in columns

Revision ID: ffland_headsync_01
Revises: projdash_01_stf_prefix_idx
Create Date: 2026-08-26

Plan 2026-08-26-coord-ff-land-records-merged-on-github (Phase 1).

coord lands a PR by rebasing its commits onto the base branch and pushing them
straight there; it never calls GitHub's merge endpoint. When the rebase rewrites
the SHAs, the PR's head ref is left pointing at the pre-rebase tip, so the head
commit is never reachable from the base branch and **GitHub records the PR as
grey Closed with ``merged=false``** — even though the work landed. Measured over
the 90 days to 2026-08-26 across the six coord-orchestrated repos, that is
**69.4% of coord's identifiable lands** (722 of 1041).

The fix is producer-side: update the PR's head ref to the rebased tip as part of
the land, so the head becomes reachable from the base branch and GitHub marks the
PR MERGED by itself. Phase 0 of the plan verified this end-to-end on a throwaway
repo — the PR reads ``MERGED`` with ``mergeCommit.oid == headRefOid``, no merge
button and no API merge call.

This migration adds the storage for the opt-in dial that gates it. It is OFF by
default: rewriting a PR's head ref is a visible, force-update-shaped act on a
branch coord does not own, so it is opt-in per repo, never a fleet-wide flip.

Two nullable BOOLEAN columns, each NULL = "inherit the next tier up", mirroring
``auto_fix_red_main_01`` / ``layering_gate_cols_01`` / ``blast_radius_gate_cols_01``:

1. ``coord.tenant_merge_settings.ff_land_head_sync_enabled``
   — tenant-tier default. NULL = inherit the global default (OFF).

2. ``coord.tenant_repo_profiles.ff_land_head_sync_enabled``
   — per-(tenant, repo) override. NULL = inherit the tenant tier.

Resolution order (highest precedence first), as resolved by coord's settings
resolver (``qontinui-coord/src/pr_merge/settings.rs``):

    1. tenant_repo_profiles.ff_land_head_sync_enabled
    2. tenant_merge_settings.ff_land_head_sync_enabled
    3. Defaults::FF_LAND_HEAD_SYNC_ENABLED = false

**Per-repo granularity is the point, not a nicety.** The plan graduates one repo
at a time, and the measured benefit is wildly uneven across repos —
``qontinui-runner`` is 87.0% sha-rewriting while ``ui-bridge`` is 9.7%. A
tenant-only or env-only dial could not express that, which is why this is a
column pair and not an env var.

⚠️ **Graduation does NOT go through ``rollout_state``**, which the plan this
revision implements still names. That tri-state (``dry_run`` / ``shadow`` /
``live``) was **retired and the columns dropped from both of these very tables**
by ``merge_enabled_02_drop_rollout_state`` (plan
``2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch``), and
``POST /pr-merge/rollout`` no longer exists on the web proxy. Even while it did,
it wrote ``rollout_state`` — never this column — so it could not have graduated
this dial in any case. Graduation is a per-repo write of
``tenant_repo_profiles.ff_land_head_sync_enabled``, and the only non-SQL door for
that is the settings PATCH (``PATCH /pr-merge/repos/:repo/profile``).

**That door does not exist yet, and nothing else writes these columns either.**
``qontinui-coord#1660`` adds the RESOLVER that reads them, but neither it nor
this revision adds ``ff_land_head_sync_enabled`` to coord's ``PatchTenantSettings``
/ ``PatchRepoProfile`` or to the ``EffectiveProfile`` those routes serve — the
full path its sibling dial ``auto_fix_red_main`` has. Until a coord build carries
that wire, these two columns have **no writer anywhere in the fleet** and the dial
can only be set by hand-SQL. The qontinui-web console
(``frontend/src/components/operations/MergeOrchestrationSettings.tsx``) renders
both tiers already and lights them up off the served ``EffectiveProfile``, so the
remaining work is entirely coord-side.

Decoupled deploy order: coord reads these two columns via a SEPARATE, best-effort
query (NOT folded into the main resolver SELECT), exactly as ``auto_fix_red_main``
does. The coord build that consumes them falls through to the default (OFF)
cleanly when the columns are absent — so there is no coord<->web deploy-ordering
constraint for this migration, and either side may land first.

Idempotency: column adds are guarded by an inspector check (skip ``add_column``
if the column already exists). Re-running against an already-migrated DB is a
no-op. ``downgrade()`` drops the columns (reverse order). No CHECK constraints —
a nullable BOOLEAN is already fully constrained.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ffland_headsync_01"
down_revision: str = "projdash_01_stf_prefix_idx"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the two ff_land_head_sync opt-in columns (nullable BOOLEAN)."""

    # 1. tenant-tier default.
    if not _has_column("tenant_merge_settings", "ff_land_head_sync_enabled"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("ff_land_head_sync_enabled", sa.Boolean(), nullable=True),
            schema="coord",
        )

    # 2. per-(tenant, repo) override.
    if not _has_column("tenant_repo_profiles", "ff_land_head_sync_enabled"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column("ff_land_head_sync_enabled", sa.Boolean(), nullable=True),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the two columns (reverse order)."""

    if _has_column("tenant_repo_profiles", "ff_land_head_sync_enabled"):
        op.drop_column(
            "tenant_repo_profiles",
            "ff_land_head_sync_enabled",
            schema="coord",
        )

    if _has_column("tenant_merge_settings", "ff_land_head_sync_enabled"):
        op.drop_column(
            "tenant_merge_settings",
            "ff_land_head_sync_enabled",
            schema="coord",
        )
