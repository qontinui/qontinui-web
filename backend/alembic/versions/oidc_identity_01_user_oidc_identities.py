"""auth.user_oidc_identities — per-issuer subjects for generic OIDC sign-in

Revision ID: oidc_identity_01_user_oidc_identities
Revises: plan_library_10_keyset_walk_indexes
Create Date: 2026-10-10

Phase 9 item 1 of ``2026-10-09-spec-front-end-of-the-software-factory``:
qontinui-web accepts user tokens from any configured OpenID Connect issuer
(``OIDC_PROVIDERS``) alongside the Cognito pool. Cognito identities keep
living on ``auth.users.cognito_sub``; every other issuer's identities are
recorded here, keyed by ``(issuer, subject)`` — an OIDC ``sub`` is unique
only within its issuer, so a subject is never looked up without it.

EXPAND-ONLY: creates one new table; nothing existing changes, so a rolled-back
prior app is unaffected (it never reads the table).

Columns:
* ``id``         — UUID PK, default ``gen_random_uuid()``.
* ``user_id``    — UUID NOT NULL, FK ``auth.users.id`` ON DELETE CASCADE.
* ``issuer``     — VARCHAR(2048) NOT NULL, normalised (no trailing slash).
* ``subject``    — VARCHAR(255) NOT NULL, the issuer's ``sub``.
* ``created_at`` — TIMESTAMPTZ NOT NULL DEFAULT now().

Unique ``(issuer, subject)``; index on ``user_id``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "oidc_identity_01_user_oidc_identities"
down_revision = "plan_library_10_keyset_walk_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("user_oidc_identities", schema="auth"):
        return
    op.create_table(
        "user_oidc_identities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("issuer", sa.String(length=2048), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["auth.users.id"],
            ondelete="CASCADE",
            name="fk_user_oidc_identities_user_id",
        ),
        sa.UniqueConstraint(
            "issuer", "subject", name="uq_user_oidc_identities_issuer_subject"
        ),
        schema="auth",
    )
    op.create_index(
        "ix_auth_user_oidc_identities_user_id",
        "user_oidc_identities",
        ["user_id"],
        schema="auth",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_auth_user_oidc_identities_user_id",
        table_name="user_oidc_identities",
        schema="auth",
    )
    op.drop_table("user_oidc_identities", schema="auth")
