"""agent-meta-answer 02 coord.policy_rules.default_source — restore-to-default marker

Revision ID: agent_meta_answer_02_policy_rules_default_source
Revises: agent_meta_answer_01_policy_documents
Create Date: 2026-07-08

Plan "agent meta-answer" (qontinui-dev-notes/plans/2026-07-08-agent-meta-answer.md).

Adds ``default_source`` (nullable TEXT) to ``coord.policy_rules``, the same
provenance marker introduced on ``coord.policy_documents`` in migration 01
of this plan: it records which code/template default a row was seeded
from, so a UI (or coord itself) can distinguish an operator-authored rule
from one that merely mirrors a built-in default and offer a "restore to
default" action — resetting the row's payload back to the named default
rather than deleting it outright. NULL means the row has no known default
lineage (hand-authored or legacy).

Pure DDL only — no data/seed rows.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_meta_answer_02_policy_rules_default_source"
down_revision: str | Sequence[str] | None = "agent_meta_answer_01_policy_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "policy_rules",
        sa.Column("default_source", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("policy_rules", "default_source", schema="coord")
