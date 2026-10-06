"""[throwaway, do not merge] migration-reversal-tested r7 case (a)."""

import sqlalchemy as sa
from alembic import op

revision = "mrt7_case_a"
down_revision = "spawnadm_01_spawn_admission_ledger"
branch_labels = None
depends_on = None

FUNC = """
CREATE FUNCTION mrt7_case_a_fn() RETURNS integer
    LANGUAGE plpgsql
    AS $body$
BEGIN
-- a body line starting with two dashes, compared as code
  RETURN 1;
END
$body$;
"""


def upgrade() -> None:
    op.create_table(
        "mrt7_case_a",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("a", sa.Text, server_default=sa.text("'L1\n    K'::text")),
        sa.Column("b", sa.Text, server_default=sa.text("'L2\n    J'::text")),
    )
    op.execute("COMMENT ON TABLE mrt7_case_a IS E'line1\\nSET x'")
    op.execute(FUNC)


def downgrade() -> None:
    op.execute("DROP FUNCTION mrt7_case_a_fn()")
    op.drop_table("mrt7_case_a")
