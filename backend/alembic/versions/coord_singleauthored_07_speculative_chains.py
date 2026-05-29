"""coord.speculative_chains — migrate single-authored Rust self-heal to alembic

Revision ID: coord_singleauthored_07_speculative_chains
Revises: coord_singleauthored_06_restack_cascades
Create Date: 2026-05-29

Mirrors
``qontinui-coord/src/merge_scheduler.rs::ensure_speculative_chains_table``.

FK ORDERING: ``proposal_id`` references ``coord.merge_proposals(proposal_id)``,
an alembic-owned table created in an earlier revision, so this migration
(chained after it on the linear head) finds the parent present on a fresh DB.
Do NOT reorder this revision ahead of the ``coord.merge_proposals`` migration.
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_07_speculative_chains"
down_revision: str | Sequence[str] | None = "coord_singleauthored_06_restack_cascades"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.speculative_chains (
            chain_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo            TEXT NOT NULL,
            position        INTEGER NOT NULL,
            proposal_id     UUID NOT NULL REFERENCES coord.merge_proposals(proposal_id),
            base_sha        TEXT NOT NULL,
            speculative_tip TEXT,
            ci_status       TEXT NOT NULL DEFAULT 'pending',
            ci_run_url      TEXT,
            invalidated     BOOLEAN NOT NULL DEFAULT false,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT speculative_chains_ci_status_chk
                CHECK (ci_status IN ('pending','green','red','invalidated'))
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_speculative_chains_repo_position
            ON coord.speculative_chains (repo, position) WHERE NOT invalidated
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_speculative_chains_proposal
            ON coord.speculative_chains (proposal_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_speculative_chains_ci_status
            ON coord.speculative_chains (ci_status) WHERE NOT invalidated
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_speculative_chains_ci_status")
    op.execute("DROP INDEX IF EXISTS coord.idx_speculative_chains_proposal")
    op.execute("DROP INDEX IF EXISTS coord.idx_speculative_chains_repo_position")
    op.execute("DROP TABLE IF EXISTS coord.speculative_chains")
