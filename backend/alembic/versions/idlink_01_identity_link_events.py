"""identity link events audit table (cross-IdP account linking)

Revision ID: idlink_01_identity_link_events
Revises: c5d0dbe907b5
Create Date: 2026-05-31

Cross-IdP account-linking (Option A — Cognito-native linking). Creates
``auth.identity_link_events`` — one append-only audit row per link /
unlink performed via the ``/api/v1/auth/identities*`` endpoints.

EXPAND-ONLY / forward-only (per the repo migration convention): this
revision only CREATEs a new table — no drops, fully backward-compatible
with a rolled-back prior app.

Columns:
* ``id``              — UUID PK, default ``gen_random_uuid()``.
* ``user_id``         — UUID NOT NULL. The account the identity belongs to.
* ``action``          — TEXT NOT NULL CHECK IN ('link','unlink').
* ``provider``        — TEXT NOT NULL. The federated provider name.
* ``provider_user_id``— TEXT nullable. The provider-scoped user id.
* ``actor_user_id``   — UUID NOT NULL. Who performed the action.
* ``created_at``      — TIMESTAMPTZ NOT NULL DEFAULT now().
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "idlink_01_identity_link_events"
down_revision: str = "c5d0dbe907b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if a prior partial apply already created the table.
    if sa.inspect(op.get_bind()).has_table(
        "identity_link_events", schema="auth"
    ):
        return
    op.create_table(
        "identity_link_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("provider_user_id", sa.Text(), nullable=True),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "action IN ('link','unlink')",
            name="ck_identity_link_events_action",
        ),
        schema="auth",
    )
    op.create_index(
        "idx_identity_link_events_user",
        "identity_link_events",
        ["user_id", sa.text("created_at DESC")],
        schema="auth",
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS auth.idx_identity_link_events_user")
    op.drop_table("identity_link_events", schema="auth")
