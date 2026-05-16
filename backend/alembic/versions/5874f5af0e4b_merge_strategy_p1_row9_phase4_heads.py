"""merge strategy_p1 + row9_phase4 heads

Revision ID: 5874f5af0e4b
Revises: row_9_phase_4_01_coord_alerts, strategy_p1_02_seed
Create Date: 2026-05-16

Empty merge revision joining the two sibling heads created
concurrently on main: `row_9_phase_4_01_coord_alerts` (Row 9 Phase 4
fleet-health) and `strategy_p1_02_seed` (Strategy Phase 1). Same
shape/precedent as `8e1c421417fd_merge_heads.py` — required so the
`alembic-heads-pr` gate sees a single head once the Strategy Phase 1
web PR merges (second of the two to land). No DDL; ordering of the
two branches is independent.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "5874f5af0e4b"
down_revision: str | None = (
    "row_9_phase_4_01_coord_alerts",
    "strategy_p1_02_seed",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
