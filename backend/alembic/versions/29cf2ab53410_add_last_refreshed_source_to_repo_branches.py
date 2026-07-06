"""Add last_refreshed_source to coord.repo_branches

Provenance of the row's current freshness value, feeding a coord PR-state
observability surface. The value is one of ``webhook`` | ``graphql_hydrate``
| ``rest_heal`` | ``cache`` (written by coord as a plain string; no CHECK
constraint / enum so coord owns the vocabulary). The column is nullable and
defaults NULL — every row that pre-dates this migration is unaffected. No
backfill, no index.

* ``last_refreshed_source VARCHAR(32)`` — nullable provenance tag.

Revision ID: 29cf2ab53410
Revises: coord_tasks_tenant_id
Create Date: 2026-07-05

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "29cf2ab53410"
down_revision: str | None = "coord_device_status_mt_pk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "repo_branches",
        sa.Column("last_refreshed_source", sa.String(length=32), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("repo_branches", "last_refreshed_source", schema="coord")
