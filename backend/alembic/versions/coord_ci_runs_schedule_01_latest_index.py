"""coord.ci_runs: partial indexes for the scheduled-run observer's two reads.

Plan ``2026-09-30-a-red-scheduled-workflow-run-on-main-reaches-no-one`` Phase 1.

coord's ``scheduled_run_watcher`` raises a ``scheduled_run_red`` alert when the
latest conclusive ``schedule``-event run of a workflow on a repo's default
branch is red. It reads ``coord.ci_runs`` two ways, both over the constant
filter ``event = 'schedule' AND status = 'completed'``:

* the per-(repo, workflow) read on the ``workflow_run`` webhook path --
  ``WHERE repo = $ AND workflow_name = $ ... ORDER BY run_id DESC LIMIT 1``;
* the fleet-wide sweep every watcher tick -- ``DISTINCT ON (repo,
  workflow_name)`` over rows with ``observed_at`` inside a 7-day lookback.

``coord.ci_runs`` has no retention and, before this revision, only its primary
key plus the partial in-flight index ``ix_ci_runs_inflight`` (created by
``twin_ci_01_ci_runs``). Schedule runs are a large share of the table:
``gh run list --repo qontinui/qontinui-runner --event schedule --created
">=2026-09-22"`` counted 645 ``schemas pair-follow`` runs on 2026-10-06.

So two partial indexes, each carrying the observer's constant predicate:

* ``ix_ci_runs_schedule_latest`` ``(repo, workflow_name, run_id DESC)`` serves
  the per-(repo, workflow) read as an ordered index scan that its ``LIMIT 1``
  stops at the first row passing the remaining (heap) filters;
* ``ix_ci_runs_schedule_observed`` ``(observed_at)`` lets the sweep's lookback
  bound the rows it visits, instead of walking every schedule row ever
  recorded. The remaining filters (conclusion, branch) still run on the heap.

Both predicates are pure equalities over two columns and carry no
non-IMMUTABLE function, so Postgres accepts them as partial-index predicates.

The indexes are a performance optimisation, not a correctness dependency: the
coord reads are correct without them, so the two PRs carry no deploy-order
edge.

``CREATE INDEX CONCURRENTLY`` because ``coord.ci_runs`` is written on every
``workflow_run`` webhook; an in-transaction build would take a write-blocking
``SHARE`` lock. CONCURRENTLY cannot run inside a transaction, hence
``autocommit_block()`` (precedent: ``coord_pg_overload_idx_01``). Additive and
idempotent: ``IF NOT EXISTS`` / ``IF EXISTS``. A killed CONCURRENTLY build
leaves an INVALID index of the same name that ``IF NOT EXISTS`` would then
skip; drop it by hand and re-run if that ever happens.

Revision ID: coord_ci_runs_schedule_01
Revises: coord_smckpt_01_success_metric_checkpoint_results
Create Date: 2026-10-06
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runs_schedule_01"
down_revision: str | None = "coord_smckpt_01_success_metric_checkpoint_results"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: two CONCURRENTLY partial indexes. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_runs_schedule_latest
            ON coord.ci_runs (repo, workflow_name, run_id DESC)
            WHERE event = 'schedule' AND status = 'completed'
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_runs_schedule_observed
            ON coord.ci_runs (observed_at)
            WHERE event = 'schedule' AND status = 'completed'
            """
        )


def downgrade() -> None:
    """Drop both partial indexes. The table and its other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_ci_runs_schedule_observed"
        )
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.ix_ci_runs_schedule_latest")
