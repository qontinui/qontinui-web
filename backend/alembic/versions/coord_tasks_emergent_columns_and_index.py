"""coord.tasks — emergent-task support: origin column, plan-less nullables, UNIQUE index

Revision ID: coord_tasks_emergent_columns_and_index
Revises: coord_commit_lineage_tenant_id
Create Date: 2026-06-08

Makes ``coord.tasks`` actually support the runner's emergent-task insert, which
fired ``create_emergent_task failed ... db error`` on **every** AI session
create / resume / worker spawn / worktree promote.

The runner's ``create_emergent_task``
(``qontinui-runner/src-tauri/src/database/pg/tasks.rs``) does::

    INSERT INTO coord.tasks (
        assigned_session_id, status, origin, plan_id,
        plan_version_hash, phase_name, sequence_in_phase, description)
    VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, $4)
    ON CONFLICT (assigned_session_id) WHERE origin = 'session_emergent' DO NOTHING
    RETURNING id::text

An emergent task "didn't come from a plan decomposition", so it has no
``plan_id`` / ``plan_version_hash`` / ``phase_name`` / ``sequence_in_phase`` and
(in Phase 1) no ``description``. But the alembic-declared ``coord.tasks``
(``consolidation_phase1_20_tail_specialty`` /
``consolidation_phase2_v_28_productivity_plans_tasks``) had **no ``origin``
column at all**, and marked all of those plan-decomposition columns ``NOT NULL``
(``plan_id`` even ``REFERENCES coord.plans``). So the insert failed before it
ever reached the ``ON CONFLICT`` arbiter.

The ``origin`` column was historically created by the runner's coord.* schema
self-heal, which was **deleted** in runner #319
(``a5a0a7b7 refactor(runner): delete coord.* schema self-heals; require_table at
boot``) — leaving the INSERT referencing a column the declared schema never
created. (The original DRAFT of the fix-plan mis-diagnosed this as a 42P10
missing-index issue alone, because the real error — ``42703 column "origin" does
not exist`` — was masked as a bare "db error" by ``tasks.rs``'s ``{}`` formatter;
that masking is fixed in the companion runner PR.)

This migration brings the declared schema in line with what the runner needs:

1. Add the ``origin`` column (nullable TEXT — plan-decomposition rows leave it
   NULL; emergent rows set ``'session_emergent'``).
2. Relax the ``NOT NULL`` on the five plan-decomposition columns the emergent
   insert leaves NULL: ``plan_id``, ``plan_version_hash``, ``phase_name``,
   ``sequence_in_phase``, ``description``. The ``plan_id`` foreign key to
   ``coord.plans`` is retained (a NULL ``plan_id`` is simply not FK-checked), so
   plan-bound rows keep referential integrity while emergent rows are plan-less.
3. Add the UNIQUE partial index the ``ON CONFLICT`` arbiter requires, named
   ``idx_tasks_emergent_per_session`` to match the name the runner docstring
   already documents as "(alembic-owned)".

## House conventions followed

All DDL is idempotent and defensive (``ADD COLUMN IF NOT EXISTS``,
``DROP NOT NULL`` is a no-op when already nullable, ``CREATE UNIQUE INDEX IF NOT
EXISTS``) so it applies cleanly whether or not a given canonical/prod DB already
carries some of these from the now-deleted self-heal — same convention as the
sibling ``coord_*`` revisions.

The index predicate ``origin = 'session_emergent'`` compares a column to an
IMMUTABLE string constant — no ``now()`` / non-IMMUTABLE function — so there is
no IMMUTABLE-predicate hazard, and it is textually equivalent to the runner's
``ON CONFLICT ... WHERE`` clause (required for PG to accept the arbiter).

The pre-existing ``idx_tasks_assigned_session`` (non-unique, predicate
``assigned_session_id IS NOT NULL``) is left intact: it serves the broader
``find_task_by_assigned_session`` lookup (filters by ``assigned_session_id``
alone), which this emergent-only index cannot satisfy.

Pre-check: because the insert has always failed, **zero**
``origin = 'session_emergent'`` rows exist yet, so the UNIQUE index builds
cleanly with no duplicate-key risk.

Touches **only** ``coord.tasks``; makes no assumption about non-coord tables, so
it applies cleanly anywhere the chain runs.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# down_revision chains off the verified origin/main head
# ``coord_commit_lineage_tenant_id``.
revision: str = "coord_tasks_emergent_columns_and_index"
down_revision: str | Sequence[str] | None = "coord_commit_lineage_tenant_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        -- 1. origin column (nullable; plan rows NULL, emergent rows 'session_emergent')
        ALTER TABLE coord.tasks
            ADD COLUMN IF NOT EXISTS origin TEXT;

        -- 2. relax the plan-decomposition NOT NULLs the emergent insert leaves NULL
        ALTER TABLE coord.tasks ALTER COLUMN plan_id           DROP NOT NULL;
        ALTER TABLE coord.tasks ALTER COLUMN plan_version_hash DROP NOT NULL;
        ALTER TABLE coord.tasks ALTER COLUMN phase_name        DROP NOT NULL;
        ALTER TABLE coord.tasks ALTER COLUMN sequence_in_phase DROP NOT NULL;
        ALTER TABLE coord.tasks ALTER COLUMN description        DROP NOT NULL;

        -- 3. UNIQUE partial index backing ON CONFLICT (assigned_session_id)
        --    WHERE origin = 'session_emergent'
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_emergent_per_session
            ON coord.tasks (assigned_session_id)
            WHERE origin = 'session_emergent';
        """
    )


def downgrade() -> None:
    # Re-imposing the NOT NULLs would fail if emergent (plan-less) rows exist, so
    # downgrade only drops the additive index + column. The relaxed nullability is
    # left in place (widening is not safely reversible once plan-less rows land).
    op.execute("DROP INDEX IF EXISTS coord.idx_tasks_emergent_per_session")
    op.execute("ALTER TABLE coord.tasks DROP COLUMN IF EXISTS origin")
