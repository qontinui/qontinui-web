"""devenv_05: canonical change log (who set canonical + when)

Revision ID: devenv_05_canonical_change_log
Revises: sched_01_next_fire_at
Create Date: 2026-07-13

P1 of plan ``2026-07-02-devenv-copy-canonical-config-phase2-agent-apply.md``
(re-scoped 2026-07-13 to the pull model). The team-sync design needs the
canonical designation to be an **audited** decision: any developer may change
which machine is canonical for an environment, and every change is recorded —
who changed it, when, and from which machine to which.

Creates ``devenv.canonical_change_log`` — an append-only audit trail written
inside ``PUT /environments/{id}/canonical``. Prior to this, ``set_canonical``
was a bare single-column update with no history.

Column notes:
* ``environment_id`` — FK ``devenv.environments(id)`` ``ON DELETE CASCADE``
  (history dies with its environment).
* ``from_machine_id`` / ``to_machine_id`` — the previous and new canonical
  machine. **Soft references, NOT FKs**: a machine may be deleted later, and
  the historical record must survive that (an FK with ``SET NULL`` would erase
  which machine a past change pointed at, defeating the audit). Nullable —
  ``from`` is NULL for the first designation; ``to`` is NULL if canonical is
  ever cleared.
* ``changed_by_user_id`` — FK ``auth.users(id)`` ``ON DELETE SET NULL`` (keep
  the change record even if the user is later removed).
* ``tenant_id`` — best-effort tenant context (the ``X-Qontinui-Active-Tenant``
  the change was made under). Tenants are a coord/identity concept, not a web
  table, so this is a **soft reference, NOT a FK**, and nullable (populated
  only when the header is present + parseable). Forward-compat for when devenv
  moves from owner-scoped to tenant-scoped (plan P3).

Forward-only + additive (a brand-new table). Safe for a running app on the
prior schema.

``down_revision`` = the current alembic head (``sched_01_next_fire_at``).
Per the fleet convention (and as ``devenv_04`` did), coord re-points at land
time if main advances, and ``alembic-graph-pr`` CI guards forks.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers
revision = "devenv_05_canonical_change_log"
down_revision = "sched_01_next_fire_at"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    op.create_table(
        "canonical_change_log",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "environment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Soft references (NOT FKs) — the audit record must outlive machine
        # deletion so it still says which machine a past change pointed at.
        sa.Column("from_machine_id", UUID(as_uuid=True), nullable=True),
        sa.Column("to_machine_id", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "changed_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Best-effort tenant context; soft reference (coord concept, not a
        # web table). Forward-compat for tenant-scoped devenv (plan P3).
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema=_SCHEMA,
    )
    # History reads are "give me this environment's changes, newest first."
    op.create_index(
        "idx_devenv_canonical_log_env_changed_at",
        "canonical_change_log",
        ["environment_id", sa.text("changed_at DESC")],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_devenv_canonical_log_env_changed_at",
        table_name="canonical_change_log",
        schema=_SCHEMA,
    )
    op.drop_table("canonical_change_log", schema=_SCHEMA)
