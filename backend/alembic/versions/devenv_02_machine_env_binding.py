"""devenv_02: explicit machine->environment binding

Phase 2 P1. Adds ``devenv.machines.environment_id`` (nullable FK to
``devenv.environments``, ``ON DELETE SET NULL``) so a machine binds to a
CHOSEN environment rather than relying on the v1 "exactly one environment"
auto-bind at enroll. Nullable: a machine may exist unbound, and an unbound
machine still falls back to the single-environment auto-bind at enroll.

Backfills the column from each machine's existing config rows when the machine
has configs pointing at exactly one environment (the common v1 case), so no
existing binding is lost.

Forward-only + additive (a nullable column + backfill) — safe for a running
app on the prior schema.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers
revision = "devenv_02_machine_env_binding"
down_revision = "coord_pr_events_resolutions_age_idx"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    op.add_column(
        "machines",
        sa.Column(
            "environment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.environments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_machine_environment",
        "machines",
        ["environment_id"],
        schema=_SCHEMA,
    )
    # Backfill: bind each machine to its environment when ALL its config rows
    # point at exactly one environment (the common v1 single-env case). Machines
    # with no configs, or configs spanning >1 env, stay NULL (unbound).
    op.execute(
        """
        UPDATE devenv.machines m
        SET environment_id = sub.environment_id
        FROM (
            SELECT machine_id, MIN(environment_id) AS environment_id
            FROM devenv.machine_environment_configs
            GROUP BY machine_id
            HAVING COUNT(DISTINCT environment_id) = 1
        ) sub
        WHERE m.id = sub.machine_id
          AND m.environment_id IS NULL
        """
    )


def downgrade() -> None:
    # Dropping the column drops its inline FK constraint with it.
    op.drop_index(
        "idx_devenv_machine_environment", table_name="machines", schema=_SCHEMA
    )
    op.drop_column("machines", "environment_id", schema=_SCHEMA)
