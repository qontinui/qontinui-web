"""Add P1a auto-fresh fields to project.apps for fleet-fresh engine.

Revision ID: project_apps_p1a_auto_fresh_fields
Revises: coord_primary_trees_app_id_r0
Create Date: 2026-07-01 01:30:00.000000

``project.apps`` is historically RUNNER-authored (spec-multi-app Stream B:
Atlas + a ``CREATE TABLE IF NOT EXISTS`` self-heal in the runner's
``pg/mod.rs``) — no alembic revision creates it. This migration therefore
must tolerate BOTH orderings:

- **fresh DB, migrator runs first** (canonical-stack ``alembic upgrade head``
  precedes any runner boot): ``CREATE TABLE IF NOT EXISTS`` below provisions
  the table so the ``ALTER``s have a target;
- **existing DB, new runner booted first**: the runner's own
  ``ADD COLUMN IF NOT EXISTS`` self-heal already added these columns, so the
  ``IF NOT EXISTS`` ALTERs no-op instead of failing with DuplicateColumn.

The CREATE mirrors the runner self-heal DDL byte-for-byte (keep them in
lockstep — the runner is the canonical author).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "project_apps_p1a_auto_fresh_fields"
down_revision: str | None = "coord_primary_trees_app_id_r0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS project")
    # Mirror of the runner self-heal (pg/mod.rs) — provisions fresh DBs where
    # the migrator runs before any runner boot; no-ops everywhere else.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.apps (
            app_id           TEXT PRIMARY KEY,
            repo_root        TEXT NOT NULL,
            ui_bridge_url    TEXT NOT NULL,
            display_name     TEXT NOT NULL,
            created_at_ms    BIGINT NOT NULL,
            last_seen_at_ms  BIGINT NOT NULL,
            auth_required    BOOLEAN NOT NULL DEFAULT false,
            red_threshold    DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            yellow_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.8,
            update_strategy  TEXT NOT NULL DEFAULT 'pull_only',
            build_command    TEXT,
            start_command    TEXT
        )
        """
    )
    # Idempotent column adds for DBs where the pre-P1a runner created the
    # 6-column table (and where a post-P1a runner already healed these,
    # the IF NOT EXISTS no-ops).
    op.execute(
        "ALTER TABLE project.apps ADD COLUMN IF NOT EXISTS "
        "auth_required BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE project.apps ADD COLUMN IF NOT EXISTS "
        "red_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.5"
    )
    op.execute(
        "ALTER TABLE project.apps ADD COLUMN IF NOT EXISTS "
        "yellow_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.8"
    )
    op.execute(
        "ALTER TABLE project.apps ADD COLUMN IF NOT EXISTS "
        "update_strategy TEXT NOT NULL DEFAULT 'pull_only'"
    )
    op.execute(
        "ALTER TABLE project.apps ADD COLUMN IF NOT EXISTS build_command TEXT"
    )
    op.execute(
        "ALTER TABLE project.apps ADD COLUMN IF NOT EXISTS start_command TEXT"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_apps_last_seen "
        "ON project.apps (last_seen_at_ms DESC)"
    )


def downgrade() -> None:
    """Drop only the P1a columns; the table itself is runner-authored."""
    op.execute("ALTER TABLE project.apps DROP COLUMN IF EXISTS start_command")
    op.execute("ALTER TABLE project.apps DROP COLUMN IF EXISTS build_command")
    op.execute("ALTER TABLE project.apps DROP COLUMN IF EXISTS update_strategy")
