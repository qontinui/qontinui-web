"""add project_annotation_state table for conflict detection

Revision ID: c3d4e5f6g7h8
Revises: b2c3d4e5f6g7
Create Date: 2026-01-31 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6g7h8"
down_revision: Union[str, None] = "b2c3d4e5f6g7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create project_annotation_states table for annotation conflict detection.

    This table stores the current annotation state for each project, enabling:
    - Conflict detection before saving
    - Version tracking for optimistic concurrency control
    - Quick comparison via element count and hash
    """
    op.create_table(
        "project_annotation_states",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "version_id",
            sa.String(36),
            nullable=False,
            comment="UUID string for version identification",
        ),
        sa.Column(
            "version_number",
            sa.Integer(),
            nullable=False,
            server_default="1",
            comment="Incrementing version number",
        ),
        sa.Column(
            "element_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="Number of annotation elements",
        ),
        sa.Column(
            "elements_hash",
            sa.String(32),
            nullable=False,
            server_default="",
            comment="MD5 hash of JSON-stringified elements for comparison",
        ),
        sa.Column(
            "annotation_data",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
            comment="Full annotation data for storage and merging",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_by_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="User who last updated the annotations",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
        ),
        sa.UniqueConstraint("project_id"),
    )

    # Create indexes
    op.create_index(
        "ix_project_annotation_states_project_id",
        "project_annotation_states",
        ["project_id"],
    )
    op.create_index(
        "ix_project_annotation_state_updated",
        "project_annotation_states",
        ["updated_at"],
    )


def downgrade() -> None:
    """Drop project_annotation_states table."""
    op.drop_index(
        "ix_project_annotation_state_updated",
        table_name="project_annotation_states",
    )
    op.drop_index(
        "ix_project_annotation_states_project_id",
        table_name="project_annotation_states",
    )
    op.drop_table("project_annotation_states")
