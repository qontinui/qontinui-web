"""coord.pr_check_runs — add head_branch so candidate CI is separable from PR-branch CI

Revision ID: prcheckruns_headbranch_01
Revises: design_policies_01
Create Date: 2026-07-27

``coord.pr_check_runs`` is keyed ``(repo, check_id)`` and joinable to PRs via
``(repo, head_sha)``, but it carries **no branch or ref column**. That makes a
merge-candidate head_sha indistinguishable from a PR-branch head_sha, which is
the root cause of a served-metric defect:

``coord_query_merge_economics``'s ``ci_wall_samples()``
(``qontinui-coord/src/pr_merge/economics.rs:272-306``) filters on ``repo`` ALONE,
so every ``candidate_ci_*`` field is computed over ALL head_shas — PR branches
included. Measured on qontinui-runner 2026-07-27T08:20:59Z: served
``candidate_ci_p90_secs = 15218.6`` (4h14m) against a TRUE population maximum of
6332s (105m32s) across all 11 real candidate runs that day — a p90 **2.40x the
population max**, which is arithmetically impossible for the population it names.
``candidate_ci_max_secs`` read 18420s (5h07m), 2.91x. Of 35 samples, only 11 were
candidate runs.

PR-branch shas inflate violently because the envelope is
``max(completed_at) - min(started_at)`` GROUPED BY head_sha: a PR head that sits
at one sha while checks are re-run hours later yields a single multi-hour
"run".

Everything derived from that p90 inherits the error — ``pressure``,
``candidate_ci_minutes_per_land``, ``suggested_stuck_threshold_secs`` (served
30437s = 8h27m), and train_health's ``stall_window_secs`` /
``stranded_threshold_secs`` (``train_health.rs:775`` reuses the same helper).
The stuck threshold is the operational cost: tooling is explicitly told to use it
INSTEAD of a fixed 45m, so an inflated value makes the stuck reflex blind rather
than conservative.

With ``head_branch`` on the row, coord filters ``head_branch LIKE
'merge-candidate/%'`` as a SINGLE-TABLE predicate.

## Why a column and not a join

``coord.ci_runs`` already stores ``head_branch`` beside ``head_sha``, and joining
it was the first design. It does NOT work, and the rejection is deliberate:

* ``coord.ci_runs`` is documented as **NOT the source of truth** — an in-flight
  liveness cache that ``coord_query_ci_state`` falls back to only on a live-read
  failure (``qontinui-coord/src/data/ci_runs.rs:33-40``).
* Its in-flight ingest arm writes ``head_sha: None``
  (``qontinui-coord/src/ci_runs_watcher.rs:926``) — precisely the join key. Only a
  bounded "most recent completed runs" backstop supplies one.
* Its ``(repo, head_branch)`` index is PARTIAL — ``WHERE status IN
  ('queued','in_progress')`` (``twin_ci_01_ci_runs.py:98``) — so it cannot serve a
  completed-row filter at all.

A join over that cache would silently DROP candidate shas whose row is absent or
NULL-keyed, converting a too-LARGE sample into a too-SMALL one — the same
silent-population defect, shipped as its cure. A column on the row being measured
cannot silently under-cover.

## Backfill posture

Rows written before this lands have ``head_branch IS NULL``. Consumers must NOT
treat NULL as "not a candidate" — that under-counts during the transition. Either
exclude NULLs from the sample and say so in the response's ``coverage_note``, or
wait one full window before trusting the percentiles. No backfill is attempted
here: the source (the ``check_run`` webhook's ``check_suite.head_branch``) is not
reachable from a migration, and the window self-heals within 24h of coord
populating the column.

## Deploy order

FREE in the safe direction: this migration is inert until coord writes the
column, and coord's write is additive. The coord-side consumer (populate at
ingest + filter in ``ci_wall_samples``) MUST land after this, per the
migration-consumer discipline — a consumer that reads a column the migration has
not created fails closed at query time.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX IF NOT
EXISTS`` (collision-safe against a canonical PG that already carries them), same
as the sibling ``gate_progress_samples_observed_idx_01`` revision. Additive only —
nullable column plus one index; no constraint changes, no rewrite, no
IMMUTABLE-predicate hazard.

The index is deliberately NOT partial: the query this exists for reads COMPLETED
rows, which is exactly what ``ix_ci_runs_inflight``'s in-flight predicate fails to
serve on the sibling table.

NOTE: ``revision`` / ``down_revision`` extend the single current head
(``design_policies_01``, verified on origin/main 2026-07-27) — at merge time this
revision must be RESERVED via the coord migration head-claim rather than
re-derived from a later ``alembic heads``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prcheckruns_headbranch_01"
down_revision: str | Sequence[str] | None = "design_policies_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.pr_check_runs
            ADD COLUMN IF NOT EXISTS head_branch TEXT
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_pr_check_runs_repo_head_branch
            ON coord.pr_check_runs (repo, head_branch)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.ix_pr_check_runs_repo_head_branch")
    op.execute("ALTER TABLE coord.pr_check_runs DROP COLUMN IF EXISTS head_branch")
