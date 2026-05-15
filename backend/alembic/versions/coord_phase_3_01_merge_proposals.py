"""coord phase 3 01 merge proposals

Revision ID: coord_phase_3_01_merge_proposals
Revises: row_9_phase_2_01_revoked_tokens
Create Date: 2026-05-14

Phase 3 of the branch-per-agent coordination plan
(``D:/qontinui-root/plans/2026-05-14-branch-per-agent-coordination-plan.md``
§4.5 "Merge proposal API"). Creates two tables backing the merge
proposal API:

* ``coord.merge_proposals`` — one row per proposal, holding the
  agent's intent + lifecycle state.
* ``coord.merge_proposal_repos`` — one row per repo touched by a
  proposal. An agent that proposes a coordinated change across N
  repos lands N child rows under one parent row.

The Phase 3 scope is the *queue + manual landing* surface; the Phase
4 dry-rebase scheduler will read + write these tables to drive
landings automatically. Column shapes are the contract Phase 4
depends on — additive changes only after this migration.

## Column choices

``merge_proposals``:

* ``proposal_id`` — UUID v7 PK. Time-orderable so ``ORDER BY
  proposal_id`` doubles as FIFO without a separate ``created_at``
  index for the queue view. (We keep ``created_at`` for human
  consumption.)
* ``agent_id`` — UUID NOT NULL. The owner of the proposal; used for
  per-agent JWT scope checks (§4.5: "only the proposal's owning
  ``agent_id`` can dequeue/cancel its own proposal"). NOT FK to
  ``coord.agent_worktrees`` because proposals can outlive the
  worktree rows (sweeper deletes worktrees in terminal states, but
  the proposal history is the long-lived record).
* ``description`` — TEXT nullable. Free-text agent intent for
  dashboards / human review. Coord doesn't parse it.
* ``requires_clean_ci`` — BOOLEAN NOT NULL DEFAULT TRUE. Phase 4's
  scheduler reads this to decide whether to gate landing on green
  CI. False unblocks operator-driven manual landings for emergency
  cases.
* ``status`` — TEXT with CHECK. Lifecycle states from §4.5:
  ``queued`` → (Phase 4 advances: ``dry-rebasing`` →
  ``awaiting-ci`` → ``landing`` → ``merged``) with branch
  states ``blocked-by-overlap`` and ``conflict`` and terminal
  ``cancelled``. CHECK constraint preferred over PG ENUM (matches
  convention in ``coord.agent_worktrees``; ENUM ALTER is per-txn
  pain).
* ``cancelled_at`` / ``merged_at`` — TIMESTAMPTZ nullable. Set
  inline when status flips to the terminal value; consumed by the
  Phase 4 cascade ("any proposal blocked-by-overlap on the
  just-merged proposal re-enters dry-rebase").
* ``error`` — TEXT nullable. Captures the conflict/CI failure
  detail surfaced to the queue/detail endpoints. Plain text rather
  than JSONB because consumers (agents, dashboards) render it
  verbatim.
* ``created_at`` / ``updated_at`` — TIMESTAMPTZ NOT NULL. App
  updates ``updated_at`` on every status transition; no trigger
  (matches ``agent_worktrees`` convention).

``merge_proposal_repos``:

* Composite PK ``(proposal_id, repo)`` — one repo entry per
  proposal. A proposal spanning N repos has N child rows.
* ``branch`` — TEXT. The agent's branch name in this repo
  (``agent/<short-machine>-<short-agent>`` per §4.2). Stored opaque
  because the agent's branch namespace is repo-local.
* ``head_sha`` — TEXT NOT NULL. The commit the agent wants to
  land. Together with the agent_id on the parent row, this is the
  idempotency key for ``POST /merge/propose`` per §4.5.
* ``rebase_result`` — JSONB nullable. Written by Phase 4's
  scheduler with structured per-repo dry-rebase outcomes
  (touched files, parent_sha, conflict markers, etc.).
* ``conflict_diff`` — TEXT nullable. Three-way diff captured at
  conflict time so the ``GET /merge/:id/conflict-diff`` endpoint
  doesn't need to re-run the rebase. Kept on the repo row because
  conflicts are per-repo (a multi-repo proposal can have one
  conflicting repo and N-1 clean ones).
* ``ci_run_url`` — TEXT nullable. The cloud-CI run pointer once
  Phase 4 fires it. Surfaced via ``GET /merge/:id``.
* ``overlap_paths`` — TEXT[] nullable. Files touched by the
  rebased branch vs main, computed by Phase 4's dry-rebase. Used
  by the overlap-detection pass to find conflicting in-flight
  proposals.

## Index choices

* ``idx_merge_proposals_status`` — supports the queue endpoint's
  ``WHERE status IN ('queued', 'dry-rebasing', ...) ORDER BY
  proposal_id`` scan. Includes ``proposal_id DESC`` so the FIFO
  drain reads sequentially.
* ``idx_merge_proposals_agent_id`` — supports the agent-side "what
  proposals do I have in-flight?" lookup.
* ``idx_merge_proposal_repos_head_sha`` — supports the idempotency
  query in ``POST /merge/propose`` (find existing proposal with
  matching ``(agent_id, repo, head_sha)``).

## Chains off ``row_9_phase_2_01_revoked_tokens``

The current alembic head on main as of 2026-05-14. Both Wave 1 +
Wave 2 alembic work is folded in. If the Phase 1B sibling-head
merge (``coord_phase_1b_02_merge_revoked_tokens``) lands first via
its own PR, a small follow-up merge revision will join this Phase 3
head with the resulting Phase 1B head; per [[feedback_alembic_sibling_head_merge]]
that's the empty-bookkeeping shape used twice before in this branch.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_phase_3_01_merge_proposals"
down_revision: str = "row_9_phase_2_01_revoked_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Lifecycle states per §4.5. Listed here as the source of truth for
# the CHECK constraint; the Rust side mirrors this set verbatim via a
# `STATUSES` const in `merge.rs`.
ALLOWED_STATUSES = (
    "queued",
    "dry-rebasing",
    "awaiting-ci",
    "landing",
    "blocked-by-overlap",
    "conflict",
    "merged",
    "cancelled",
)


def upgrade() -> None:
    op.create_table(
        "merge_proposals",
        sa.Column(
            "proposal_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "requires_clean_ci",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'queued'"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "cancelled_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "merged_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
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
        schema="coord",
    )

    allowed = ", ".join(f"'{s}'" for s in ALLOWED_STATUSES)
    op.execute(
        f"ALTER TABLE coord.merge_proposals "
        f"ADD CONSTRAINT merge_proposals_status_chk "
        f"CHECK (status IN ({allowed}))"
    )

    op.create_index(
        "idx_merge_proposals_status",
        "merge_proposals",
        ["status", sa.text("proposal_id DESC")],
        schema="coord",
    )
    op.create_index(
        "idx_merge_proposals_agent_id",
        "merge_proposals",
        ["agent_id"],
        schema="coord",
    )

    op.create_table(
        "merge_proposal_repos",
        sa.Column(
            "proposal_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "coord.merge_proposals.proposal_id",
                ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("branch", sa.Text(), nullable=False),
        sa.Column("head_sha", sa.Text(), nullable=False),
        sa.Column(
            "rebase_result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("conflict_diff", sa.Text(), nullable=True),
        sa.Column("ci_run_url", sa.Text(), nullable=True),
        sa.Column(
            "overlap_paths",
            postgresql.ARRAY(sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("proposal_id", "repo"),
        schema="coord",
    )

    op.create_index(
        "idx_merge_proposal_repos_head_sha",
        "merge_proposal_repos",
        ["repo", "head_sha"],
        schema="coord",
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_merge_proposal_repos_head_sha"
    )
    op.drop_table("merge_proposal_repos", schema="coord")
    op.execute("DROP INDEX IF EXISTS coord.idx_merge_proposals_agent_id")
    op.execute("DROP INDEX IF EXISTS coord.idx_merge_proposals_status")
    op.execute(
        "ALTER TABLE coord.merge_proposals DROP CONSTRAINT IF EXISTS merge_proposals_status_chk"
    )
    op.drop_table("merge_proposals", schema="coord")
