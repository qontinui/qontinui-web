"""coord.pending_pr_dependencies — migrate single-authored Rust self-heal

Revision ID: coord_singleauthored_05_pending_pr_dependencies
Revises: coord_singleauthored_04_memory_federation_reports
Create Date: 2026-05-29

Mirrors
``qontinui-coord/src/pending_pr_deps.rs::ensure_pending_pr_deps_table``.
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_05_pending_pr_dependencies"
down_revision: str | Sequence[str] | None = "coord_singleauthored_04_memory_federation_reports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pending_pr_dependencies (
            id                  UUID NOT NULL DEFAULT gen_random_uuid(),
            deciding_session_id UUID NOT NULL,
            downstream_repo     TEXT NOT NULL,
            downstream_branch   TEXT NOT NULL,
            upstream_repo       TEXT NOT NULL,
            upstream_pr_number  INTEGER NOT NULL,
            tenant_id           UUID NOT NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (id),
            UNIQUE (deciding_session_id, upstream_repo, upstream_pr_number, tenant_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pending_pr_deps_downstream
            ON coord.pending_pr_dependencies (downstream_repo, downstream_branch, tenant_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pending_pr_deps_tenant_id
            ON coord.pending_pr_dependencies (tenant_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_pending_pr_deps_tenant_id")
    op.execute("DROP INDEX IF EXISTS coord.idx_pending_pr_deps_downstream")
    op.execute("DROP TABLE IF EXISTS coord.pending_pr_dependencies")
