"""drop auth.users.hashed_password (Cognito-only teardown, CONTRACT phase)

Contract phase of the expand/contract removal begun in
``cognito_legacy_auth_teardown_01`` (which made the column nullable). Cognito is
the sole auth mechanism; the local FastAPI-Users password stack was deleted, the
ORM model (``app/models/user.py``) no longer maps ``hashed_password``, and the
column has been NULL/unused on every live row for the bake window since T3
shipped. This physically drops it (also erasing any residual legacy hashes).

Safe to apply now per the forward-only rule in ``.github/workflows/migrate.yml``:
the deploy auto-rollback targets the last-known-good task-def, which is a
post-teardown image that does NOT map ``hashed_password``, so no rollback target
SELECTs the column. (A pre-teardown image would — but the one-step auto-rollback
never reaches that far back, and T3 has been stable in prod.)

Downgrade re-adds the column NULLABLE (the original was NOT NULL, but a re-added
column has no password values to backfill — nullable is the only safe
reinstatement; migrations are forward-only regardless).

Revision ID: cognito_legacy_auth_teardown_02
Revises: coord_primary_trees_local_ahead
Create Date: 2026-05-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cognito_legacy_auth_teardown_02"
down_revision: str | None = "coord_primary_trees_local_ahead"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("users", "hashed_password", schema="auth")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column("hashed_password", sa.String(length=1024), nullable=True),
        schema="auth",
    )
