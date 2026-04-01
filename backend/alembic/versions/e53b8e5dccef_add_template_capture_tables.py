"""add_template_capture_tables

Revision ID: e53b8e5dccef
Revises: 369353b2675d
Create Date: 2026-02-01 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e53b8e5dccef"
down_revision: Union[str, None] = "369353b2675d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create template capture tables.

    - template_candidates: Stores detected element boundaries from click events
    - application_profiles: Stores learned detection parameters per application
    """
    # Create template_candidates table
    op.create_table(
        "template_candidates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("session_id", sa.String(100), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        # Click context
        sa.Column("click_x", sa.Integer(), nullable=False),
        sa.Column("click_y", sa.Integer(), nullable=False),
        sa.Column("click_button", sa.String(20), nullable=False, server_default="left"),
        sa.Column("timestamp", sa.Float(), nullable=False),
        sa.Column("frame_number", sa.Integer(), nullable=False),
        # Detection results
        sa.Column(
            "primary_boundary",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "alternative_boundaries",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "detection_strategies",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        # Template data (S3/MinIO paths)
        sa.Column("pixel_data_path", sa.String(500), nullable=True),
        sa.Column("pixel_data_url", sa.String(500), nullable=True),
        sa.Column("thumbnail_url", sa.String(500), nullable=True),
        sa.Column("mask_path", sa.String(500), nullable=True),
        sa.Column("mask_url", sa.String(500), nullable=True),
        # Review status
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "adjusted_boundary",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        # Detection metadata
        sa.Column("confidence_score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column(
            "element_type", sa.String(50), nullable=False, server_default="unknown"
        ),
        sa.Column("application_name", sa.String(255), nullable=True),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Constraints
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
    )

    # Create indexes for template_candidates
    op.create_index(
        "ix_template_candidates_session_id",
        "template_candidates",
        ["session_id"],
    )
    op.create_index(
        "ix_template_candidates_project_id",
        "template_candidates",
        ["project_id"],
    )
    op.create_index(
        "ix_template_candidates_status",
        "template_candidates",
        ["status"],
    )

    # Create application_profiles table
    op.create_table(
        "application_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        # Configuration
        sa.Column(
            "inference_config",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "preferred_strategies",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        # Learned characteristics
        sa.Column(
            "avg_element_size",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "common_color_ranges",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "edge_threshold_overrides",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        # Tuning metrics
        sa.Column(
            "tuning_metrics",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("success_rate", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0"),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Constraints
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    # Create index for application_profiles
    op.create_index(
        "ix_application_profiles_name",
        "application_profiles",
        ["name"],
    )


def downgrade() -> None:
    """Drop template capture tables."""
    # Drop indexes first
    op.drop_index("ix_application_profiles_name", "application_profiles")
    op.drop_index("ix_template_candidates_status", "template_candidates")
    op.drop_index("ix_template_candidates_project_id", "template_candidates")
    op.drop_index("ix_template_candidates_session_id", "template_candidates")

    # Drop tables
    op.drop_table("application_profiles")
    op.drop_table("template_candidates")
