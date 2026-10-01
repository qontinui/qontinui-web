"""project.scheduled_tasks.conditions — persist a task's ScheduleConditions

Revision ID: sched_cond_01_scheduled_tasks_conditions
Revises: twin_10_served_bundle_target_columns
Create Date: 2026-09-29

Phase 4c of plan
``2026-09-29-quiet-is-measured-by-session-existence-and-machine-wide-so-a-24x7-box-never-gets-one``.

The runner scheduler evaluates per-task ``ScheduleConditions`` (``require_idle``,
``require_repo_inactive``, ``require_probe``, ``timeout_minutes``), but
``project.scheduled_tasks`` had nowhere to keep them: the runner's PG store
dropped a task's conditions on insert/update and read every task back with
none, so every condition was inert (a Cron task fired at its clock time, a
Condition-schedule task on every rearm, ungated).

* ``conditions JSONB`` (nullable) — the task's serialized
  ``qontinui_types::scheduler::ScheduleConditions`` (camelCase). NULL = the
  task has no conditions. JSONB rather than the table's TEXT-holding-JSON
  convention (``task_config``) so a malformed write is refused by the
  database instead of being read back as "no conditions".

``condition_status`` is NOT touched: it already exists (TEXT, from
``consolidation_phase1_13_mobile_tasks_misc``) and runner builds in the field
bind it as a text parameter; retyping it to JSONB would make every such
build's status write fail during the rollout. The runner now also reads it
back (it previously only wrote it).

Expand-only, nullable, no backfill (existing rows have no conditions to
recover — they were never stored), no index (read with the whole row).

Idempotency: ``ADD COLUMN IF NOT EXISTS``. The runner self-heals the same
column on an embedded Postgres that predates this revision (an end-user
install has no alembic), so a database may already carry it when this runs.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sched_cond_01_scheduled_tasks_conditions"
down_revision: str = "twin_10_served_bundle_target_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``project.scheduled_tasks.conditions``. Idempotent."""
    op.execute(
        """
        ALTER TABLE project.scheduled_tasks
            ADD COLUMN IF NOT EXISTS conditions JSONB
        """
    )


def downgrade() -> None:
    """Drop ``project.scheduled_tasks.conditions``."""
    op.execute(
        "ALTER TABLE project.scheduled_tasks DROP COLUMN IF EXISTS conditions"
    )
