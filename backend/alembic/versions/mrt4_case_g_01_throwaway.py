"""[throwaway, do not merge] migration-reversal-tested r4 case (g)

Revision ID: mrt4_case_g_01
Revises: coord_agent_questions_effect
Create Date: 2026-10-06

Verification fixture: an os._exit(0) at import must not let the check pass
on exit code alone. Never lands: the PR is a draft and is closed unmerged.
"""

import os
from collections.abc import Sequence

os._exit(0)

revision: str = "mrt4_case_g_01"
down_revision: str | Sequence[str] | None = "coord_agent_questions_effect"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    raise RuntimeError("unreachable")


def downgrade() -> None:
    raise RuntimeError("unreachable")
