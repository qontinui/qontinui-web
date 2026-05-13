"""coord.tasks identity_hash for re-decompose idempotency

Revision ID: coord_tasks_identity_hash
Revises: sd01_coord_coordinator_shadow_decisions
Create Date: 2026-05-12

Phase 1 of the coord-task-status-hygiene plan
(D:/qontinui-root/plans/2026-05-12-coord-task-status-hygiene-plan.md).

Re-decomposing the same plan markdown after a typo edit currently
destroys every existing coord.tasks row for that plan — the inserter
at qontinui-runner/src-tauri/src/mcp/plans.rs:183-193 runs
``DELETE FROM coord.tasks WHERE plan_id = $1::uuid`` then re-INSERTs.
That wipes ``status``, ``assigned_session_id``, ``completion_report``,
``completion_source``.

This migration adds a stable per-task identity hash
``sha256(plan_id || phase_name || sequence_in_phase || description)``
so the inserter can 3-way merge against existing rows rather than
delete-then-insert. Unchanged task identity collides on
``(plan_id, identity_hash)`` and updates in place; edited tasks land
as a new row with the old one marked ``abandoned``; removed tasks get
``abandoned`` rather than deleted (preserves audit history).

The ``digest()`` function used for the backfill requires the
``pgcrypto`` extension; that extension is already installed by
``add_dispatch_secret_to_runners`` upstream of this migration, but we
re-issue the ``CREATE EXTENSION IF NOT EXISTS`` here defensively so
this migration is self-contained on a fresh DB.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_tasks_identity_hash"
down_revision: str = "sd01_coord_coordinator_shadow_decisions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        -- pgcrypto provides digest(); already installed upstream by
        -- add_dispatch_secret_to_runners, but issuing IF NOT EXISTS here
        -- keeps this migration self-contained.
        CREATE EXTENSION IF NOT EXISTS pgcrypto;

        ALTER TABLE coord.tasks
            ADD COLUMN IF NOT EXISTS identity_hash TEXT;

        -- Backfill identity_hash for existing rows. Stable hash over
        -- (plan_id, phase_name, sequence_in_phase, description) so the
        -- next re-decompose can match existing rows by content.
        UPDATE coord.tasks
        SET identity_hash = encode(
            digest(
                plan_id::text
                || '|' || phase_name
                || '|' || sequence_in_phase::text
                || '|' || description,
                'sha256'
            ),
            'hex'
        )
        WHERE identity_hash IS NULL;

        -- Uniqueness per plan: a re-decompose with the same task identity
        -- must collide with the prior row, not create a duplicate.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_plan_identity_hash
            ON coord.tasks(plan_id, identity_hash)
            WHERE identity_hash IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_tasks_plan_identity_hash")
    op.execute("ALTER TABLE coord.tasks DROP COLUMN IF EXISTS identity_hash")
