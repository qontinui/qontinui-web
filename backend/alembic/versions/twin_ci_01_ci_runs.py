"""twin Ξ_CI — coord.ci_runs (in-flight workflow-run liveness)

Revision ID: twin_ci_01_ci_runs
Revises: cognito_legacy_auth_teardown_02
Create Date: 2026-05-31

Phase 2a of the Digital-Twin CI-State layer
(``D:/qontinui-root/plans/2026-05-30-twin-ci-state-layer.md`` §3.2).

Adds the one new ``coord.*`` table the no-reap merge gate needs:
``coord.ci_runs`` — a thin cache + oplog of GitHub Actions workflow-run
liveness keyed ``(repo, run_id)``. The collapsed per-PR verdict already
lives on ``coord.repo_branches`` / ``coord.pr_check_runs`` and the
per-(repo, workflow) main baseline on ``coord.ci_baselines`` (all created
in ``pr_merge_01_pr_state_extensions.py``); none of those store the
**run-level liveness** ("are there runs queued/in_progress for this
ref right now?") that ``coord_is_merge_safe`` / the
``gh run list --status in_progress,queued`` no-reap check needs (plan
§2.2). This table fills that gap.

``coord.*`` is **alembic-sole-author** (``proj_alembic_sole_author_coord_schema``;
the ``coord_schema_authorship.rs`` CI gate + ``state::require_table`` boot
gate). The Rust side reads only. The companion coord PR adds
``coord.ci_runs`` to ``main.rs::ALEMBIC_OWNED_TABLES`` so the boot gate
fail-fasts on its absence — NOT edited here (web does not maintain that
list; the registry is coord-side).

Columns (plan §3.2):

* ``repo`` / ``run_id`` — identity. ``run_id`` is GitHub's
  ``actions/runs.id`` (BIGINT; a re-run gets a new id). Composite PK.
* ``workflow_name`` — the workflow this run belongs to.
* ``head_sha`` / ``head_branch`` — ``main`` for push runs; the PR head
  for pull_request runs (nullable — not all run payloads carry both).
* ``event`` — ``push`` | ``pull_request`` | ``schedule`` (the
  nightly-vs-on-PR taxonomy; the gate ignores ``schedule`` runs).
* ``status`` — ``queued`` | ``in_progress`` | ``completed``.
* ``conclusion`` — ``success`` | ``failure`` | ``cancelled`` |
  ``skipped`` | NULL while running.
* ``cancel_in_progress`` / ``concurrency_group`` — the reaper config of
  this run's workflow (plan §2.3), cached on the row, refreshed when the
  run is observed. Nullable (resolved when known).
* ``observed_at`` — snapshot time. ``DEFAULT now()`` on a column is an
  IMMUTABLE-safe default (NOT a partial-index predicate — see below).

Index: ``ix_ci_runs_inflight`` is a **partial** index over
``(repo, head_branch)`` ``WHERE status IN ('queued','in_progress')`` —
the hot no-reap query. The predicate is a pure ``IN`` over a column and
contains NO non-IMMUTABLE function (no ``now()`` / ``CURRENT_TIMESTAMP``),
so Postgres accepts it (cf. ``reference_alembic_now_index_and_offline_sql_gap``:
PG rejects ``now()`` inside a partial-index predicate, and offline
``--sql`` render does not catch it).

Raw ``op.execute`` (not ``op.create_table``) + ``IF NOT EXISTS`` /
``CREATE SCHEMA IF NOT EXISTS`` so the migration is collision-safe
against any canonical PG that already has the table — same convention as
``pr_merge_01_pr_state_extensions.py`` / ``coord_singleauthored_01_gates.py``.

No ``public.*`` (the ``forbid-public-schema`` gate); everything is
schema-qualified ``coord.``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_ci_01_ci_runs"
down_revision: str | Sequence[str] | None = "cognito_legacy_auth_teardown_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.ci_runs + the in-flight partial index (plan §3.2)."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_runs (
            repo               TEXT        NOT NULL,
            run_id             BIGINT      NOT NULL,
            workflow_name      TEXT        NOT NULL,
            head_sha           TEXT,
            head_branch        TEXT,
            event              TEXT,
            status             TEXT        NOT NULL,
            conclusion         TEXT,
            cancel_in_progress BOOLEAN,
            concurrency_group  TEXT,
            observed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (repo, run_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_ci_runs_inflight
            ON coord.ci_runs (repo, head_branch)
            WHERE status IN ('queued', 'in_progress')
        """
    )


def downgrade() -> None:
    """Drop the in-flight index + table (reverse order)."""
    op.execute("DROP INDEX IF EXISTS coord.ix_ci_runs_inflight")
    op.execute("DROP TABLE IF EXISTS coord.ci_runs")
