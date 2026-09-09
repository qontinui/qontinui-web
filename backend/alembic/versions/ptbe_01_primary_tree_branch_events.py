"""coord.primary_tree_branch_events — branch provenance for SHARED checkouts

Revision ID: ptbe_01_primary_tree_branch_events
Revises: remote_attach_01
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

``down_revision = "remote_attach_01"`` -- ``main``'s single alembic head,
measured 2026-09-09 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``, ``HEAD=remote_attach_01``).

This parent has been re-pointed twice, and the history matters because the
second re-point invalidated the first one's reasoning. It was
``require_review_cols_01``, the single head at authoring time; on
2026-09-05T15:02:53Z ``main`` landed ``coord_agent_questions_audience_backfill``
(commit ``f8a1fe821``) off that same node and forked six open PRs at once, so the six were chained in a stated
landing order behind qontinui-web #1210 (``reqchk_walk_01``). Two of those six
have since LANDED -- #1210 (``reqchk_walk_01``) and #1216
(``fleet_res_tel_05_socket_census``) are both on ``main`` now -- and ``main``
moved nine further revisions past ``reqchk_walk_01``, ending at
``remote_attach_01``. That re-forked the chain at its root: a parent that has
landed but is no longer the head forks just as surely as one that has not
landed at all.

This revision is now the HEAD-CHILD, and the four remaining open PRs (five
revisions -- #989 carries two) are chained behind it in one total order:

    remote_attach_01                            (main's head)
      -> ptbe_01_primary_tree_branch_events     (#1218 -- this revision)
      -> devenv_09_auto_enrollment              (#989)
      -> devenv_10_unique_active_coord_device   (#989)
      -> policy_rules_tombstone_01              (#1269)
      -> oplog_age_idx_01                       (#1272)
      -> pdtier_03                              (#1180)

Alembic's single-head invariant is a TOTAL ORDER, so only ONE open PR can be
the head-child at a time; re-pointing all five at ``main``'s head only re-forks
them the instant the first lands. Chaining is the only shape that serialises
them, and the tail order is deliberate: ``pdtier_03`` (#1180) is last because it
is the only revision here that drops a COLUMN and the only one that can
``RAISE EXCEPTION`` and abort mid-upgrade, so a refusal there halts nothing but
itself. (``devenv_10`` also drops something -- a now-redundant index -- but that
is reversible and loses no data.)

The consequence, stated so a later reader does not mistake it for a defect:
every revision BELOW this one names a parent that exists in no tree yet, so
alembic cannot build its revision map there at all (``KeyError: '<parent>'``).
That reds MORE than the head counter on #989, #1269, #1272 and #1180 -- it reds
``alembic-heads-pr``, Spec CI's ``Run database migrations`` (``alembic upgrade
heads``) and the ``_needs_pg`` migration-harness tests alike. All of it is RED
BY CONSTRUCTION and goes green on its own, with no further edit, as the
revisions ahead of it land. (``migration-reversal.yml`` is the one lane that is
unaffected: it detects the unresolvable-parent shape and skips-and-passes.)
That red is the safety property -- it is what stops an out-of-order land leaving
``main`` with a dangling ``down_revision``. THIS revision is the one that is
green now, because its parent is the one on ``main``.

Nothing is reserved. ``alembic-graph-pr.yml`` gates any fork that results, and
``scripts/ci/notify_forked_open_prs.py`` comments the exact token to adopt if a
future land forks this chain again.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ptbe_01_primary_tree_branch_events"
down_revision: str = "remote_attach_01"
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
