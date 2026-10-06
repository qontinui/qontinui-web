"""[throwaway, do not merge] migration-reversal-tested r6 case (n)."""

from alembic import op

revision = "mrt6_case_n"
down_revision = "spawnadm_01_spawn_admission_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The base installs pg_stat_statements at the image default (1.10 on
    # pg16) in schema `project` and nothing depends on it, so re-creating it
    # there at 1.9 changes the extension VERSION and nothing pg_dump writes.
    op.execute("DROP EXTENSION pg_stat_statements")
    op.execute("CREATE EXTENSION pg_stat_statements VERSION '1.9' SCHEMA project")


def downgrade() -> None:
    pass
