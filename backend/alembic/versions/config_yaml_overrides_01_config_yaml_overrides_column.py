"""pr_merge — per-repo ``.qontinui/config.yml`` policy override column

Revision ID: config_yaml_overrides_01
Revises: coord_sessions_provider
Create Date: 2026-06-29

Plan 2026-06-… zero-touch repo PR-merge policy (Phase 2).

Adds a single **nullable** JSONB column to ``coord.tenant_repo_profiles``
storing the parsed ``.qontinui/config.yml`` policy for the (tenant, repo):

    coord.tenant_repo_profiles.config_yaml_overrides

This becomes the HIGHEST-PRECEDENCE tier of coord's PR-merge settings
resolver. It is written by coord's push-event ingest (which parses the
repo's checked-in ``.qontinui/config.yml`` on every push to the default
branch) and read by ``pr_merge::settings::fetch_profile``, layered ABOVE
the existing per-repo / per-tenant / env / default tiers:

    1. tenant_repo_profiles.config_yaml_overrides   <-- this column (new top tier)
    2. tenant_repo_profiles.<*_override> columns
    3. tenant_merge_settings.<*> columns
    4. env  QONTINUI_* defaults
    5. Defaults::*

NULL = "no checked-in config.yml policy for this repo" → coord inherits
the existing tiers unchanged (the column is purely additive; a repo with
no ``.qontinui/config.yml`` behaves exactly as before).

Decoupled deploy order: coord reads this column via a SEPARATE,
best-effort query (a separate coord change consumes it) and falls through
to the existing tiers cleanly when the column is absent — so there is no
coord<->web deploy-ordering constraint for this migration.

* **alembic is the SOLE author of the coord.* schema** — no Rust
  ``CREATE``/``ALTER`` self-heal for this column (the coord crate's
  ``coord_schema_authorship`` test asserts the live Rust coord.* DDL set
  is empty). The Rust side only SELECT/INSERT/UPDATEs it.

Idempotency: the column add is guarded by an inspector check (skip
``add_column`` if the column already exists). Re-running against an
already-migrated DB is a no-op. ``downgrade()`` drops the column.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "config_yaml_overrides_01"
down_revision: str = "coord_sessions_provider"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the nullable JSONB ``config_yaml_overrides`` column."""

    if not _has_column("tenant_repo_profiles", "config_yaml_overrides"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column(
                "config_yaml_overrides",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
            ),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the ``config_yaml_overrides`` column."""

    if _has_column("tenant_repo_profiles", "config_yaml_overrides"):
        op.drop_column(
            "tenant_repo_profiles",
            "config_yaml_overrides",
            schema="coord",
        )
