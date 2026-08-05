"""merge rollout retirement 02 — drop both rollout_state columns

Revision ID: merge_enabled_02
Revises: coord_primary_trees_selfheal_backfill
Create Date: 2026-08-05

Phase 5 (the final phase) of the plan
``D:/qontinui-root/plans/2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch.md``.
Alembic is the sole author of ``coord.*`` schema [policy:
``alembic-sole-authorship``], so the DROP lands here.

Two schema deltas, both destructive
-----------------------------------

1. ``coord.tenant_repo_profiles.rollout_state`` (TEXT NULL) + its
   ``tenant_repo_profiles_rollout_state_check`` CHECK constraint.
2. ``coord.tenant_merge_settings.rollout_state`` (TEXT NULL) + its
   ``tenant_merge_settings_rollout_state_check`` CHECK constraint.

Both were added by ``pr_merge_10_rollout_state`` (2026-05-22). ``merge_enabled``
/ ``merge_paused`` (``merge_enabled_01``, live in prod since 2026-08-04) replaced
them, and coord's Phase 2–4 work moved every enforcement seam onto the new axis.

⚠️ DEPLOY ORDERING — this is the DROP direction, and it is the MIRROR of the rule
================================================================================

The familiar rule is for ADDs: a coord read of a NEW ``coord.*`` column needs its
web migration to land FIRST, because a missing column sails through
``require_table``'s boot check and fails at query time
[policy: ``alembic-sole-authorship``].

**DROP runs the other way.** This revision destroys columns that a DEPLOYED coord
may still be SELECTing, and coord + qontinui-web deploy independently. So:

* The companion **qontinui-coord PR removing every ``rollout_state`` reference
  must be LANDED AND SERVING IN PROD before this revision applies.** Serving,
  not merged: verified via ``coord_query_release_state``'s ``in_sync`` +
  ``declared_sha`` plus ``git merge-base --is-ancestor`` against that sha. A green
  "Deploy coord" run proves nothing — push-deploys debounce and no-op.
* The hold is therefore a **DRAFT PR, never a ``coord:downstream-of=`` label.**
  The constraint is a *deploy*; labels sequence *merges*. Un-draft only after the
  serving sha carries the coord removal.

Two mechanical checks were run at authoring time, because "no live readers" is
two things and everyone misses the second:

* **No live readers.** ``grep -rn rollout_state`` over the coord tree's post-PR
  state returns only regression guards asserting the token's ABSENCE (e.g.
  ``!body.contains("rollout_state")``) — no SELECT, no INSERT, no UPDATE.
* **No ``schema_consistency_watcher::CURATED_COLUMNS`` pins.** Those are static
  ``ExpectedColumn`` assertions that a column EXISTS. They are CURATED (alert),
  not REQUIRED (hard-fail), so a drop does not break reads — it raises a
  PERMANENT false-positive ``coord.alerts`` row per pinned column, forever, with
  nothing to clear it. Verified: neither ``schema_consistency_watcher.rs`` nor
  ``schema_readiness.rs`` pins either column (the only ``rollout`` hit in those
  files is the unrelated phrase "post-rollout" in a module doc).

Coord's live-catalog read-contract gate (``schema_read_contract.rs``,
``COORD_READ_CONTRACT_ENFORCE=1`` in ``coord-db-tests``) enforces the ADD
direction by asserting every ``coord.<table>.<column>`` in coord's SQL literals
exists in a throwaway DB migrated to web's head. It does NOT catch this
direction — a dropped column simply disappears from coord's extracted set once
the reads are gone. The ordering above is the control; the gate is not.

What is deliberately NOT dropped
---------------------------------

``idx_merge_decisions_tenant_executed_recent`` and
``coord.merge_decisions.executed``, both from ``pr_merge_10_rollout_state``. The
index's original justification was the ``shadow_vs_live_agreement_rate``
computation that Phase 5 deletes, but ``executed`` remains load-bearing far
beyond it (the SLO window aggregate still filters
``executed = true AND action = 'merge'``, and the engine writes it on every
decision), and the index still serves that scan. Dropping it would be an
unrelated performance change riding a schema retirement.

Downgrade is STRUCTURAL ONLY — and it makes a sibling downgrade lossy
----------------------------------------------------------------------

:func:`downgrade` re-creates both columns and both CHECK constraints, all-NULL.
**The values are gone and cannot be reconstructed** — nothing else in the schema
records which of ``dry_run`` / ``shadow`` / ``live`` a row held. That is stated
plainly rather than papered over.

📌 **The consequence reaches one revision back.** ``merge_enabled_01``'s
docstring says its own downgrade is lossless because ``merge_enabled`` is a pure
function of ``rollout_state`` plus ``coord.user_overrides``, "both of which
survive, so re-applying this revision reproduces them". **After this revision
applies, that is no longer true.** A downgrade past both revisions and back up
would find ``rollout_state`` all-NULL, so ``merge_enabled_01``'s backfill guard
(``merge_enabled IS NULL AND rollout_state IS NOT NULL``) matches nothing, every
row stays NULL, and every explicit ``merge_enabled = false`` — every deliberate
operator stop — silently becomes an inherit resolving to the enabled default.

That is not a reason to keep the column: it is the ordinary cost of retiring a
representation, and ``merge_enabled`` is now the source of truth rather than a
derived view. It IS a reason to treat a downgrade through this revision as a
data-loss event that needs the ``merge_enabled`` values dumped first.
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# Same channel the sibling data migrations report on, so the migrator
# container's logs carry this revision's blast radius.
logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = "merge_enabled_02"
down_revision: str = "coord_primary_trees_selfheal_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Read the posture being destroyed, BEFORE destroying it. Logged, never
# asserted: every outcome is legitimate, so none of it is a reason to fail a
# deploy. This is the only surviving record of what each row held — the
# downgrade cannot reconstruct it (see the module docstring).
_FINAL_PER_REPO_STATE_SQL = """
    SELECT rollout_state, count(*)
      FROM coord.tenant_repo_profiles
     GROUP BY rollout_state
     ORDER BY 1 NULLS LAST
