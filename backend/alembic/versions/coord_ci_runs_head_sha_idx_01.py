"""coord.ci_runs: index on (repo, head_sha) for the merge train's per-tick read.

Plan ``2026-11-08-coord-lands-and-deploys-trees-no-required-ci-proved`` Phase 1.

coord's merge train is gaining a per-tick query that reads every CI run
recorded for one commit::

    SELECT workflow_name, head_branch, status, conclusion, observed_at
      FROM coord.ci_runs
     WHERE repo = $1 AND head_sha = $2

``coord.ci_runs`` has no retention, and none of its indexes covers
``head_sha``: the primary key ``(repo, run_id)``, the partial in-flight index
``ix_ci_runs_inflight`` (``twin_ci_01_ci_runs``), and the two schedule-run
partial indexes ``(repo, workflow_name, run_id DESC)`` / ``(observed_at)``
(``coord_ci_runs_schedule_01``). Without this index the read walks every row
ever recorded for the repo via the primary key, once per candidate per tick,
and that cost only grows.

``ix_ci_runs_repo_head_sha`` ``(repo, head_sha)`` turns it into an equality
index scan over the handful of runs a single commit has. Not partial: the read
filters on neither ``status`` nor ``event``.

Mechanics
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY`` inside ``autocommit_block()``: ``coord.ci_runs``
is written on every ``workflow_run`` webhook, and an in-transaction build would
take a write-blocking ``SHARE`` lock. Additive (no data is changed): ``upgrade``
creates the index ``IF NOT EXISTS``, ``downgrade`` drops it ``IF EXISTS``. The
coord read is correct, only slower, without it, so deploy order is not
load-bearing for correctness.

A killed or failed build leaves an INVALID index of the same name, which
``IF NOT EXISTS`` alone would skip and report as success. ``upgrade`` therefore
checks ``indisvalid`` first and, when the index is INVALID, drops it
``CONCURRENTLY`` before the ``CREATE`` rebuilds it, so re-running alembic
(``stamp`` to the parent, then ``upgrade``) repairs a failed build. A VALID
index is left untouched. To check after a deploy::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'ix_ci_runs_repo_head_sha';

A live build also reads ``false``: wait until ``pg_stat_progress_create_index``
is empty before re-running. Never repair by hand with a plain ``DROP INDEX``:
its ACCESS EXCLUSIVE lock queues behind any long reader and stalls every coord
read and write on the table behind it.

Revision ID: coord_ci_runs_head_sha_idx_01
Revises: repair_rerun_01_partial_idx
Create Date: 2026-11-09
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runs_head_sha_idx_01"
down_revision: str | None = "repair_rerun_01_partial_idx"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Additive: one CONCURRENTLY index. Idempotent, and repairs a failed build."""
    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid("ix_ci_runs_repo_head_sha"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_ci_runs_repo_head_sha"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook statically checks that every CREATE/DROP names its
        # schema.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_runs_repo_head_sha
            ON coord.ci_runs (repo, head_sha)
            """
        )


def downgrade() -> None:
    """Drop the index. The table and its other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.ix_ci_runs_repo_head_sha")
