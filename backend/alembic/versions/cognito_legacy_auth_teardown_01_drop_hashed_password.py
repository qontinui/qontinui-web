"""make auth.users.hashed_password nullable (Cognito-only teardown, EXPAND phase)

Cognito became the sole user-authentication mechanism: the entire local
FastAPI-Users password stack was removed (login/refresh/logout, password reset,
change-password, local token minting) and the ORM model (``app/models/user.py``)
no longer maps ``hashed_password`` at all. New Cognito-provisioned ``auth.users``
rows are inserted WITHOUT a password, so the column's original ``NOT NULL``
constraint would reject those INSERTs — dropping the constraint is required for
Cognito provisioning to work.

This is the EXPAND phase of an expand/contract column removal, and it is
deliberately BACKWARD-COMPATIBLE:

* the currently-live (pre-teardown) app still writes an unusable hash, which a
  nullable column accepts; and
* the new Cognito-only app writes nothing, which a nullable column also accepts.

That matters because ``.github/workflows/migrate.yml`` applies migrations
FORWARD-ONLY and they are explicitly NOT covered by the deploy auto-rollback: a
post-deploy auto-rollback reverts the *application* (ECS task-def) to the prior
revision but never the schema. A hard ``DROP COLUMN`` here would strand a
rolled-back prior app (which maps + SELECTs ``hashed_password``) against a schema
missing the column — the exact failure the forward-only rule forbids. Making the
column nullable keeps every in-flight and rollback-target app working.

The physical ``DROP COLUMN hashed_password`` (which also erases the residual
legacy password hashes) is the CONTRACT phase, deferred to a follow-up migration
once the Cognito-only app has been stable on prod and is past the deploy rollback
window, so no rollback can target an app that still writes the column. See the
cognito-legacy-auth-teardown follow-up note.

Only ``hashed_password`` is touched. The other FastAPI-Users-origin columns
(``is_active`` / ``is_superuser`` / ``is_verified``) plus ``cognito_sub`` are
still used and are intentionally retained.

Revision ID: cognito_legacy_auth_teardown_01
Revises: twin_01_coord_migration_observations
Create Date: 2026-05-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cognito_legacy_auth_teardown_01"
down_revision: str | None = "twin_01_coord_migration_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # EXPAND: drop the NOT NULL constraint so Cognito-only provisioning (which
    # supplies no password) can INSERT. Backward-compatible with the prior app.
    op.alter_column(
        "users",
        "hashed_password",
        existing_type=sa.String(length=1024),
        nullable=True,
        schema="auth",
    )


def downgrade() -> None:
    # Reverse the constraint relaxation. Not data-safe if any NULLs exist (the
    # whole point of the teardown is that they will) — migrations are
    # forward-only per migrate.yml; this exists only for symmetry.
    op.alter_column(
        "users",
        "hashed_password",
        existing_type=sa.String(length=1024),
        nullable=False,
        schema="auth",
    )
