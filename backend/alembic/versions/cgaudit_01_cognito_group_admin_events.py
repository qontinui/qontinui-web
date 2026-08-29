"""cognito group admin audit table (pool-wide group + membership changes)

Revision ID: cgaudit_01
Revises: coord_agent_questions_audience
Create Date: 2026-08-27

Plan ``2026-08-27-members-page-delete-paths-authorization-and-blast-radius``
Phase 3, item 8. Creates ``auth.cognito_group_admin_events`` — one
append-only row per MUTATING call to the pool-wide
``/api/v1/operations/coord/cognito/groups*`` routes.

Why it exists: all six of those routes bound ``current_user`` through
``require_admin`` and then never referenced it. The only trace that a
shared-pool Cognito group had been deleted — irreversible, not scoped to a
tenant, and felt by every tenant keyed off that pool — was a service-layer
structlog line carrying no actor at all.

Modelled on ``auth.identity_link_events``
(``idlink_01_identity_link_events``), which does the same job for the
strictly LOWER-privilege self-service identity-link routes.

EXPAND-ONLY / forward-only (per the repo migration convention): this
revision only CREATEs a new table — no drops, fully backward-compatible
with a rolled-back prior app.

Columns:
* ``id``              — UUID PK, default ``gen_random_uuid()``.
* ``actor_user_id``   — UUID NOT NULL. The superuser who made the call.
* ``action``          — TEXT NOT NULL CHECK IN
                        ('create_group','delete_group','add_user_to_group',
                         'remove_user_from_group').
* ``group_name``      — TEXT NOT NULL. The Cognito group acted on.
* ``target_email``    — TEXT nullable. Membership changes only.
* ``target_username`` — TEXT nullable. The resolved Cognito ``Username``.
* ``details``         — JSONB NOT NULL DEFAULT '{}'. Per-action context;
                        for a delete this carries the ``allow_mapped`` /
                        ``allow_home_group`` overrides, i.e. the record of a
                        blast-radius guard being consciously stepped over.
* ``created_at``      — TIMESTAMPTZ NOT NULL DEFAULT now().
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cgaudit_01"
down_revision: str = "coord_agent_questions_audience"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "cognito_group_admin_events"
_SCHEMA = "auth"

#: Kept in step with ``_COGNITO_AUDIT_ACTIONS`` in
#: ``app/api/v1/endpoints/operations.py``. Adding an action on one side only
#: turns every audit write for it into a constraint failure.
_ACTIONS = (
    "create_group",
    "delete_group",
    "add_user_to_group",
    "remove_user_from_group",
)


def upgrade() -> None:
    # The ``auth`` schema is created by the identity migrations that precede
    # this one; the IF NOT EXISTS keeps a fresh bootstrap from ordering-
    # dependent failure without taking ownership of the schema.
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {_SCHEMA}")

    # Idempotent: skip the table if a prior partial apply already created it.
    # The INDEXES are created unconditionally below with IF NOT EXISTS — an
    # apply that died between the table and the indexes would otherwise stamp
    # as applied with the indexes permanently missing.
    action_list = ",".join(f"'{a}'" for a in _ACTIONS)
    if not sa.inspect(op.get_bind()).has_table(_TABLE, schema=_SCHEMA):
        _create_table(action_list)
    _create_indexes()


def _create_table(action_list: str) -> None:
    op.create_table(
        _TABLE,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("group_name", sa.Text(), nullable=False),
        sa.Column("target_email", sa.Text(), nullable=True),
        sa.Column("target_username", sa.Text(), nullable=True),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            f"action IN ({action_list})",
            name="ck_cognito_group_admin_events_action",
        ),
        schema=_SCHEMA,
    )


def _create_indexes() -> None:
    # "What happened to this group?" is the question an operator arrives
    # with; "what has this admin been doing?" is the one a reviewer arrives
    # with. Both are ordered newest-first.
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_cognito_group_admin_events_group "
        f"ON {_SCHEMA}.{_TABLE} (group_name, created_at DESC)"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_cognito_group_admin_events_actor "
        f"ON {_SCHEMA}.{_TABLE} (actor_user_id, created_at DESC)"
    )


def downgrade() -> None:
    # ``IF EXISTS`` on all three, matching the idempotent upgrade: a
    # downgrade after an upgrade that SKIPPED (table already present) must
    # not be the thing that errors, and an unconditional DROP TABLE beside
    # two guarded DROP INDEXes is an asymmetry waiting to bite.
    op.execute(f"DROP INDEX IF EXISTS {_SCHEMA}.idx_cognito_group_admin_events_actor")
    op.execute(f"DROP INDEX IF EXISTS {_SCHEMA}.idx_cognito_group_admin_events_group")
    op.execute(f"DROP TABLE IF EXISTS {_SCHEMA}.{_TABLE}")
