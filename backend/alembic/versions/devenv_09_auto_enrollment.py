"""devenv_09: auto-enrollment provenance + per-owner policy

Revision ID: devenv_09_auto_enrollment
Revises: require_review_cols_01
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

``down_revision`` is **whatever the single head of ``main`` is at the moment
this branch is last pushed** — ``require_review_cols_01`` as of 2026-09-05, and it
has been re-pointed several times before that. Do not read the token as meaningful:
while this PR stays open, every land on ``main`` that adds a revision makes this
one a SIBLING off the old node, ``alembic heads`` reports two heads, and the
required ``alembic-heads-pr`` gate goes red until it is re-pointed again. That
is a property of the gate on a ``strict: true`` repo, not a defect in this
revision.

**Re-point; never add a merge revision.** A merge revision is the correct tool
only when both heads have ALREADY LANDED, since landed history cannot be
re-pointed. This revision is unlanded, so the fix is always the one-token edit.
Between 2026-08-27 and 2026-08-31 this branch carried two merge revisions
(``merge_devenv10_fflandheadsync_heads``,
``merge_devenv10fflandheadsync_pdtier01_heads``) added instead of re-pointing;
they did not clear the gate, each land needed another one, and both were deleted
on 2026-08-31 in favour of a single re-point. ``scripts/ci/notify_forked_open_prs.py``
comments the exact token to adopt on every land, and
``scripts/ci/count_alembic_heads.py`` prints it locally in ~2s.

Re-pointing is safe here because the two are INDEPENDENT: ``coordnotif_01``
creates ``coord.notifications`` / ``coord.notification_reads``, this one only
touches ``devenv.*``, and neither reads the other's objects. Ordering between
them is therefore arbitrary and picking one is a graph choice, not a data one.

It is NOT ``devenv_08_ci_node_config``: the ``devenv_NN`` filenames are a
naming convention, not a private chain. ``devenv_08`` itself chains into
``coord_ocs_operator_id`` and is already superseded by
``sess_guard_01_session_protection_floor_columns``, so chaining off it would
fork the graph in the same way.

Additive and nullable/defaulted throughout — safe for a running app on the
prior schema, and ``downgrade`` drops exactly what ``upgrade`` added.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

# revision identifiers
revision: str = "devenv_09_auto_enrollment"
down_revision: str | Sequence[str] | None = "require_review_cols_01"
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
