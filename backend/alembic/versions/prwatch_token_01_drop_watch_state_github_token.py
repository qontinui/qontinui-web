"""prwatch token 01 — drop project.pr_watch_state.github_token

Revision ID: prwatch_token_01
Revises: cinode_06_ci_node_directives
Create Date: 2026-11-28

``project.pr_watch_state.github_token`` (``text NOT NULL DEFAULT ''``) was a
plaintext slot for a user's GitHub token. It only ever held ``''``.
qontinui-runner#2286 removed every runner reader and writer (landed as
``6a6fe547d``), and the Phase 1 gates of plan
``2026-10-18-drop-the-plaintext-pr-watch-token-column-once-no-deployed-runner-reads-it``
waited for deployed runners to serve past it (coord finding e871ac27). Builds
older than #2286 that still name the column fail safe: each of the three reads
is logged and survived.

downgrade() re-adds the column in its original shape, a true inverse.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prwatch_token_01"
down_revision: str = "cinode_06_ci_node_directives"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE project.pr_watch_state DROP COLUMN IF EXISTS github_token"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE project.pr_watch_state "
        "ADD COLUMN IF NOT EXISTS github_token TEXT NOT NULL DEFAULT ''"
    )
