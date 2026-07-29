"""Backfill rollout_state from legacy dry-run booleans (pre-retirement)

Revision ID: dry_run_retire_01_backfill
Revises: reclaim_ev_01_wt_reclaim_events
Create Date: 2026-07-23

Phase 4 of the dry_run_override audit + legacy-bool retirement plan
(``2026-07-23-dry-run-override-audit-and-retirement``). Data-only — no DDL.

Why
---
The pr-merge rollout resolver in qontinui-coord
(``qontinui-coord/src/pr_merge/settings.rs:1720-1726``) ranks five tiers:

1. per-repo ``tenant_repo_profiles.rollout_state`` (TEXT)
2. per-repo ``tenant_repo_profiles.dry_run_override`` (BOOLEAN, legacy)
3. tenant ``tenant_merge_settings.rollout_state`` (TEXT)
4. tenant ``tenant_merge_settings.dry_run`` (BOOLEAN, legacy)
5. default ``Live``

A follow-up coord change deletes the legacy boolean tiers 2 and 4. For that
deletion to be semantics-preserving, every row where a boolean is currently
load-bearing (TEXT NULL, boolean non-NULL) must first have the equivalent
value written into the equally-or-higher-ranked TEXT tier. That is this
migration: ``true`` → ``'dry_run'``, ``false`` → ``'live'``, at both tiers.

The load-bearing population exists because per-repo enrollment wrote the
boolean only (no ``rollout_state`` TEXT) until the 2026-07-22 explicit-TEXT
fix — the ~30 ``tenant_repo_profiles`` rows with ``rollout_state IS NULL``
all post-date the ``pr_merge_10_rollout_state`` backfill of 2026-05-22.

Difference from the pr_merge_10 template (deliberate)
-----------------------------------------------------
``pr_merge_10_rollout_state.py`` (lines ~130-158) used the same CASE mapping
but its tenant-tier UPDATE wrote ``'dry_run'`` for NULL booleans (``ELSE
'dry_run'``, no ``dry_run IS NOT NULL`` guard). Re-running that today would
be semantics-CHANGING: a NULL/NULL tenant row currently falls through tiers
3 and 4 to the default ``Live`` (``settings.rs:155``), so writing
``'dry_run'`` would flip it. Both UPDATEs here therefore carry the strict
``... IS NOT NULL`` guard: rows where the boolean is NULL are untouched and
keep resolving exactly as they do today.

Idempotency: the ``rollout_state IS NULL`` guard makes re-running a no-op.
Rows that already have a non-NULL TEXT value are never touched (tier 1/3
already outranks the boolean there, so the boolean is dead weight on them).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "dry_run_retire_01_backfill"
down_revision: str = "reclaim_ev_01_wt_reclaim_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Copy legacy boolean posture into the canonical TEXT tier.

    Only rows where the boolean is load-bearing (TEXT NULL, boolean
    non-NULL) are written; the written value is exactly what the resolver's
    legacy-bridge (``RolloutState::from_legacy_dry_run``: true→DryRun,
    false→Live) produces today, so effective rollout is unchanged for
    every row.
    """
    # Per-repo tier: dry_run_override → tenant_repo_profiles.rollout_state.
    op.execute(
        """
        UPDATE coord.tenant_repo_profiles
           SET rollout_state = CASE
               WHEN dry_run_override THEN 'dry_run'
               ELSE 'live'
           END
         WHERE rollout_state IS NULL
           AND dry_run_override IS NOT NULL
        """
    )

    # Tenant tier: dry_run → tenant_merge_settings.rollout_state.
    # NB: strict `dry_run IS NOT NULL` — a NULL/NULL row resolves to the
    # default Live today and must stay NULL (see module docstring).
    op.execute(
        """
        UPDATE coord.tenant_merge_settings
           SET rollout_state = CASE
               WHEN dry_run THEN 'dry_run'
               ELSE 'live'
           END
         WHERE rollout_state IS NULL
           AND dry_run IS NOT NULL
        """
    )


def downgrade() -> None:
    """Documented no-op for the data.

    Backfilled ``rollout_state`` values are indistinguishable from explicit
    operator writes, so they cannot be selectively reverted. Nothing is
    lost: the legacy ``dry_run`` / ``dry_run_override`` BOOLEAN columns
    still hold the original data untouched until a later drop migration
    (plan Phase 6), and the resolver's TEXT tiers outrank the boolean tiers
    with identical values, so behaviour is unchanged in both directions.
    """
