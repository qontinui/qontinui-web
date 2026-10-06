"""[throwaway, do not merge] migration-reversal-tested r4 case (j2)

Revision ID: mrt4_case_j2_01
Revises: coord_agent_questions_effect
Create Date: 2026-10-06

Verification fixture: a downgrade that tampers alembic_version (INSERT a
second row, so alembic's own UPDATE still matches one row).
Never lands: the PR is a draft and is closed unmerged.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "mrt4_case_j2_01"
down_revision: str | Sequence[str] | None = "coord_agent_questions_effect"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE TABLE web.mrt4_throwaway_j2 (id integer)")


def downgrade() -> None:
    op.execute("DROP TABLE web.mrt4_throwaway_j2")
    op.execute("INSERT INTO alembic_version (version_num) VALUES ('bogus')")
