"""coord.git_ops -- GitOp federation feed (append-only observation)

Revision ID: coord_git_ops
Revises: coord_handoff_requests
Create Date: 2026-05-24

Phase 5 of plan
``D:/qontinui-root/plans/2026-05-24-federation-verify-and-gitop.md``.

Stands up the append-only ``coord.git_ops`` feed -- the **post-action
observational record** of the real git operations runner-spawned sessions
perform on their local working trees (commits, checkouts, branch creates,
pushes, merges, rebases, resets, stashes, tags). The exact mirror of the
``coord.memories`` substrate (Phase 6 of the production-readiness plan):
same tenant-scoping, same self-heal posture.

This is NOT the "git-ops orchestration" surface (coord's
``session_view`` / ``agent_worktrees``), which is the *pre-action*
claims-derived allocation + touch-set view. They share no table --
``coord.git_ops`` is exclusively this feed's. The conceptual distinction
lives in the route-module doc comment (``qontinui-coord/src/git_ops.rs``).

Schema:

* ``op_id UUID PRIMARY KEY``            -- synthetic id per op row.
* ``tenant_id UUID``                    -- FK to ``coord.tenants``; the
  feed is tenant-scoped via the ``X-Qontinui-Tenant-Id`` header.
* ``device_id UUID NOT NULL``           -- the runner device that performed
  the op (``SessionContext.device_id``).
* ``session_id UUID NOT NULL``          -- the runner session
  (``SessionContext.session_id``).
* ``repo TEXT NOT NULL``                -- repo basename (origin remote URL
  basename, falling back to the working-dir basename).
* ``branch TEXT``                       -- affected branch (null for
  stash/tag ops).
* ``op_kind TEXT NOT NULL``             -- ``commit | push | checkout |
  branch_create | merge | rebase | reset | stash | tag``.
* ``sha TEXT``                          -- resulting commit SHA (null for
  branch_create/stash).
* ``message TEXT``                      -- commit message or op description.
* ``recorded_at TIMESTAMPTZ``           -- wall-clock record time.
* ``metadata JSONB``                    -- extensible (files_changed,
  remote, ahead_count, ...).

There is **no version monotonicity** -- git ops are point-in-time and
append-only is the whole model (unlike ``coord.memories``).

Indices:

* ``idx_git_ops_tenant_recorded``       -- ``(tenant_id, recorded_at DESC)``
  covers the per-tenant fleet-feed scan.
* ``idx_git_ops_session_recorded``      -- ``(session_id, recorded_at DESC)``
  covers ``GET /coord/git-ops/by-session/:id``.
* ``idx_git_ops_tenant_repo_branch``    -- ``(tenant_id, repo, branch)``
  covers the repo/branch-filtered feed + the branch-per-device map.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS``. Mirrors the coord-side self-heal at
``qontinui-coord/src/git_ops.rs::ensure_git_ops_table`` exactly -- a row
inserted via either path is byte-identical. Runtime self-heal posture per
[[feedback_canonical_db_behind_alembic]]; alembic is the authoritative
record so a fresh canonical PG converges without a coord boot.

Chains off ``phase4_touched_hunks`` (the single alembic head at authoring
time, verified via the revision-graph scan).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_git_ops"
down_revision: str = "coord_handoff_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.git_ops`` + indices. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.git_ops (
            op_id        UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
            tenant_id    UUID REFERENCES coord.tenants(tenant_id),
            device_id    UUID NOT NULL,
            session_id   UUID NOT NULL,
            repo         TEXT NOT NULL,
            branch       TEXT,
            op_kind      TEXT NOT NULL,
            sha          TEXT,
            message      TEXT,
            recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            metadata     JSONB DEFAULT '{}'
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_git_ops_tenant_recorded
            ON coord.git_ops(tenant_id, recorded_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_git_ops_session_recorded
            ON coord.git_ops(session_id, recorded_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_git_ops_tenant_repo_branch
            ON coord.git_ops(tenant_id, repo, branch)
        """
    )


def downgrade() -> None:
    """Drop the indices then the table."""
    op.execute("DROP INDEX IF EXISTS coord.idx_git_ops_tenant_repo_branch")
    op.execute("DROP INDEX IF EXISTS coord.idx_git_ops_session_recorded")
    op.execute("DROP INDEX IF EXISTS coord.idx_git_ops_tenant_recorded")
    op.execute("DROP TABLE IF EXISTS coord.git_ops")
