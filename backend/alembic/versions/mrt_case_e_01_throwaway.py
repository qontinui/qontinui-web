"""[throwaway, do not merge] migration-reversal-tested case (e)

Revision ID: mrt_case_e_01
Revises: coord_agent_questions_effect
Create Date: 2026-10-05

Verification fixture for plan
2026-10-05-coord-clears-a-migration-on-a-reversal-gate-it-cannot-attribute,
Phase 1. Never lands: the PR carrying it is a draft and is closed unmerged.

``upgrade()`` and ``downgrade()`` each PROVE their op ran by reading the
catalog afterwards, so a no-op'd ``alembic.op`` fails loudly here instead of
passing silently.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "mrt_case_e_01"
down_revision: str | Sequence[str] | None = "coord_agent_questions_effect"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "mrt_throwaway_e1"


def _exists() -> object:
    return (
        op.get_bind()
        .execute(sa.text(f"SELECT to_regclass('web.{TABLE}')"))
        .scalar()
    )


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        schema="web",
    )
    found = _exists()
    print(f"MRT-PROBE upgrade: web.{TABLE} after op.create_table -> {found}", flush=True)
    if found is None:
        raise RuntimeError("op.create_table created nothing: alembic.op is not the real op")


def downgrade() -> None:
    op.drop_table(TABLE, schema="web")
    found = _exists()
    print(f"MRT-PROBE downgrade: web.{TABLE} after op.drop_table -> {found}", flush=True)
    if found is not None:
        raise RuntimeError("op.drop_table dropped nothing: alembic.op is not the real op")
