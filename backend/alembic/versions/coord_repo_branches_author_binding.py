"""coord — add durable author-session binding columns to coord.repo_branches

Phase 1 of plan
``2026-07-05-coord-commit-session-attribution-durable-binding``.

coord needs a *durable, sticky* binding from a merged commit / PR back to the
agent session that authored it, so commit→session attribution survives after the
ephemeral session registry has rotated the session out. This migration adds the
three storage columns; the binding itself is written later by a coord worker at
the capture points (commit report, PR claim) and, for historical rows, by a
one-shot backfill worker. **No backfill happens in this migration** — the
columns are added NULL and populated out-of-band.

* ``author_agent_session_id UUID`` — the durable, sticky authoring-session
  binding (the ``agent_sessions`` id that first authored this branch/PR).
* ``author_bound_at TIMESTAMPTZ`` — when the binding was first written (set once,
  sticky thereafter).
* ``author_source TEXT`` — which capture point wrote the binding
  (e.g. ``'commit_report'``, ``'pr_claim'``, ``'backfill'``).

All three are nullable and additive, so this migration is deploy-safe: existing
rows and any row not yet attributed simply carry NULL.

Revision ID: coord_repo_branches_author_binding
Revises: coord_p4_04_drop_gates_plan_id
Create Date: 2026-07-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_repo_branches_author_binding"
down_revision: str | None = "coord_p4_04_drop_gates_plan_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "repo_branches",
        sa.Column(
            "author_agent_session_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        schema="coord",
    )
    op.add_column(
        "repo_branches",
        sa.Column("author_bound_at", sa.DateTime(timezone=True), nullable=True),
        schema="coord",
    )
    op.add_column(
        "repo_branches",
        sa.Column("author_source", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("repo_branches", "author_source", schema="coord")
    op.drop_column("repo_branches", "author_bound_at", schema="coord")
    op.drop_column("repo_branches", "author_agent_session_id", schema="coord")
