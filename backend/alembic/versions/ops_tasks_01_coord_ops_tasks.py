"""coord.ops_tasks - the ledger of coord-dispatched remote ops tasks (D4 lane)

Revision ID: ops_tasks_01_coord_ops_tasks
Revises: merge_capture_01
Create Date: 2026-10-30

Phase 4 step 1 of plan
``2026-10-19-ci-nodes-run-the-tauri-runner-always-on-as-ci-node-role``
(decision D4): remote ops are a deterministic task lane, not an agent
session. Coord publishes ``events.ops.task_requested.<device_id>`` on the
existing ``device_ci`` socket naming a task id from an allowlist
(``qontinui-claude-config`` ``ops/tasks.toml``) at a pinned commit; the runner
fetches that commit, runs the allowlisted script and posts the result. This
table is the ledger of those requests.

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the table lands here, in qontinui-web, and this revision must merge BEFORE the
coord PR that reads or writes it. Hand-authored; ``alembic revision
--autogenerate`` was not run and is never run against ``coord.*``.

Column notes
============
* ``script_repo`` / ``script_path`` / ``script_sha`` are the pinned script
  reference coord resolved from the allowlist at request time. Commands come
  from the repo at that sha, never from the request body.
* ``args`` is JSONB validated by coord against the task's args schema in the
  allowlist before the INSERT.
* ``state``: ``queued`` -> ``dispatched`` -> ``running`` -> ``succeeded`` |
  ``failed``; ``expired`` (queued to an offline device past ``expires_at`` -
  never re-placed, an ops task is about THAT machine) and ``cancelled`` are the
  other terminals.
* ``exit_code`` and ``log_tail`` are NULL until the runner posts a result;
  NULL is not 0.
* No foreign keys: ledger rows must not block on device lifecycle (the
  soft-pointer posture of the other coord operational tables).

All DDL is idempotent (IF NOT EXISTS). The table starts empty; the coord routes
that write it are dark behind a flag, so this revision changes no behaviour.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ops_tasks_01_coord_ops_tasks"
down_revision: str | Sequence[str] | None = "merge_capture_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.ops_tasks + its lookup indexes. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ops_tasks (
            id            UUID NOT NULL,
            tenant_id     UUID NOT NULL,
            device_id     UUID NOT NULL,
            task_id       TEXT NOT NULL,
            script_repo   TEXT NOT NULL,
            script_path   TEXT NOT NULL,
            script_sha    TEXT NOT NULL,
            args          JSONB NOT NULL DEFAULT '{}'::jsonb,
            requested_by  TEXT NOT NULL,
            state         TEXT NOT NULL DEFAULT 'queued'
                CONSTRAINT ck_ops_tasks_state CHECK (
                    state IN ('queued','dispatched','running',
                              'succeeded','failed','expired','cancelled')
                ),
            exit_code     INTEGER NULL,
            log_tail      TEXT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at    TIMESTAMPTZ NOT NULL,
            dispatched_at TIMESTAMPTZ NULL,
            started_at    TIMESTAMPTZ NULL,
            completed_at  TIMESTAMPTZ NULL,
            PRIMARY KEY (id)
        )
        """
    )
    # Per-device listing (GET /coord/ops/tasks?device_id=) and the expiry sweep.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ops_tasks_device_created
            ON coord.ops_tasks (tenant_id, device_id, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ops_tasks_open_expiry
            ON coord.ops_tasks (expires_at)
            WHERE state IN ('queued','dispatched','running')
        """
    )


def downgrade() -> None:
    """Drop the ledger. Idempotent."""
    op.execute("DROP TABLE IF EXISTS coord.ops_tasks")
