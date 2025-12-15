"""Add training datasets tables

Revision ID: 20251124_training_datasets
Revises: 20251123_software_testing_tables
Create Date: 2024-11-24

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20251124_training_datasets"
down_revision = "20251123_software_testing_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum types
    op.execute(
        """
        CREATE TYPE dataset_source_enum AS ENUM ('runner_export', 'manual_upload', 'merged')
    """
    )
    op.execute(
        """
        CREATE TYPE annotation_source_enum AS ENUM ('user_click', 'template_matching', 'smart_click_analysis', 'manual')
    """
    )
    op.execute(
        """
        CREATE TYPE element_type_enum AS ENUM ('button', 'icon', 'text', 'image', 'checkbox', 'radio', 'input_field', 'link', 'menu_item', 'tab', 'unknown')
    """
    )
    op.execute(
        """
        CREATE TYPE review_status_enum AS ENUM ('pending', 'approved', 'rejected', 'flagged')
    """
    )
    op.execute(
        """
        CREATE TYPE export_format_enum AS ENUM ('coco', 'yolo', 'pascal_voc', 'csv', 'jsonl')
    """
    )
    op.execute(
        """
        CREATE TYPE export_job_status_enum AS ENUM ('pending', 'processing', 'completed', 'failed')
    """
    )

    # Create training_datasets table
    op.create_table(
        "training_datasets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "source",
            postgresql.ENUM(
                "runner_export",
                "manual_upload",
                "merged",
                name="dataset_source_enum",
                create_type=False,
            ),
            nullable=False,
            server_default="runner_export",
        ),
        sa.Column("total_images", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "total_annotations", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("reviewed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dataset_version", sa.String(50), nullable=True),
        sa.Column(
            "export_metadata", postgresql.JSON(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_training_datasets_name", "training_datasets", ["name"], unique=False
    )
    op.create_index(
        "ix_training_datasets_created_by",
        "training_datasets",
        ["created_by_id"],
        unique=False,
    )

    # Create training_dataset_images table
    op.create_table(
        "training_dataset_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("image_hash", sa.String(64), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(512), nullable=False),
        sa.Column("action_id", sa.String(255), nullable=True),
        sa.Column("action_type", sa.String(100), nullable=True),
        sa.Column(
            "active_states", postgresql.JSON(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("timestamp", sa.DateTime(), nullable=True),
        sa.Column("reviewed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("reviewer_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["training_datasets.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_training_dataset_images_image_hash",
        "training_dataset_images",
        ["image_hash"],
        unique=False,
    )
    op.create_index(
        "ix_training_dataset_images_dataset_hash",
        "training_dataset_images",
        ["dataset_id", "image_hash"],
        unique=False,
    )
    op.create_index(
        "ix_training_dataset_images_reviewed",
        "training_dataset_images",
        ["dataset_id", "reviewed"],
        unique=False,
    )

    # Create training_dataset_annotations table
    op.create_table(
        "training_dataset_annotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("image_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("y", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "category_name",
            sa.String(100),
            nullable=False,
            server_default="gui_element",
        ),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column(
            "source",
            postgresql.ENUM(
                "user_click",
                "template_matching",
                "smart_click_analysis",
                "manual",
                name="annotation_source_enum",
                create_type=False,
            ),
            nullable=False,
            server_default="user_click",
        ),
        sa.Column(
            "element_type",
            postgresql.ENUM(
                "button",
                "icon",
                "text",
                "image",
                "checkbox",
                "radio",
                "input_field",
                "link",
                "menu_item",
                "tab",
                "unknown",
                name="element_type_enum",
                create_type=False,
            ),
            nullable=True,
        ),
        sa.Column("verified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "inference_metadata", postgresql.JSON(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "review_status",
            postgresql.ENUM(
                "pending",
                "approved",
                "rejected",
                "flagged",
                name="review_status_enum",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("reviewer_notes", sa.Text(), nullable=True),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["training_datasets.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["image_id"], ["training_dataset_images.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_training_dataset_annotations_dataset",
        "training_dataset_annotations",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        "ix_training_dataset_annotations_image",
        "training_dataset_annotations",
        ["image_id"],
        unique=False,
    )
    op.create_index(
        "ix_training_dataset_annotations_review",
        "training_dataset_annotations",
        ["dataset_id", "review_status"],
        unique=False,
    )
    op.create_index(
        "ix_training_dataset_annotations_confidence",
        "training_dataset_annotations",
        ["dataset_id", "confidence"],
        unique=False,
    )
    op.create_index(
        "ix_training_dataset_annotations_source",
        "training_dataset_annotations",
        ["dataset_id", "source"],
        unique=False,
    )

    # Create training_dataset_export_jobs table
    op.create_table(
        "training_dataset_export_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dataset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "format",
            postgresql.ENUM(
                "coco",
                "yolo",
                "pascal_voc",
                "csv",
                "jsonl",
                name="export_format_enum",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "include_images", sa.Boolean(), nullable=False, server_default="true"
        ),
        sa.Column("train_percent", sa.Float(), nullable=True),
        sa.Column("val_percent", sa.Float(), nullable=True),
        sa.Column("test_percent", sa.Float(), nullable=True),
        sa.Column("random_seed", sa.Integer(), nullable=True),
        sa.Column("filters", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending",
                "processing",
                "completed",
                "failed",
                name="export_job_status_enum",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("download_url", sa.String(1024), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["training_datasets.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_training_dataset_export_jobs_dataset",
        "training_dataset_export_jobs",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        "ix_training_dataset_export_jobs_status",
        "training_dataset_export_jobs",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    # Drop tables
    op.drop_table("training_dataset_export_jobs")
    op.drop_table("training_dataset_annotations")
    op.drop_table("training_dataset_images")
    op.drop_table("training_datasets")

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS export_job_status_enum")
    op.execute("DROP TYPE IF EXISTS export_format_enum")
    op.execute("DROP TYPE IF EXISTS review_status_enum")
    op.execute("DROP TYPE IF EXISTS element_type_enum")
    op.execute("DROP TYPE IF EXISTS annotation_source_enum")
    op.execute("DROP TYPE IF EXISTS dataset_source_enum")
