"""add cognito_sub to auth.users

Phase 1 of the unified-Cognito-identity plan. The web backend
dual-accepts AWS Cognito user-pool JWTs alongside the legacy local
FastAPI-Users HS256 token. On first Cognito login a user is
provisioned-or-linked by verified email, and the Cognito subject
(``sub`` claim) is stamped onto the ``auth.users`` row so subsequent
logins resolve directly by subject.

This revision adds the nullable ``cognito_sub`` column plus a unique
index (a Cognito ``sub`` links to at most one local user). Nullable
because pre-existing local email/password users have no Cognito
identity; the legacy local-auth path is untouched.

The column matches ``app/models/user.py``::

    cognito_sub: Mapped[str | None] = mapped_column(
        String, unique=True, index=True, nullable=True
    )

Revision ID: cognito_01_add_cognito_sub
Revises: decision_engine_phase1_kind_nullable
Create Date: 2026-05-29
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cognito_01_add_cognito_sub"
down_revision: str | None = "decision_engine_phase1_kind_nullable"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("cognito_sub", sa.String(), nullable=True),
        schema="auth",
    )
    op.create_index(
        "ix_auth_users_cognito_sub",
        "users",
        ["cognito_sub"],
        unique=True,
        schema="auth",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_auth_users_cognito_sub",
        table_name="users",
        schema="auth",
    )
    op.drop_column("users", "cognito_sub", schema="auth")
