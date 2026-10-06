"""throwaway: migration-reversal-tested r3 case (a''), do not merge."""

import sqlalchemy as sa
from alembic import op

revision = "mrt3_ok_01"
down_revision = "coord_agent_questions_effect"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("mrt3_ok_probe", sa.Column("id", sa.Integer(), primary_key=True))


def downgrade() -> None:
    op.drop_table("mrt3_ok_probe")
