"""[throwaway, do not merge] migration-reversal-tested r6 case (o)."""

from alembic import op

revision = "mrt6_case_o"
down_revision = "spawnadm_01_spawn_admission_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE ROLE mrt6_role")


def downgrade() -> None:
    pass
