"""[throwaway, do not merge] migration-reversal-tested r6 case (a)."""

import sqlalchemy as sa
from alembic import op

revision = "mrt6_case_a"
down_revision = "spawnadm_01_spawn_admission_ledger"
branch_labels = None
depends_on = None

FUNC = """
CREATE FUNCTION public.mrt6_case_a_fn() RETURNS integer
    LANGUAGE plpgsql
    AS $body$
BEGIN
-- a body line starting with two dashes, compared as code
  RETURN 1;
END
$body$;
"""


def upgrade() -> None:
    op.create_table("mrt6_case_a", sa.Column("id", sa.Integer, primary_key=True), sa.Column("note", sa.Text))
    op.execute("COMMENT ON TABLE public.mrt6_case_a IS 'amount in $$'")
    op.execute(FUNC)
    op.create_table("mrt6_case_a2", sa.Column("id", sa.Integer, primary_key=True))
    op.execute("COMMENT ON TABLE public.mrt6_case_a2 IS 'amount in $$'")


def downgrade() -> None:
    op.drop_table("mrt6_case_a2")
    op.execute("DROP FUNCTION public.mrt6_case_a_fn()")
    op.drop_table("mrt6_case_a")
