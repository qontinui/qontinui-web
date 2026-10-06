"""[throwaway, do not merge] migration-reversal-tested r7 case (p)."""

from alembic import op

revision = "mrt7_case_p"
down_revision = "spawnadm_01_spawn_admission_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("COMMENT ON TABLE coord.spawn_admission_ledger IS E'line1\\nSET x'")


def downgrade() -> None:
    # Differs from the pre-upgrade state only by a comment whose SECOND line
    # differs: the normalizer must keep that line and report it.
    op.execute("COMMENT ON TABLE coord.spawn_admission_ledger IS E'line1\\nSET y'")