"""

_FINAL_TENANT_STATE_SQL = """
    SELECT rollout_state, count(*)
      FROM coord.tenant_merge_settings
     GROUP BY rollout_state
     ORDER BY 1 NULLS LAST
"""

# The full (rollout_state × merge_enabled) cross-tab, recorded before the drop.
#
# ⚠️ There is deliberately NO "divergence" predicate here, and the reason is the
# whole point of Phase 1. It is tempting to flag rows where
# `(rollout_state = 'live') <> merge_enabled` as a posture change worth an alert
# — but that would fire on almost every row in the fleet and mean nothing.
# `merge_enabled_01` mapped `shadow → true` (the soak had no exit) and
# un-audited `dry_run → true` (plan F3: `dry_run` is what enrollment stamped, so
# it recorded "nobody touched this repo", not "somebody stopped it"). Per plan
# F1's histogram — 44 of 44 profile rows non-NULL, overwhelmingly the enrollment
# artifact — such a predicate would report the entire fleet as diverged while
# every one of those rows is exactly what Phase 1 intended.
#
# The two tokens are NOT one-to-one, and no single mapping is "correct": that
# ambiguity is precisely why Phase 1 needed audit markers to split `dry_run`.
# So this records the joint distribution and lets a future reader apply whatever
# mapping their question needs, instead of freezing one guess into an alert.
_CROSSTAB_SQL = """
    SELECT rollout_state, merge_enabled, count(*)
      FROM coord.tenant_repo_profiles
     GROUP BY rollout_state, merge_enabled
     ORDER BY 1 NULLS LAST, 2 NULLS LAST
"""


def upgrade() -> None:
    """Log the final posture, then drop both columns and their CHECKs."""

    bind = op.get_bind()

    # ------------------------------------------------------------------
    # 1. Record what is being destroyed. The downgrade cannot bring these
    #    values back, so the migrator log is the only artifact that will
    #    ever say what the fleet's last tri-state posture was.
    # ------------------------------------------------------------------
    for state, count in bind.execute(sa.text(_FINAL_PER_REPO_STATE_SQL)).fetchall():
        logger.info(
            "merge_enabled_02: FINAL tenant_repo_profiles.rollout_state=%s → %d row(s)%s",
            state,
            count,
            " (inherit)" if state is None else "",
        )
    for state, count in bind.execute(sa.text(_FINAL_TENANT_STATE_SQL)).fetchall():
        logger.info(
            "merge_enabled_02: FINAL tenant_merge_settings.rollout_state=%s → %d row(s)%s",
            state,
            count,
            " (inherit)" if state is None else "",
        )

    # The joint distribution, NOT a divergence alert — see `_CROSSTAB_SQL` for
    # why a divergence predicate would fire on the whole fleet and mean nothing.
    for state, enabled, count in bind.execute(sa.text(_CROSSTAB_SQL)).fetchall():
        logger.info(
            "merge_enabled_02: CROSSTAB rollout_state=%s merge_enabled=%s → %d row(s)",
            state,
            enabled,
            count,
        )

    # ------------------------------------------------------------------
    # 2. coord.tenant_repo_profiles.rollout_state
    # ------------------------------------------------------------------
    # The CHECK goes first and explicitly. Postgres would drop it with the
    # column anyway, but naming it keeps this revision the exact inverse of
    # `pr_merge_10_rollout_state` and keeps `downgrade` symmetric.
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            DROP CONSTRAINT IF EXISTS tenant_repo_profiles_rollout_state_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_repo_profiles
            DROP COLUMN IF EXISTS rollout_state
        """
    )

    # ------------------------------------------------------------------
    # 3. coord.tenant_merge_settings.rollout_state
    # ------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            DROP CONSTRAINT IF EXISTS tenant_merge_settings_rollout_state_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            DROP COLUMN IF EXISTS rollout_state
        """
    )

    logger.info(
        "merge_enabled_02: dropped rollout_state from coord.tenant_repo_profiles "
        "and coord.tenant_merge_settings. merge_enabled / merge_paused are now the "
        "only merge-enablement representation."
    )


def downgrade() -> None:
    """Re-create both columns + CHECKs, all-NULL. **Values are NOT restored.**

    Structural only. Nothing in the schema records which of
    ``dry_run`` / ``shadow`` / ``live`` a row held, so every re-created row reads
    NULL (= inherit). See the module docstring for the knock-on effect on
    ``merge_enabled_01``'s downgrade, which stops being lossless the moment this
    revision applies.
    """
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

    logger.warning(
        "merge_enabled_02 downgrade: rollout_state columns re-created ALL-NULL. "
        "The pre-drop values are unrecoverable, and merge_enabled_01's backfill "
        "will now match zero rows if it is re-run."
    )
