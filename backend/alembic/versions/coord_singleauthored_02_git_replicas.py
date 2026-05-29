"""coord.git_replicas — migrate single-authored Rust self-heal to alembic

Revision ID: coord_singleauthored_02_git_replicas
Revises: coord_singleauthored_01_gates
Create Date: 2026-05-29

Mirrors ``qontinui-coord/src/git_replication.rs::ensure_git_replicas_table``
(the production self-heal; the `git_replicas` DDL inside that file's
``#[cfg(test)] mod tests`` is a throwaway-PG fixture and is NOT migrated).
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_02_git_replicas"
down_revision: str | Sequence[str] | None = "coord_singleauthored_01_gates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.git_replicas (
            replica_id           UUID PRIMARY KEY,
            holder_id            UUID NOT NULL,
            endpoint             TEXT NOT NULL,
            state                TEXT NOT NULL,
            synced_through_token BIGINT NOT NULL DEFAULT 0,
            last_heartbeat_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_ack_at          TIMESTAMPTZ
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.git_replicas")
