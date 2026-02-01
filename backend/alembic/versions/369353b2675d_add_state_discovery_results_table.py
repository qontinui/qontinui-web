"""add_state_discovery_results_table

Revision ID: 369353b2675d
Revises: 796396a4de25
Create Date: 2026-02-01 17:04:10.924743

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "369353b2675d"
down_revision: Union[str, None] = "796396a4de25"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create state_discovery_results table.

    Unified storage for state machine output from any discovery method:
    - Playwright extraction
    - UI Bridge exploration
    - Video recording analysis
    - Vision-based extraction
    """
    op.create_table(
        "state_discovery_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # Source tracking
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("source_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("discovery_strategy", sa.String(100), nullable=True),
        # State machine data (JSON)
        sa.Column(
            "images",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "states",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "transitions",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "element_to_renders",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        # Statistics
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transition_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("render_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "unique_element_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column(
            "discovery_metadata",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_state_discovery_results_project_id",
            ondelete="CASCADE",
        ),
    )

    # Create indexes for common queries
    op.create_index(
        "ix_state_discovery_results_project_id",
        "state_discovery_results",
        ["project_id"],
    )
    op.create_index(
        "ix_state_discovery_results_source_type",
        "state_discovery_results",
        ["source_type"],
    )
    op.create_index(
        "ix_state_discovery_results_source_session_id",
        "state_discovery_results",
        ["source_session_id"],
    )
    op.create_index(
        "ix_state_discovery_results_created_at",
        "state_discovery_results",
        ["created_at"],
    )


def downgrade() -> None:
    """Drop state_discovery_results table."""
    op.drop_index(
        "ix_state_discovery_results_created_at",
        table_name="state_discovery_results",
    )
    op.drop_index(
        "ix_state_discovery_results_source_session_id",
        table_name="state_discovery_results",
    )
    op.drop_index(
        "ix_state_discovery_results_source_type",
        table_name="state_discovery_results",
    )
    op.drop_index(
        "ix_state_discovery_results_project_id",
        table_name="state_discovery_results",
    )
    op.drop_table("state_discovery_results")
