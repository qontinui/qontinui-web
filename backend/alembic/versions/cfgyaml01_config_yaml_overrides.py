"""add config_yaml_overrides JSONB to coord.tenant_repo_profiles

Zero-touch onboarding Phase 2 (config-as-code) adds a per-repo
``.qontinui/config.yml`` tier that overrides ``tenant_repo_profiles`` at the
TOP of the three-tier settings resolver (global -> tenant -> repo -> config.yml).
coord's ``push`` handler parses that file and must PERSIST the parsed overrides
so a later verdict run (a different request) can resolve them; the resolver
reads SQL only. Store them as a nullable JSONB column on the existing
``coord.tenant_repo_profiles`` row, keyed by the table's existing
``(tenant_id, repo)`` identity. NULL means "no in-repo config" -> the tier is
absent and resolution falls through to the existing ``trp.*`` overrides.

Cross-repo deploy gate: ``coord.*`` schema is owned by this (web) alembic. This
migration MUST be applied before the coord resolver change that adds the column
to ``fetch_profile``'s SELECT lands/deploys, or coord's pre-deploy
required-columns drift gate wedges. Hence this column is added here, ahead of
the coord change, and is harmless until coord reads it.

Revision ID: cfgyaml01_config_yaml_overrides
Revises: coord_sessions_provider
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "cfgyaml01_config_yaml_overrides"
down_revision = "coord_sessions_provider"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "ADD COLUMN IF NOT EXISTS config_yaml_overrides JSONB"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP COLUMN IF EXISTS config_yaml_overrides"
    )
