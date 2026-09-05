"""coord.primary_tree_branch_events — branch provenance for SHARED checkouts

Revision ID: ptbe_01_primary_tree_branch_events
Revises: reqchk_walk_01
Create Date: 2026-09-02

Phase 2 (web migration) of plan
``2026-08-28-shared-checkout-branch-provenance-and-reclaim-signal``.

Why this table exists
=====================

``coord.agent_worktrees`` records provenance for work done in an ALLOCATED
worktree: which session made the branch, which plan it belongs to, and — since
``twin_p6_01_worktree_reclaim_lifecycle`` — which reclaim signal fired on it.
A branch cut in a **shared primary checkout** has none of that. ``coord.primary_trees``
holds exactly one row per ``(device_id, repo)`` — the LATEST observed branch,
overwritten on every publisher tick — so the moment a shared checkout moves off
a branch, every trace that the branch was ever cut there is gone. Nothing can
attribute it to a session, and the reclaim engine has no signal to act on.

This table is the append-only counterpart: one row per observed branch
CREATION in a shared checkout, plus a terminal-outcome stamp written later when
the branch's PR reaches a terminal state. ``primary_trees`` stays the "what is
checked out right now" upsert; this is the "what was cut here, and how did it
end" log.

Schema
======

* ``id UUID PRIMARY KEY`` — surrogate key. ``DEFAULT gen_random_uuid()``
  matches ``coord.pr_events.event_id`` (``pr_merge_01_pr_state_extensions``);
  writers may still supply their own id.
* ``tenant_id UUID NOT NULL`` — owning tenant. See "tenant_id" below.
* ``device_id UUID NOT NULL`` — the machine whose shared checkout the branch
  was cut in. FK ``coord.devices(device_id) ON DELETE CASCADE``, exactly as
  ``coord.primary_trees`` does: a deregistered device's provenance rows go with
  it, since the checkout they describe no longer exists.
* ``repo TEXT NOT NULL`` — bare repository name, e.g. ``qontinui-runner``.
  Same spelling as ``primary_trees.repo`` and ``repo_branches.repo``.
* ``branch TEXT NOT NULL`` — the branch that was created.
* ``agent_session_id TEXT`` — nullable, SELF-REPORTED, best-effort. The
  checkout guard observes a branch creation from inside whatever session
  happens to run the git op; that session names itself, and coord cannot
  verify the claim. NULL means "no session identified itself", which is a
  normal outcome (a hand-typed ``git checkout -b`` at a terminal), NOT an
  error. Deliberately TEXT rather than UUID + FK: an unverifiable,
  possibly-absent claim must never be able to fail an insert, and a foreign
  key would turn a stale or malformed id into a lost provenance row — the
  fact this table exists to preserve.
* ``created_via TEXT NOT NULL`` — how the creation was observed. See
  "created_via ships with exactly one value" below.
* ``observed_created_at TIMESTAMPTZ NOT NULL DEFAULT now()`` — when the
  guard observed the creation (server clock).
* ``terminal_outcome TEXT`` — nullable; NULL means NOT YET TERMINAL. See
  "terminal_outcome" below for both the no-CHECK posture and the vocabulary.
* ``terminal_pr_number INTEGER`` — the PR whose terminal state produced the
  stamp. Nullable for the same reason as ``terminal_outcome``, and no FK:
  ``coord.repo_branches`` is keyed by ``(repo, branch)``, not by PR number, so
  there is nothing to reference.
* ``terminal_observed_at TIMESTAMPTZ`` — when the terminal state was observed.

``terminal_outcome`` carries NO CHECK constraint — deliberate
==============================================================

It mirrors ``coord.agent_worktrees.trigger_signal``, which
``twin_p6_01_worktree_reclaim_lifecycle.py:28`` declares as "Free-form TEXT (no
CHECK) so new signal kinds in later phases don't need a migration — matches the
``coord.*`` TEXT-enum posture (cf. ``pr_events.event_kind``)". The same reason
applies here: the vocabulary is owned by the Rust reader, and adding a value
must not require a schema change in another repo.

``terminal_outcome`` values are ``landed`` / ``closed_unmerged`` — NOT ``pr_merged`` / ``pr_closed``
====================================================================================================

**This is the single most important line in this migration.** The vocabulary
mirrors ``TerminalPrOutcome`` in
``qontinui-coord/crates/coord/src/data/repo_branches.rs:4384`` — its two
variants ``Landed`` / ``ClosedUnmerged``, lowercased.

``landed`` means the PR's work is ON TRUNK, and its predicate is

    pr_state = 'merged'  OR  close_cause = ANY(PR_LAND_CAUSES)

— NOT ``pr_state = 'merged'`` alone. coord FAST-FORWARD-LANDS the repos it
orchestrates, and GitHub closes the majority of coord's own lands with
``merged == false`` / ``pr_state = 'closed'``. Measured 2026-09-02: **15 of the
15 most recent closed ``qontinui-coord`` PRs carry ``mergedAt: null``.** A
merged-vs-closed split — the ``pr_merged`` / ``pr_closed`` spelling — would
therefore mislabel every one of those lands as an abandoned branch, re-creating
exactly the land-blindness that bug plan
``2026-08-01-coord-land-blind-readers-cannot-see-ff-lands`` (SHIPPED
2026-08-08) closed, and handing the Phase-4 sweep a reclaim signal that is
wrong on the common case rather than the rare one.

The land vocabulary itself is CONSUMED from
``crate::data::repo_branches::PR_LAND_CAUSES``
(``= ["merged", "commits_landed_via_other_pr"]``) rather than re-spelled — a
divergent copy of that list is the whole defect class. Readers of this column
must not re-derive the predicate from ``pr_state`` themselves.

``created_via`` ships with exactly ONE value
=============================================

``'checkout_guard_observed'`` — the checkout guard is the only writer this plan
lands. The column is TEXT (same no-CHECK posture as ``terminal_outcome``) so a
second observation path can be added later without a migration, but **no second
value is introduced here**. In particular there is no ``manual_report`` value:
a value with no writer is precisely the ``coord.agent_worktrees.work_unit_id``
failure — a column that sat in the schema from 2026-06-26 with no writer at all
until plan ``2026-08-16-plan-corpus-authority-and-run-provenance`` finally wired
one up. Add the value with the writer, not before it.

``tenant_id`` — NOT NULL, resolved server-side, and no FK
=========================================================

NOT NULL, resolved server-side from the writing DEVICE, the way
``coord.pr_events`` resolves it rather than accepting it as an argument
(``pr_merge_01_pr_state_extensions``): a tenant-blind caller cannot write this
table, and the route errors instead of default-filling.

No FK to ``coord.tenants``, following the NOT-NULL siblings
(``coord_agent_status``, ``coord_findings``, ``agent_action_reports_01``,
``coord_memory_anchor_obs``) rather than ``pr_events``. ``pr_events`` can carry
one only because its ``tenant_id`` is NULLABLE with ``ON DELETE SET NULL``;
that shape is unavailable to a NOT NULL column, and the alternative
(``ON DELETE CASCADE`` from tenants) would delete provenance history as a side
effect of tenant administration.

Indexes
=======

* ``idx_ptbe_device_repo_observed`` on ``(device_id, repo, observed_created_at
  DESC)`` — the "latest event for this checkout" read, the same shape as
  ``idx_primary_trees_device`` and ``idx_pr_events_repo_pr_created``: the
  current-state lookup lands on one row rather than scanning a device's
  history.
* ``idx_ptbe_open`` on ``(repo, branch) WHERE terminal_outcome IS NULL`` — the
  Phase-4 sweep's hot path. The sweep asks "which observed branches have not
  yet reached a terminal state", and the partial predicate keeps the index
  proportional to the OPEN set rather than to the full append-only log, which
  only grows.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``, with a
  symmetric ``downgrade()`` dropping indexes then table — the ``coord.*``
  house style (cf. ``coord_primary_trees``, ``agent_action_reports_01``).
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). There is no Rust
  ``CREATE``/``ALTER`` self-heal for this table; coord only INSERTs, UPDATEs
  and SELECTs it.
* This table is NOT in coord's ``CRITICAL_BOOT_TABLES`` allowlist
  (``schema_manifest.rs``), so if this revision has not been applied coord
  BOOTS and degrades the dependent routes to ``503 schema_migration_pending``
  rather than refusing to start. coord and this migration may therefore land in
  either order without a boot crash-loop.

Chaining
========

``down_revision = "reqchk_walk_01"`` -- an UNLANDED sibling, deliberately, and
the one thing about this file a later reader must not mistake for the usual
"whatever main's head was when I authored".

The original parent was ``require_review_cols_01``, the single head at
authoring time. On 2026-09-05 at 16:05Z ``main`` landed
``coord_agent_questions_audience_backfill`` off that same parent, which forked
this chain -- and forked qontinui-web #1210 and #989 with it, since all three
had declared the identical token. Three unlanded siblings of one parent cannot
all be re-pointed at ``main``'s head: alembic's single-head invariant is a
total order, so re-pointing them all at the same landed revision only re-forks
the moment the first of them lands.

So the three were chained in a stated landing order instead --
**#1210 -> #1218 -> #989** -- and this revision takes the middle position.
``reqchk_walk_01`` is qontinui-web **#1210**, which must land FIRST. Until it
does, ``alembic-heads-pr`` on this PR is RED BY CONSTRUCTION (the parent named
here does not exist in any tree yet, so ``ptbe_01`` and ``main``'s head both
read as heads); it turns green on its own, with no further edit, once #1210
lands. That red is also the safety property: it is what stops this PR landing
out of order and leaving ``main`` with a dangling ``down_revision``.

Nothing is reserved. ``alembic-graph-pr.yml`` gates any fork that results, and
``scripts/ci/notify_forked_open_prs.py`` comments the exact token to adopt if a
future land forks this chain again.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ptbe_01_primary_tree_branch_events"
down_revision: str = "reqchk_walk_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.primary_tree_branch_events`` + its two indexes. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.primary_tree_branch_events (
            id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            -- NOT NULL, resolved server-side from the device (the coord.pr_events
            -- idiom). No FK to coord.tenants: that requires a nullable column with
            -- ON DELETE SET NULL, and cascading tenant deletes would erase
            -- provenance history.
            tenant_id            UUID        NOT NULL,
            device_id            UUID        NOT NULL
                REFERENCES coord.devices(device_id) ON DELETE CASCADE,
            repo                 TEXT        NOT NULL,
            branch               TEXT        NOT NULL,
            -- Nullable, self-reported, best-effort. TEXT and no FK on purpose:
            -- an unverifiable claim must never fail the insert or lose the row.
            agent_session_id     TEXT,
            -- Exactly one value today: 'checkout_guard_observed'. No CHECK, and
            -- no second value without a writer (the agent_worktrees.work_unit_id
            -- failure).
            created_via          TEXT        NOT NULL,
            observed_created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- 'landed' | 'closed_unmerged'; NULL = not yet terminal.
            -- NO CHECK, mirroring agent_worktrees.trigger_signal, so a new
            -- outcome kind needs no migration.
            -- 'landed' is pr_state='merged' OR close_cause = ANY(PR_LAND_CAUSES) --
            -- NOT a merged-vs-closed split, which would mislabel every coord
            -- fast-forward land as abandoned (see the docstring).
            terminal_outcome     TEXT,
            terminal_pr_number   INTEGER,
            terminal_observed_at TIMESTAMPTZ
        )
        """
    )
    # "Latest event for this checkout" read.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ptbe_device_repo_observed
            ON coord.primary_tree_branch_events
               (device_id, repo, observed_created_at DESC)
        """
    )
    # Phase-4 sweep's hot path: the not-yet-terminal set only, so the index
    # stays proportional to the OPEN rows rather than to the append-only log.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ptbe_open
            ON coord.primary_tree_branch_events (repo, branch)
            WHERE terminal_outcome IS NULL
        """
    )


def downgrade() -> None:
    """Drop ``coord.primary_tree_branch_events`` and its indexes."""
    op.execute("DROP INDEX IF EXISTS coord.idx_ptbe_open")
    op.execute("DROP INDEX IF EXISTS coord.idx_ptbe_device_repo_observed")
    op.execute("DROP TABLE IF EXISTS coord.primary_tree_branch_events")
