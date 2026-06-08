"""coord scheduled-maintenance subsystem tables (Phase 1)

Revision ID: coord_maintenance_2026_06_08
Revises: landroute_01_two_tier_land_route
Create Date: 2026-06-08

Phase 1 of the coord scheduled-maintenance subsystem
(``D:/qontinui-root/plans/2026-06-08-coord-scheduled-maintenance-subsystem.md``
§4 Phase 1 + §6 data model). Creates the two ``coord.*`` tables that back the
operator-configurable, idle-gated maintenance scheduler:

* ``coord.maintenance_tasks`` — the durable, operator-authored task registry.
  One row per maintenance rule (e.g. branch-reset). Each row carries its
  target selector, ordered predicates, action, and schedule gate as JSONB so
  the task model is data, not Rust enums (plan §2 Fork C). ``enabled`` is the
  operator toggle; ``armed`` is the per-task arming flag (un-armed → the
  emitted instruction is advisory/log-only on the runner).
* ``coord.maintenance_runs`` — the per-tick run ledger. One row per task per
  device per tick that produced (or refused) an instruction set. Records the
  candidate set, the emitted instructions, the transport (pull/push), the
  outcome, and — when the safety floor fired — the refusal reason.

``coord.maintenance_verdicts`` (the Phase-2 semantic-verdict store) is
deliberately NOT created here — it ships with Phase 2.

coord is DML-only: alembic is the sole author of these tables (the coord boot
gate ``ALEMBIC_OWNED_TABLES`` asserts both are present at startup and
HARD-FAILS boot if the migration hasn't run). The web migration deploys BEFORE
the coord image that reads them (deploy-ordered, same posture as the other
twin tables).

Idempotent: each ``CREATE TABLE`` / ``CREATE INDEX`` uses ``IF NOT EXISTS`` via
``op.execute`` so a re-run (or a partial prior apply) is a clean no-op, matching
the defensive style used by neighboring coord migrations.

Chains off ``landroute_01_two_tier_land_route`` — the verified sole current
head (its own down_revision is ``dev_action_01_snapshot_tables``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_maintenance_2026_06_08"
down_revision: str = "landroute_01_two_tier_land_route"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # coord.maintenance_tasks — the operator-authored task registry.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.maintenance_tasks (
            id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       text        NULL,
            name            text        NOT NULL,
            description     text        NULL,
            enabled         boolean     NOT NULL DEFAULT false,
            armed           boolean     NOT NULL DEFAULT false,
            target_selector jsonb       NOT NULL,
            predicates      jsonb       NOT NULL DEFAULT '[]'::jsonb,
            action          jsonb       NOT NULL,
            schedule_gate   jsonb       NOT NULL,
            created_at      timestamptz NOT NULL DEFAULT now(),
            updated_at      timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    # coord.maintenance_runs — the per-tick run ledger.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.maintenance_runs (
            id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id              uuid        NOT NULL
                                              REFERENCES coord.maintenance_tasks(id)
                                              ON DELETE CASCADE,
            device_id            text        NULL,
            started_at           timestamptz NOT NULL DEFAULT now(),
            finished_at          timestamptz NULL,
            candidates           jsonb       NOT NULL DEFAULT '[]'::jsonb,
            emitted_instructions jsonb       NOT NULL DEFAULT '[]'::jsonb,
            armed                boolean     NOT NULL DEFAULT false,
            transport            text        NULL,
            outcome              text        NOT NULL DEFAULT 'planned',
            refusal_reason       text        NULL
        )
        """
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_enabled "
        "ON coord.maintenance_tasks (enabled)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_maintenance_runs_task_id "
        "ON coord.maintenance_runs (task_id)"
    )


def downgrade() -> None:
    # Drop the child (FK) table first, then its parent.
    op.execute("DROP INDEX IF EXISTS coord.idx_maintenance_runs_task_id")
    op.execute("DROP INDEX IF EXISTS coord.idx_maintenance_tasks_enabled")
    op.execute("DROP TABLE IF EXISTS coord.maintenance_runs")
    op.execute("DROP TABLE IF EXISTS coord.maintenance_tasks")
