"""[throwaway, do not merge] migration-reversal-tested r6 case (m)."""

from alembic import op

revision = "mrt6_case_m"
down_revision = "spawnadm_01_spawn_admission_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER DATABASE qontinui_test SET work_mem = '7MB'")


def downgrade() -> None:
    pass
