"""Create app_deploy_state table for fleet-fresh deployment tracking.

Revision ID: app_deploy_state_tracking
Revises: project_apps_p1a_auto_fresh_fields
Create Date: 2026-07-01 02:00:00.000000

P3 follow-on: tracks deployed state per (device, app_id) for the auto-fresh
engine to record success/failure of pull+build+restart operations.

Schema (project.app_deploy_state):
- device_id: UUID — runner device publishing this state
- app_id: TEXT — app being deployed
- deployed_sha: TEXT NULL — HEAD SHA currently running (NULL if unknown)
- freshness: TEXT — 'fresh' (deployed_sha == upstream), 'building' (in progress),
  'failed' (last build/restart failed)
- deployed_at: TIMESTAMPTZ — when deployed_sha was deployed
- last_error: TEXT NULL — error message if freshness='failed'
- updated_at: TIMESTAMPTZ — when this row was last updated

Primary key: (device_id, app_id)
Index: (app_id) for dispatcher fan-out queries

Partial index: (device_id) WHERE freshness='fresh' for "find fresh hosts for app"
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "app_deploy_state_tracking"
down_revision: str | None = "project_apps_p1a_auto_fresh_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create app_deploy_state table for deployment tracking."""
    op.execute("CREATE SCHEMA IF NOT EXISTS project")

    # Main table
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.app_deploy_state (
            device_id UUID NOT NULL,
            app_id TEXT NOT NULL,
            deployed_sha TEXT,
            freshness TEXT NOT NULL DEFAULT 'failed',
            deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_error TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (device_id, app_id)
        )
        """
    )

    # The runner ALSO self-heals this table (pg/mod.rs, mirror DDL) — a
    # runner that booted before this migration owns the existing table, so
    # every ALTER below must be idempotent against that variant.
    op.execute(
        "ALTER TABLE project.app_deploy_state "
        "ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ NOT NULL DEFAULT now()"
    )

    # Freshness constraint (fresh/building/failed) — DROP-then-ADD, the
    # collision-safe convention (PG has no ADD CONSTRAINT IF NOT EXISTS).
    op.execute(
        "ALTER TABLE project.app_deploy_state "
        "DROP CONSTRAINT IF EXISTS app_deploy_state_freshness_check"
    )
    op.execute(
        """
        ALTER TABLE project.app_deploy_state ADD CONSTRAINT
        app_deploy_state_freshness_check
        CHECK (freshness IN ('fresh', 'building', 'failed'))
        """
    )

    # Index for dispatcher routing by app_id
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_app_deploy_state_app_id
        ON project.app_deploy_state (app_id)
        """
    )

    # Partial index for "find fresh hosts for app" queries
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_app_deploy_state_fresh_hosts
        ON project.app_deploy_state (device_id)
        WHERE freshness = 'fresh'
        """
    )


def downgrade() -> None:
    """Remove app_deploy_state table."""
    op.execute("DROP TABLE IF EXISTS project.app_deploy_state")
