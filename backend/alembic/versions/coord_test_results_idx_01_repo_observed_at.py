"""coord.test_results: a ``(repo, observed_at DESC)`` index for the newest-rows reads.

What changed, and why the existing indexes stopped being enough
------------------------------------------------------------------------------
``coord.test_results`` is the per-test outcome oplog that
``POST /coord/test-results/ingest`` appends to. Since qontinui-runner#1306
(2026-09-07) that repo's CI posts every test of every matrix leg — measured
2026-09-12: ~11,100 rows per leg, two legs, ~80 runs a day, so ~1.7M rows a
day from ONE producer into a table that, before this producer existed, already
carried the schema's largest never-scanned index (``idx_test_results_observed_at``,
428 MB on 2026-08-07 — see ``coord_alerts_dropmachineidx_01``, "Not actioned
here").

Its reader for flakiness priors, ``test_run_effects::load_result_history``
(also on the ``POST /coord/test-runs/declare`` duration-prediction path),
ranked EVERY row of the repo with a window function::

    SELECT … row_number() OVER (PARTITION BY test_id ORDER BY observed_at DESC)
      FROM coord.test_results WHERE repo = $1

That sort does not depend on the window asked for, so once the partition
passed a few million rows every call for ``qontinui/qontinui-runner``
answered ``history_read: failed`` at exactly 60.3 s — coord's
``statement_timeout``. Measured 2026-09-12, three calls, windows 20 / 1 / 3.

The coord-side fix (qontinui-coord, same follow-up) bounds the read to the
newest ``window`` heads before ranking. Finding those heads is a walk back
through the repo's most recent rows::

    SELECT head_sha FROM coord.test_results
     WHERE repo = $1 AND head_sha IS NOT NULL
     ORDER BY observed_at DESC LIMIT $2          -- $2 ≈ window × rows-per-head

and the newest row is the same statement with ``LIMIT 1``.

Why the existing indexes cannot serve that shape
------------------------------------------------------------------------------
The table has ``(repo, test_id)``, ``(repo, head_sha)``, a partial
``(correlation_id)`` and a bare ``(observed_at)``. For
``WHERE repo = $1 ORDER BY observed_at DESC LIMIT n`` the planner's only
ordered option is the bare ``observed_at`` index walked backwards with
``repo`` applied as a residual filter on every visited row. For the DOMINANT
writer that is nearly free (almost every recent row is its own). For a QUIET
repo it is the opposite: the walk has to step over every other repo's newer
rows before it finds ``n`` of its own — at ~1.7M rows a day of runner output,
a repo that last posted two days ago pays a ~3.5M-row walk to find its newest
row, on a path ``declare`` runs for every declared test run. The alternative
plan, ``(repo, test_id)`` plus a full sort, is the shape that already times
out.

``(repo, observed_at DESC)`` makes both statements an ordered index range
scan on the repo prefix that stops after ``n`` rows, for every repo, whatever
the others are writing. Same construction as
``idx_pr_events_tenant_reason_created`` in ``coord_pg_overload_idx_02``: the
equality-bound column leads, the ordering column trails, ``ORDER BY … LIMIT``
becomes an early-terminating scan with no sort node.

What this deliberately does NOT do
------------------------------------------------------------------------------
* It does not drop the bare ``idx_test_results_observed_at``. That index is
  what serves the retention sweep's batch selector
  (``DELETE … WHERE observed_at < cutoff ORDER BY observed_at LIMIT 5000``,
  ``table_retention::prune_test_results`` in the same coord follow-up), which
  is repo-agnostic and cannot use a ``repo``-led prefix. The 2026-08-07
  finding that it was never scanned predates BOTH readers.
* It does not replace ``(repo, head_sha)``; the second half of the bounded read
  (``WHERE repo = $1 AND head_sha = ANY($3)``) is served by that one.

Ordering against coord: SOFT. The coord read works without this index; it is
merely slow for quiet repos. Nothing in coord references the index by name.
The coord side is the qontinui-coord PR titled "coord: batch the test-results
ingest, bound the flakiness read, retain 14 days" (same follow-up), which
cites this revision.

Chained off ``plan_library_05_scan_root_observations`` — the head on
``origin/main`` at authoring time, NOT the head of this branch's own tree
(``claude_acct_01``), which a peer's revision had already taken while this
one was being written. ``scripts/ci/count_alembic_heads.py`` counts heads on
the MERGE, which is the only count that matters.

``CREATE INDEX CONCURRENTLY``, in an ``autocommit_block`` — the same reasons
and the same precedent as ``coord_pg_overload_idx_02``: a hot append-heavy
table under live write load, and an in-transaction build would take a
write-blocking ``SHARE`` lock for the whole build. Additive / forward-only /
expand-only: ``upgrade`` creates ``IF NOT EXISTS``; ``downgrade`` drops
``IF EXISTS``. No table or column is altered.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens,
manually ``DROP INDEX`` the invalid index and re-run.

Revision ID: coord_test_results_idx_01
Revises: plan_library_05_scan_root_observations
Create Date: 2026-09-12

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_results_idx_01"
down_revision: str | Sequence[str] | None = "plan_library_05_scan_root_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY composite index. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_test_results_repo_observed_at
            ON coord.test_results (repo, observed_at DESC)
            """
        )


def downgrade() -> None:
    """Reverse the additive index. Table + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_test_results_repo_observed_at"
        )
