"""devenv_09: auto-enrollment provenance + per-owner policy

Revision ID: devenv_09_auto_enrollment
Revises: probe_base_01
Create Date: 2026-08-15

Phase 3 of plan ``2026-08-05-devenv-auto-enrollment-on-connection``.

Two machine columns and one owner-scoped policy table:

* ``machines.enrollment_origin VARCHAR(16) NULL`` — ``manual`` |
  ``dispatched`` | ``auto``. NULL means "pre-existing, origin unknown" and is
  deliberately NOT backfilled: every existing row predates the column, and
  guessing an origin would manufacture provenance the database never observed.
  The dashboard's origin badge must therefore render NULL as "unknown", never
  as "manual".
* ``machines.auto_enroll_last_attempt_at TIMESTAMPTZ NULL`` — the rate-limit
  clock for the reinstall arm. A lying client can rotate its own machine key
  at most once per cooldown, and nothing else; this column is what bounds it.
* ``devenv.auto_enroll_policy`` — one row per owner. ``target_environment_id``
  is how an owner with several environments says where NEW boxes go, instead
  of the server guessing between two plausible environments. Absent row =
  enabled (the default is ``true``), so an owner who has never visited the
  policy surface still gets the behaviour.

``target_environment_id`` is a SOFT reference with no FK, matching
``machines.environment_id`` (``models/devenv.py:132-142``):
``environments.canonical_machine_id`` already references ``machines``, so
declaring the back-reference in ORM metadata closes a
machines<->environments cycle that ``Base.metadata.sorted_tables`` cannot sort.
``owner_user_id`` DOES carry its FK to ``auth.users.id ON DELETE CASCADE``,
matching ``machines.owner_user_id`` (``models/devenv.py:124``) — deleting a
user must not strand a policy row.

``down_revision`` is ``probe_base_01``, resolved from ``alembic heads`` at
implementation time and re-verified immediately before the PR. It is NOT
``devenv_08_ci_node_config``: the ``devenv_NN`` filenames are a naming
convention, not a private chain. ``devenv_08`` itself chains into
``coord_ocs_operator_id`` and is already superseded by
``sess_guard_01_session_protection_floor_columns``, so chaining off it would
fork the graph into two heads and red the ``alembic-graph-pr`` single-head
gate.

Additive and nullable/defaulted throughout — safe for a running app on the
prior schema, and ``downgrade`` drops exactly what ``upgrade`` added.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

# revision identifiers
revision: str = "devenv_09_auto_enrollment"
down_revision: str | Sequence[str] | None = "probe_base_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "devenv"


def upgrade() -> None:
    """Add enrollment provenance columns + the per-owner auto-enroll policy."""
    op.add_column(
        "machines",
        sa.Column("enrollment_origin", sa.String(length=16), nullable=True),
        schema=_SCHEMA,
    )
    op.add_column(
        "machines",
        sa.Column(
            "auto_enroll_last_attempt_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema=_SCHEMA,
    )

    op.create_table(
        "auto_enroll_policy",
        sa.Column(
            "owner_user_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        # Soft reference — no FK, see the module docstring.
        sa.Column("target_environment_id", PGUUID(as_uuid=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    """Drop exactly what ``upgrade`` added."""
    op.drop_table("auto_enroll_policy", schema=_SCHEMA)
    op.drop_column("machines", "auto_enroll_last_attempt_at", schema=_SCHEMA)
    op.drop_column("machines", "enrollment_origin", schema=_SCHEMA)
