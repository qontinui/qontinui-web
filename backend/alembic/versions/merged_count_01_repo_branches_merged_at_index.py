"""Index coord.repo_branches for the recently-merged PR window

``d7e8f9a0b1c2`` added ``merge_commit_sha`` + ``merged_at`` but no index, so
every "which PRs landed in the last N hours?" read sequentially scans
``coord.repo_branches``. Two coord reads run that predicate:

* ``query_recently_merged_prs`` — the fleet page's "Merged" tab rows.
* ``count_recently_merged_prs`` — the cheap count that labels that tab, which
  now rides the dashboard's hot poll (every open dashboard, every poll gap).

The partial index matches both predicates exactly: they filter
``merge_commit_sha IS NOT NULL AND merged_at > now() - <window>``, and the
partial WHERE keeps the index to landed rows only — a small fraction of the
table, since every open PR row and every pre-``d7e8f9a0b1c2`` row has NULL
there. ``merged_at DESC`` matches the newest-first window scan.

``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``), following
``coord_pg_overload_idx_01``: ``coord.repo_branches`` is UPSERTed by every
``pull_request`` webhook, so an in-transaction build would take a
write-blocking ``SHARE`` lock across the build. CONCURRENTLY cannot run inside
a transaction, hence ``op.get_context().autocommit_block()``. On a CI fresh DB
the table is tiny and the build is instant. Additive / forward-only:
``upgrade`` creates ``IF NOT EXISTS``, ``downgrade`` drops ``IF EXISTS``.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens, ``DROP
INDEX`` the invalid index manually and re-run.

Chain position: this revision is the SECOND link of a three-PR linear chain
authored 2026-07-26 to clear the ``alembic-heads-pr`` gate on three PRs that had
each forked the chain (the original ``down_revision``,
``dry_run_retire_02_drop_bools``, already had a child — ``coord_prompt_docs_02``
— on main):

    coord_sm_to_handle            (main head)
      -> coord_footprint_drift_events   (PR #789)
      -> merged_count_01_merged_at_idx  (this revision, PR #861)
      -> design_policies_01             (PR #706)

The three have NO data dependency on one another (distinct tables in distinct
schemas), so the order is purely a landing order. It is self-enforcing, which is
why no coord dep labels are needed (and per fleet policy must not be added) —
the ``down_revision`` chain IS the ordering.

READ THIS BEFORE "FIXING" A RED CHECK ON THIS PR. Until PR #789 lands
``coord_footprint_drift_events`` on main, this branch's tree does not contain
that parent, and the checks below are EXPECTED to be red. They go green on their
own once #789 lands and this branch is rebased (coord's dry-rebase +
``merge-candidate/**`` push re-runs them). Nothing here needs a code change:

* ``alembic-heads-pr`` — reports two heads (``coord_sm_to_handle`` and this
  one). This is the honest message and matches the gate's own guidance.
* ``Migration Reversal Gate`` / ``Spec CI`` / ``Backend E2E Tests`` — these run
  real ``alembic heads`` / ``alembic upgrade head``, and alembic does NOT report
  an extra head for a parent that is absent: it raises a ``KeyError`` naming the
  missing parent revision during revision-map construction, and exits non-zero
  with EMPTY stdout. (Do not paste that traceback line back into this docstring
  as a quoted literal — gitleaks' ``generic-api-key`` rule reads ``KeyError``
  followed by a quoted high-entropy token as a secret and reds the
  ``Gitleaks Secret Detection`` check.) ``migration-reversal.yml``'s
  skip-on-multi-head guard therefore does not fire (it computes ``HEADS`` from
  stdout, which is empty, so it sees 0 — not >1) and the job falls through to
  ``alembic upgrade head`` and crashes. The red reads like a broken migration;
  it is not. Hardening that guard to also skip on a non-zero ``alembic heads``
  exit is a separate workflow fix, deliberately not bundled into this PR.

The target table ``coord.repo_branches`` and its ``merged_at`` /
``merge_commit_sha`` columns (``d7e8f9a0b1c2``) are already on main, well
upstream of ``coord_sm_to_handle``, so re-parenting does not change what this
index needs in place.

Revision ID: merged_count_01_merged_at_idx
Revises: coord_footprint_drift_events
Create Date: 2026-07-24

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "merged_count_01_merged_at_idx"
down_revision: str | None = "coord_footprint_drift_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_repo_branches_merged_at
            ON coord.repo_branches (merged_at DESC)
            WHERE merge_commit_sha IS NOT NULL
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_repo_branches_merged_at"
        )
