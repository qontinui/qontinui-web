"""Add span nesting columns to action_executions for Opik integration.

Revision ID: w9x0y1z2a3b4
Revises: v8w9x0y1z2a3
Create Date: 2026-03-24 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "w9x0y1z2a3b4"
down_revision: Union[str, None] = "v8w9x0y1z2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add parent_id, span_type, and trace_id columns for span nesting."""
    op.add_column(
        "action_executions",
        sa.Column(
            "parent_id",
            sa.UUID(),
            sa.ForeignKey("action_executions.id", ondelete="CASCADE"),
            nullable=True,
            comment="Parent action execution for span nesting",
        ),
    )
    op.add_column(
        "action_executions",
        sa.Column(
            "span_type",
            sa.String(length=50),
            nullable=True,
            comment="Span type: action, llm_call, tool_use, retrieval (None defaults to action)",
        ),
    )
    op.add_column(
        "action_executions",
        sa.Column(
            "trace_id",
            sa.String(length=255),
            nullable=True,
            comment="Distributed trace correlation ID",
        ),
    )
    op.create_index(
        "ix_action_executions_parent_id",
        "action_executions",
        ["parent_id"],
    )
    op.create_index(
        "ix_action_executions_trace_id",
        "action_executions",
        ["trace_id"],
    )


def downgrade() -> None:
    """Remove span nesting columns."""
    op.drop_index("ix_action_executions_trace_id", table_name="action_executions")
    op.drop_index("ix_action_executions_parent_id", table_name="action_executions")
    op.drop_column("action_executions", "trace_id")
    op.drop_column("action_executions", "span_type")
    op.drop_column("action_executions", "parent_id")
