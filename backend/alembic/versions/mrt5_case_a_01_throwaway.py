"""[throwaway, do not merge] migration-reversal-tested r5 case (a)

Revision ID: mrt5_case_a_01
Revises: coord_agent_questions_effect
Create Date: 2026-10-06
"""

from alembic import op

revision = "mrt5_case_a_01"
down_revision = "coord_agent_questions_effect"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TABLE public.mrt5_case_a (id integer PRIMARY KEY, note text)")


def downgrade() -> None:
    op.execute("DROP TABLE public.mrt5_case_a")
