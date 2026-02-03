"""add element_annotation tables for project-scoped GUI element annotations

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2026-01-31 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6g7h8i9"
down_revision: Union[str, None] = "c3d4e5f6g7h8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create element annotation tables.

    These tables store project-scoped element annotations:
    - element_annotation_sets: Annotation set with version info and screenshot metadata
    - element_annotations: Individual annotated elements with bounding boxes
    """
    # Element Annotation Sets table
    op.create_table(
        "element_annotation_sets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("screenshot_width", sa.Integer(), nullable=False),
        sa.Column("screenshot_height", sa.Integer(), nullable=False),
        sa.Column("screenshot_url", sa.String(), nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("version_comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_element_annotation_sets_project_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name="fk_element_annotation_sets_created_by_id",
        ),
    )

    # Create indexes for element_annotation_sets
    op.create_index(
        "ix_element_annotation_sets_project_id",
        "element_annotation_sets",
        ["project_id"],
    )
    op.create_index(
        "ix_element_annotation_sets_project_current",
        "element_annotation_sets",
        ["project_id", "is_current"],
    )
    op.create_index(
        "ix_element_annotation_sets_project_version",
        "element_annotation_sets",
        ["project_id", "version_number"],
    )

    # Element Annotations table
    op.create_table(
        "element_annotations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("annotation_set_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("y", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("element_type", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("extra_data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("client_id", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["annotation_set_id"],
            ["element_annotation_sets.id"],
            name="fk_element_annotations_annotation_set_id",
            ondelete="CASCADE",
        ),
    )

    # Create indexes for element_annotations
    op.create_index(
        "ix_element_annotations_set_id",
        "element_annotations",
        ["annotation_set_id"],
    )
    op.create_index(
        "ix_element_annotations_set_order",
        "element_annotations",
        ["annotation_set_id", "order"],
    )
    op.create_index(
        "ix_element_annotations_label",
        "element_annotations",
        ["label"],
    )
    op.create_index(
        "ix_element_annotations_element_type",
        "element_annotations",
        ["element_type"],
    )


def downgrade() -> None:
    """Drop element annotation tables."""
    # Drop indexes first
    op.drop_index(
        "ix_element_annotations_element_type", table_name="element_annotations"
    )
    op.drop_index("ix_element_annotations_label", table_name="element_annotations")
    op.drop_index("ix_element_annotations_set_order", table_name="element_annotations")
    op.drop_index("ix_element_annotations_set_id", table_name="element_annotations")
    op.drop_index(
        "ix_element_annotation_sets_project_version",
        table_name="element_annotation_sets",
    )
    op.drop_index(
        "ix_element_annotation_sets_project_current",
        table_name="element_annotation_sets",
    )
    op.drop_index(
        "ix_element_annotation_sets_project_id", table_name="element_annotation_sets"
    )

    # Drop tables
    op.drop_table("element_annotations")
    op.drop_table("element_annotation_sets")
