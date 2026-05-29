"""coord.leader_lease — migrate single-authored Rust self-heal to alembic

Revision ID: coord_singleauthored_03_leader_lease
Revises: coord_singleauthored_02_git_replicas
Create Date: 2026-05-29

Mirrors ``qontinui-coord/src/leader.rs::ensure_leader_lease_table`` (the
production author; the copies in ``git_replication.rs`` and ``leader.rs``
``#[cfg(test)]`` blocks are throwaway-PG fixtures and are NOT migrated).
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_03_leader_lease"
down_revision: str | Sequence[str] | None = "coord_singleauthored_02_git_replicas"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.leader_lease (
            scope         TEXT PRIMARY KEY,
            holder_id     UUID NOT NULL,
            fenced_token  BIGINT NOT NULL,
            heartbeat_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.leader_lease")
