"""coord — repair continuation_delivery_mode + add post-merge-followup scope columns

Revision ID: pmf_scope_cols_01
Revises: coord_wusod_01
Create Date: 2026-09-01

Plan 2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind (Phase 1).

Adds THREE nullable columns to ``coord.tenant_repo_profiles``. One of them is a
REPAIR of an already-shipped-but-unbacked feature; the other two are the new
surface this plan needs. Reading them as one homogeneous "new columns" batch
would misread the first, so they are named apart below.

1. ``continuation_delivery_mode``  TEXT  — **REPAIR, not new surface.**
   ---------------------------------------------------------------------
   coord has been READING this column since plan
   ``2026-06-21-in-session-continuation-delivery`` shipped, and **no migration
   was ever written for it**. Five coord consumers call
   ``continuation_delivery::get_continuation_delivery_mode`` — which issues
   ``SELECT continuation_delivery_mode FROM coord.tenant_repo_profiles`` —
   and every one of them has been failing open to the default ever since:

       qontinui-coord/crates/coord/src/next_step.rs:1650
       qontinui-coord/crates/coord/src/next_step.rs:1738
       qontinui-coord/crates/coord/src/expectation_reclaim.rs:407
       qontinui-coord/crates/coord/src/pr_merge/stuck_author_nudge.rs:824
       qontinui-coord/crates/coord/src/pr_merge/engine.rs:1258

   The operator write door (``PUT`` / ``GET`` on
   ``fleet_policy::{put,get}_continuation_delivery_mode``, routed at
   ``routes.rs:3754``) is likewise inert: its UPSERT
   (``next_step.rs:4908``) is itself gated on an ``information_schema``
   existence probe (``next_step.rs:4895``) that has never once returned true.
   coord's own read contract records the gap as a waiver —
   ``schema_read_contract.rs:435``, "read ships ahead of its web migration".

   Evidence that the column has NEVER existed (reconciled 2026-09-01). A full
   replay of every migration in this tree that touches
   ``coord.tenant_repo_profiles`` — ``op.add_column`` AND raw
   ``ALTER TABLE``, upgrade halves only — predicts exactly **17** columns:

       pr_merge_02_tenant_settings      CREATE TABLE, 11 cols        -> 11
       pr_merge_10_rollout_state        + rollout_state              -> 12
       cred_threshold_cols_01           + credibility_..._override   -> 13
       blast_radius_gate_cols_01        + blast_radius_..._override  -> 14
       layering_gate_cols_01            + layering_..._override      -> 15
       auto_fix_red_main_01             + auto_fix_red_main          -> 16
       auto_fix_rm_flaky_01             + auto_fix_red_main_flaky    -> 17
       cfgyaml01                        + config_yaml_overrides      -> 18
       ffland_headsync_01               + ff_land_head_sync_enabled  -> 19
       merge_enabled_01                 + merge_enabled              -> 20
       drop_line_budget_columns_01      - line_budget_override       -> 19
       dry_run_retire_02                - dry_run_override           -> 18
       merge_enabled_02                 - rollout_state              -> 17

   (``presetsrc01`` touches the table but only rewrites the
   ``profile_source`` CHECK, so it moves no column.) The live RDS catalog
   reports exactly **17** columns for the table — 17 predicted, 17 observed,
   **zero residual**. There is no out-of-band column hiding in the delta, so
   ``continuation_delivery_mode`` was never applied by any path. A future
   reader must not mistake this column for new surface introduced by the
   post-merge-followup plan: it backs a feature that has been half-shipped
   for over two months.

2. ``post_merge_followup_scope``       TEXT    — new (this plan).
3. ``post_merge_followup_code_paths``  TEXT[]  — new (this plan).
   ---------------------------------------------------------------------
   Per-(tenant, repo) control over which merged PRs are worth spawning a
   post-merge follow-up session for. ``post_merge_followup_scope`` carries the
   vocabulary ``all`` | ``code_only`` | ``none``; absent/NULL reads as ``all``,
   which is exactly today's repo-and-content-blind behaviour.
   ``post_merge_followup_code_paths`` holds globset patterns naming the
   oracle-bearing paths that make a PR "code" for the ``code_only`` arm; it is
   only consulted under that arm.

   No CHECK constraint on the scope vocabulary. The token set is a coord-side
   product decision that will move (the plan's own later phases may widen it),
   and a DB CHECK would then need a lockstep web migration to unblock a coord
   deploy — the exact coupling the three-tier settings substrate avoids
   everywhere else on this table. coord validates the token at its write door
   and falls back to ``all`` on anything it does not recognise, so an
   unparseable value degrades to today's behaviour rather than to an error.

Behaviour-neutrality (load-bearing)
-----------------------------------
All three columns are NULLABLE with **no backfill and no server default**.
Every existing row therefore reads NULL on all three, and NULL is defined at
each consumer as "the behaviour that already ships":

  - ``continuation_delivery_mode`` NULL -> coord's existing default delivery
    mode, i.e. precisely what all five consumers get TODAY from the failing
    read. Landing this migration changes nothing until an operator writes a
    value; it only makes the write door reachable.
  - ``post_merge_followup_scope`` NULL -> ``all`` -> spawn as today.
  - ``post_merge_followup_code_paths`` NULL -> unconsulted while scope is
    ``all``.

So this migration is inert on the live fleet at apply time. It is opt-in
storage plus one repair, never a behaviour change.

Decoupled deploy order: coord reads all three via SEPARATE, best-effort
queries (not folded into the main resolver SELECT), and each falls through to
its default when the column is absent — the ``continuation_delivery_mode``
reader has been doing exactly that in production since 2026-06-21. So there is
no coord<->web deploy-ordering constraint in either direction for this
migration.

Idempotency: column adds are guarded by an inspector check (skip
``add_column`` if the column already exists), symmetric in ``downgrade()``.
That guard is what makes the ``continuation_delivery_mode`` add correct
whether or not it was ever applied out of band — the 17/17 reconciliation says
it was not, but the guard does not depend on that conclusion being right.
Re-running against an already-migrated DB is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pmf_scope_cols_01"
down_revision: str = "coord_wusod_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the three per-repo columns (all nullable, no default, no backfill)."""

    # 1. REPAIR: the column five coord consumers have read since 2026-06-21.
    if not _has_column("tenant_repo_profiles", "continuation_delivery_mode"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column("continuation_delivery_mode", sa.Text(), nullable=True),
            schema="coord",
        )

    # 2. New: post-merge follow-up spawn scope. NULL reads as 'all'.
    if not _has_column("tenant_repo_profiles", "post_merge_followup_scope"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column("post_merge_followup_scope", sa.Text(), nullable=True),
            schema="coord",
        )

    # 3. New: globset patterns naming the oracle-bearing paths that make a PR
    #    "code" for the 'code_only' arm of the scope above.
    if not _has_column("tenant_repo_profiles", "post_merge_followup_code_paths"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column(
                "post_merge_followup_code_paths",
                postgresql.ARRAY(sa.Text()),
                nullable=True,
            ),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the three columns (reverse order), same guard as ``upgrade()``."""

    if _has_column("tenant_repo_profiles", "post_merge_followup_code_paths"):
        op.drop_column(
            "tenant_repo_profiles",
            "post_merge_followup_code_paths",
            schema="coord",
        )

    if _has_column("tenant_repo_profiles", "post_merge_followup_scope"):
        op.drop_column(
            "tenant_repo_profiles",
            "post_merge_followup_scope",
            schema="coord",
        )

    if _has_column("tenant_repo_profiles", "continuation_delivery_mode"):
        op.drop_column(
            "tenant_repo_profiles",
            "continuation_delivery_mode",
            schema="coord",
        )
