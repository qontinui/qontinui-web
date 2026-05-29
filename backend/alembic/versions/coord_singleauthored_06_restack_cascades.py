"""coord.restack_cascades — migrate single-authored Rust self-heal to alembic

Revision ID: coord_singleauthored_06_restack_cascades
Revises: coord_singleauthored_05_pending_pr_dependencies
Create Date: 2026-05-29

Mirrors ``qontinui-coord/src/restack_engine.rs::ensure_restack_cascades_table``
(the production self-heal; the `stack_edges` / `restack_log` DDL in that file's
``#[cfg(test)]`` blocks are throwaway-PG fixtures and are already alembic-owned
via the substrate migrations).
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_06_restack_cascades"
down_revision: str | Sequence[str] | None = "coord_singleauthored_05_pending_pr_dependencies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.restack_cascades (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo               TEXT NOT NULL,
            old_parent_sha     TEXT NOT NULL,
            new_main_tip       TEXT NOT NULL,
            status             TEXT NOT NULL DEFAULT 'in-flight',
            leased_by          UUID NULL,
            lease_fenced_token BIGINT NULL,
            leased_at          TIMESTAMPTZ NULL,
            attempts           INTEGER NOT NULL DEFAULT 0,
            tenant_id          UUID NULL,
            error              TEXT NULL,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT restack_cascades_status_chk
                CHECK (status IN ('in-flight','completed','failed'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_cascades_inflight
            ON coord.restack_cascades (lease_fenced_token, leased_at)
            WHERE status = 'in-flight'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_restack_cascades_inflight")
    op.execute("DROP TABLE IF EXISTS coord.restack_cascades")
