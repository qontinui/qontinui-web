"""devenv_07: org sharing (organization_id on applications/environments)

Revision ID: devenv_07_org_sharing
Revises: a1cc120c0fba
Create Date: 2026-07-18

P4 of plan ``2026-07-01-devenv-phase2-binding-history-remediation-sharing``.
Every ``devenv.*`` row is owner-scoped today, so an Application/Environment
cannot be shared with a team. This adds a nullable ``organization_id`` to
``devenv.applications`` and ``devenv.environments``:

* NULL  → personal (visible to ``owner_user_id`` only — the prior behavior).
* set   → org-shared: visible to the owner AND every member of that
  ``auth.organizations`` row except ``helper``; ``owner``/``admin``/``member``
  roles may edit, ``viewer`` is read-only. Enforced in the repository/endpoint
  layer (``app.repositories.devenv``), reusing the existing
  ``auth.team_members`` membership model — no new membership table.

Column notes:
* ``organization_id`` — **soft reference to ``auth.organizations.id``,
  deliberately NOT a DB FK.** This matches the devenv convention for
  cross-schema pointers (see ``coord_device_id`` on ``devenv.machines`` and
  ``tenant_id`` on the canonical change log), and avoids adding an
  ``auth`` ↔ ``devenv`` edge to ``Base.metadata.sorted_tables`` — the exact
  FK-cycle class commit ``c479a7a9`` had to break for the unit-test harness.
  Org existence/membership is validated in application code; a deleted org
  simply leaves a dangling pointer that resolves as "no members" (the row
  degrades to owner-only visibility).

Machines stay strictly personal — no org column there. An org-shared
environment's machine-derived reads (config rows, drift, canonical history)
are authorized through the ENVIRONMENT's accessibility instead.

Forward-only + additive (nullable columns + indexes on existing tables).
Safe for a running app on the prior schema.

``down_revision`` = the current alembic head (``a1cc120c0fba``).
Per the fleet convention (and as ``devenv_04``/``devenv_05`` did), coord
re-points at land time if main advances, and ``alembic-graph-pr`` CI guards
forks.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers
revision = "devenv_07_org_sharing"
down_revision = "a1cc120c0fba"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    # Soft reference to auth.organizations.id (NOT a FK) — see module docstring.
    op.add_column(
        "applications",
        sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_app_org",
        "applications",
        ["organization_id"],
        schema=_SCHEMA,
    )
    op.add_column(
        "environments",
        sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_env_org",
        "environments",
        ["organization_id"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("idx_devenv_env_org", table_name="environments", schema=_SCHEMA)
    op.drop_column("environments", "organization_id", schema=_SCHEMA)
    op.drop_index("idx_devenv_app_org", table_name="applications", schema=_SCHEMA)
    op.drop_column("applications", "organization_id", schema=_SCHEMA)
