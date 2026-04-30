"""coordinator phase 6 agent coordination hardening

Revision ID: coordinator_phase_6_agent_coordination_hardening
Revises: cloud_schema_initial_tables
Create Date: 2026-04-30

Phase 6 of the multi-machine coordinator plan
(``D:/qontinui-root/tmp_coord_phase6_agent_coordination_hardening.md``).

Adds three new ``coord.*`` tables and one column on the existing
``coord.repo_branches`` table, hardening cross-machine agent coordination:

* ``coord.machine_status`` — free-form "what is this agent doing right
  now?" surface (Item 3). Updated by the runner heartbeat with the active
  task, repo, branch, and a free-text human-readable line, so other
  machines and the ``/coordinate`` UI can render presence beyond mere
  last-seen timestamps. The ``details`` JSONB carries structured extras
  (current step, queued plan id, etc.) without schema churn.

* ``coord.ci_baselines`` — per-(repo, workflow) "what does green look
  like on main right now?" snapshot (Item 6). Lets the coordinator
  flag PR check failures that already exist on the base branch and so
  shouldn't block merging — distinguishing real regressions from
  pre-existing flake. ``failure_pattern`` JSONB stores the most recent
  observed failure shape (failing job names, signature snippets) for
  fuzzy match against incoming PR check runs.

* ``coord.pr_check_runs`` — durable cache of GitHub check-run rows
  keyed by ``(repo, check_id)`` and joinable to PRs via
  ``(repo, head_sha)`` (Item 7). The coordinator already ingests
  ``check_run`` webhook events into ``coord.events`` for the timeline,
  but answering "what's the current CI state of PR #N?" without this
  table requires walking the event log. ``head_sha`` matches the
  ``head_sha`` column on ``coord.repo_branches`` so the join is direct.

* ``coord.repo_branches.correlation_id`` — UUID column threading the
  branch back to the originating coordinator decision / plan / task
  (Item 5). Nullable because legacy and externally-pushed branches
  have no in-system origin. Partial index excludes the NULL majority.

Schema choice: every table lives in ``coord`` per the schema-mapping
section of the migration consolidation plan (cross-machine agent
coordination is the ``coord.*`` mandate).

Notable design choices:

1. **machine_status is a separate table, not columns on coord.machines.**
   Status churns every heartbeat (~60s); the ``coord.machines`` row is
   identity-stable. Splitting them keeps the identity row warm in
   buffer cache and lets the status row be truncated/rebuilt without
   touching the FK target.

2. **ci_baselines is keyed by (repo, workflow_name), not by run id.**
   We track the *current* baseline snapshot, not a history. The
   ``last_main_run_id`` column points at the GitHub run id that
   produced the snapshot for traceability.

3. **pr_check_runs PK is (repo, check_id).** GitHub check_id is unique
   per repo, not globally. The ``(repo, head_sha)`` index supports the
   common "what checks are running for this PR's HEAD?" query.

4. **correlation_id partial index.** Only branches with an in-system
   origin have a correlation id; the partial index keeps the index
   small for the lookup path that actually uses it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordinator_phase_6_agent_coordination_hardening"
down_revision: str = "cloud_schema_initial_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # coord.machine_status (Item 3)
    # ------------------------------------------------------------------
    op.create_table(
        "machine_status",
        sa.Column(
            "machine_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.machines.machine_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("current_task", sa.Text(), nullable=True),
        sa.Column("current_repo", sa.Text(), nullable=True),
        sa.Column("current_branch", sa.Text(), nullable=True),
        sa.Column("free_text", sa.Text(), nullable=True),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    op.create_index(
        "idx_machine_status_updated",
        "machine_status",
        [sa.text("updated_at DESC")],
        schema="coord",
    )

    # ------------------------------------------------------------------
    # coord.ci_baselines (Item 6)
    # ------------------------------------------------------------------
    op.create_table(
        "ci_baselines",
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=False),
        sa.Column("last_main_run_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "failure_pattern",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("repo", "workflow_name"),
        schema="coord",
    )
    op.create_index(
        "idx_ci_baselines_updated",
        "ci_baselines",
        [sa.text("updated_at DESC")],
        schema="coord",
    )

    # ------------------------------------------------------------------
    # coord.pr_check_runs (Item 7)
    # ------------------------------------------------------------------
    op.create_table(
        "pr_check_runs",
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("head_sha", sa.Text(), nullable=False),
        sa.Column("check_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            comment="queued | in_progress | completed",
        ),
        sa.Column(
            "conclusion",
            sa.Text(),
            nullable=True,
            comment="success | failure | neutral | cancelled | timed_out | action_required | skipped | stale",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("details_url", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("repo", "check_id"),
        schema="coord",
    )
    op.create_index(
        "idx_pr_check_runs_head_sha",
        "pr_check_runs",
        ["repo", "head_sha"],
        schema="coord",
    )

    # ------------------------------------------------------------------
    # coord.repo_branches.correlation_id (Item 5)
    # ------------------------------------------------------------------
    op.add_column(
        "repo_branches",
        sa.Column(
            "correlation_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        schema="coord",
    )
    op.create_index(
        "idx_repo_branches_correlation_id",
        "repo_branches",
        ["correlation_id"],
        schema="coord",
        postgresql_where=sa.text("correlation_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_repo_branches_correlation_id")
    op.drop_column("repo_branches", "correlation_id", schema="coord")

    op.execute("DROP INDEX IF EXISTS coord.idx_pr_check_runs_head_sha")
    op.drop_table("pr_check_runs", schema="coord")

    op.execute("DROP INDEX IF EXISTS coord.idx_ci_baselines_updated")
    op.drop_table("ci_baselines", schema="coord")

    op.execute("DROP INDEX IF EXISTS coord.idx_machine_status_updated")
    op.drop_table("machine_status", schema="coord")
