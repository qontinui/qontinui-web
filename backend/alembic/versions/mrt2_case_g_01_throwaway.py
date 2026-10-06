"""[throwaway, do not merge] migration-reversal-tested r2 case (g)

Revision ID: mrt2_case_g_01
Revises: pdpub_03 (deliberately a NON-head: this makes a second head)
Create Date: 2026-10-06

Verification fixture: a top-level sys.exit(0) must not let the check pass
on exit code alone. Never lands: the PR is a draft and is closed unmerged.
"""

import sys
from collections.abc import Sequence

sys.exit(0)

revision: str = "mrt2_case_g_01"
down_revision: str | Sequence[str] | None = "pdpub_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    raise RuntimeError("unreachable")


def downgrade() -> None:
    raise RuntimeError("unreachable")
