"""[throwaway, do not merge] migration-reversal-tested r4 case (k)

Revision ID: mrt4_case_k_01
Revises: coord_agent_questions_effect
Create Date: 2026-10-06

Verification fixture: an idempotent upgrade with a no-op downgrade; the
schema comparison must catch the table it leaves behind.
Never lands: the PR is a draft and is closed unmerged.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "mrt4_case_k_01"
down_revision: str | Sequence[str] | None = "coord_agent_questions_effect"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE TABLE IF NOT EXISTS web.mrt4_throwaway_k (id integer)")


def downgrade() -> None:
    pass
