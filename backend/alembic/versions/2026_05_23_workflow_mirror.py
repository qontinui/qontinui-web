"""workflow mirror — project.workflows table

Revision ID: workflow_mirror_2026_05_23
Revises: pair_codes_table
Create Date: 2026-05-23

Phase 3 of the
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``
plan adds a web-PG mirror of workflow definitions so the
``/build/workflows`` dashboard can render a workflow list when the
operator's runner is offline.

The runner remains the source of truth for **execution** of workflows;
``project.workflows`` is purely a browse-cache, written through by the
runner after every local SQLite mutation via ``POST
/api/v1/workflows/sync``.

Schema is intentionally NOT a refactor of the legacy
``project.unified_workflows`` table — that table has a different ownership
model (``created_by_user_id`` only, no tenant) and is consumed by the
older ``/api/v1/unified-workflows`` CRUD that the runner currently
write-syncs into. The mirror sits alongside as a separate, owner-and-
tenant-scoped surface.

Idempotent — uses ``IF NOT EXISTS`` on table + index creates so the
migration is replay-safe (and the symmetric downgrade is ``IF EXISTS``).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "workflow_mirror_2026_05_23"
down_revision: str = "pair_codes_table"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names(schema="project")

    if "workflows" not in existing_tables:
        op.create_table(
            "workflows",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
                comment="Mirrors runner's local UnifiedWorkflow.id.",
            ),
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
                comment="Resolved server-side from the device JWT.",
            ),
            sa.Column(
                "device_id",
                postgresql.UUID(as_uuid=True),
                nullable=True,
                comment="The runner device that authored this mirror entry.",
            ),
            sa.Column(
                "owner_user_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
                comment="The operator that owns this workflow.",
            ),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column(
                "definition",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                comment="Full UnifiedWorkflow payload from the runner.",
            ),
            sa.Column(
                "runner_updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                comment="Runner's local mtime — used for last-write-wins.",
            ),
            sa.Column(
                "mirrored_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["device_id"],
                ["coord.devices.device_id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["owner_user_id"],
                ["auth.users.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            schema="project",
        )

    # Indices — created via IF NOT EXISTS so re-run is safe.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_tenant_owner "
        "ON project.workflows (tenant_id, owner_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_tenant_id "
        "ON project.workflows (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_owner_user_id "
        "ON project.workflows (owner_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_category "
        "ON project.workflows (category)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS project.ix_workflows_tenant_owner")
    op.execute("DROP INDEX IF EXISTS project.ix_workflows_tenant_id")
    op.execute("DROP INDEX IF EXISTS project.ix_workflows_owner_user_id")
    op.execute("DROP INDEX IF EXISTS project.ix_workflows_category")
    op.execute("DROP TABLE IF EXISTS project.workflows")
