"""merge pull_decision_resolutions_index + twin_ci_01_ci_runs heads

Two migrations branched off ``cognito_legacy_auth_teardown_02`` and merged to
main independently (``pull_decision_resolutions_index`` via web #362,
``twin_ci_01_ci_runs`` via web #365), creating a forked second head. This is a
no-op merge node that re-linearizes the chain so ``alembic upgrade head`` (and
the coord migrator image / RDS migrate) resolve to a single head again.

Revision ID: merge_pulldecision_ci_heads
Revises: pull_decision_resolutions_index, twin_ci_01_ci_runs
Create Date: 2026-05-31 08:20:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "merge_pulldecision_ci_heads"
# NOTE: keep this tuple on a SINGLE line — the alembic-heads-pr gate parses
# down_revision with a line-based regex and will miscount heads otherwise.
down_revision: str | None = ("pull_decision_resolutions_index", "twin_ci_01_ci_runs")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
