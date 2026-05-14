"""coord phase 1 01 agent worktrees

Revision ID: coord_phase_1_01_agent_worktrees
Revises: fleet_phase_1_01_machine_budget
Create Date: 2026-05-14

Phase 1 of the branch-per-agent coordination plan
(``D:/qontinui-root/plans/2026-05-14-branch-per-agent-coordination-plan.md``
§4.1 + §4.2). Creates ``coord.agent_worktrees`` — the durable per-(agent,
repo) row that backs the worktree-per-agent spawn model.

One row per repo touched by an agent. Agents that span multiple repos
(e.g. a coordinated schema change touching qontinui-schemas +
qontinui-runner + qontinui-web) get N rows sharing the same
``agent_id``. The merge scheduler treats those N branches as an atomic
unit (§4.3).

The §4.2 schema is the contract downstream phases (merge proposals,
merge scheduler, observability heatmap) depend on. Column shapes are
fixed by this migration; later phases extend by adding new optional
columns rather than renaming.

Columns:

* ``agent_id`` — UUID, set at allocation. Half of the composite PK
  ``(agent_id, repo)`` — one row per repo per agent.
* ``machine_id`` — UUID FK to ``coord.machines.machine_id``. The host
  that materializes (and writes to) this worktree. ``ON DELETE SET
  NULL`` because the worktree row outlives a transiently unregistered
  machine (e.g. coord re-bootstrap); sweeper §7-risk-bullet handles
  orphans separately.
* ``repo`` — TEXT. Well-known qontinui-* slug (``qontinui-runner``,
  ``qontinui-coord``, etc.). Coord's repo list is configuration, not
  a FK — pluggable per deployment.
* ``branch`` — TEXT. ``agent/<short-machine>-<short-agent>`` per §4.2
  branch naming, but the migration treats it as opaque text so future
  naming changes don't need a schema migration. UNIQUE per ``(repo,
  branch)`` because the §4.1 "single writer per branch" invariant is
  per-repo — one agent that spans N repos has N rows sharing the
  same branch name, one per repo's namespace.
* ``parent_sha`` — TEXT. Commit the worktree branched from. Recorded
  so dry-rebase in Phase 4 has the original divergence point.
* ``worktree_path`` — TEXT. Host-absolute path; opaque to coord. The
  runner writes the path it actually materialized to so coord can
  surface it in dashboards / debugging.
* ``status`` — TEXT with CHECK constraint. ``allocated`` →
  ``active`` → ``merging`` → ``merged`` / ``abandoned``. The state
  machine §4.2 calls out. Sweeper prunes ``merged`` (after grace)
  and ``abandoned`` (after timeout).
* ``intent`` — TEXT, nullable. Free-text human intent. Not parsed by
  coord — for human readability in dashboards.
* ``created_at`` / ``updated_at`` — TIMESTAMPTZ. ``updated_at`` is
  written by application code on every status transition; no
  trigger (the row volume is low and trigger churn risk outweighs
  the convenience). The sweeper uses ``updated_at`` to compute
  staleness.

Indexes:

* PK on ``(agent_id, repo)`` — covers "all worktrees for this agent."
* ``idx_agent_worktrees_status`` — supports the sweeper's status-scan
  + ``SELECT * WHERE status IN ('active','merging')`` for "live
  agents" listings.
* ``idx_agent_worktrees_machine_status`` — supports "what's running
  on machine X" queries from the fleet dashboard (Phase 6).
* UNIQUE on ``(repo, branch)`` — enforces the §4.1 "single writer per
  branch" invariant per-repo. One agent with N worktrees shares one
  branch name across N rows; the constraint stops two *different*
  agents from claiming the same branch in the same repo.

Design notes:

* The status enum is implemented as a CHECK constraint on TEXT rather
  than a PG ENUM type because TEXT + CHECK survives schema drift
  better (ALTERing a PG ENUM requires a fresh transaction; CHECK
  edits are inline DDL). Matches the convention used elsewhere in
  ``coord.*``.
* No FK from ``branch`` to ``coord.repo_branches`` — branches in
  ``coord.repo_branches`` are GitHub-side state populated by webhook
  ingest; agent_worktrees branches are coord-allocated names that
  may not yet exist on origin at insert time. The two tables are
  joined at query time (e.g., "show me all my worktrees and their
  merge state") rather than via referential integrity.
* ``ON DELETE`` on the machine_id FK is SET NULL not CASCADE because
  losing the machine row shouldn't drop all of its agent worktree
  rows — the sweeper handles abandonment via timeout, not via FK
  cascade.

Chains off ``fleet_phase_1_01_machine_budget`` (Wave 1's Row 2
sibling) so the alembic head stays linear. The two Wave 1 migrations
are independent — fleet_phase_1 adds columns to coord.machines,
coord_phase_1_01 creates coord.agent_worktrees — but linearity is
cheaper than re-merging heads later.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_phase_1_01_agent_worktrees"
down_revision: str = "fleet_phase_1_01_machine_budget"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_worktrees",
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.machines.machine_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("branch", sa.Text(), nullable=False),
        sa.Column("parent_sha", sa.Text(), nullable=False),
        sa.Column("worktree_path", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'allocated'"),
        ),
        sa.Column("intent", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("agent_id", "repo"),
        sa.UniqueConstraint("repo", "branch", name="agent_worktrees_repo_branch_uq"),
        schema="coord",
    )

    op.execute(
        "ALTER TABLE coord.agent_worktrees "
        "ADD CONSTRAINT agent_worktrees_status_chk "
        "CHECK (status IN ('allocated', 'active', 'merging', 'merged', 'abandoned'))"
    )

    op.create_index(
        "idx_agent_worktrees_status",
        "agent_worktrees",
        ["status", sa.text("updated_at DESC")],
        schema="coord",
    )
    op.create_index(
        "idx_agent_worktrees_machine_status",
        "agent_worktrees",
        ["machine_id", "status"],
        schema="coord",
        postgresql_where=sa.text("machine_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_worktrees_machine_status")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_worktrees_status")
    op.execute(
        "ALTER TABLE coord.agent_worktrees DROP CONSTRAINT IF EXISTS agent_worktrees_status_chk"
    )
    op.drop_table("agent_worktrees", schema="coord")
