"""[throwaway, do not merge] migration-reversal-tested r8 case (a)."""

import sqlalchemy as sa
from alembic import op

revision = "mrt8_case_a"
down_revision = "spawnadm_01_spawn_admission_ledger"
branch_labels = None
depends_on = None

FUNC = """
CREATE FUNCTION mrt8_case_a_fn() RETURNS integer
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
        "mrt8_case_a",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("a", sa.Text, server_default=sa.text("'L1\n    K'::text")),
        sa.Column("b", sa.Text, server_default=sa.text("'L2\n    J'::text")),
    )
    op.execute("COMMENT ON TABLE mrt8_case_a IS E'line1\\nSET x'")
    op.execute(FUNC)


# The downgrade may run in a connection whose search_path differs from the
# upgrade's, so it drops each object in whatever schema the upgrade put it.
DROP = """
DO $drop$
DECLARE s text;
BEGIN
  SELECT pronamespace::regnamespace::text INTO STRICT s FROM pg_proc WHERE proname = 'mrt8_case_a_fn';
  EXECUTE format('DROP FUNCTION %s.mrt8_case_a_fn()', s);
  SELECT relnamespace::regnamespace::text INTO STRICT s FROM pg_class WHERE relname = 'mrt8_case_a' AND relkind = 'r';
  EXECUTE format('DROP TABLE %s.mrt8_case_a', s);
END
$drop$;
"""


def downgrade() -> None:
    op.execute(DROP)
