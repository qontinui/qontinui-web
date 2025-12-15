"""fix_schema_issues

Revision ID: 20251119_225835
Revises: 20251119_225834
Create Date: 2025-11-19 22:58:35.000000

This migration fixes schema inconsistencies:
1. Removes duplicate indexes on detected_regions and fused_regions tables
2. Changes Pattern.confidence from Integer to Float for precision
3. Removes presigned_url column from automation_screenshots (generated dynamically)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251119_225835"
down_revision: str | None = "20251119_225834"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Fix schema issues."""
    # Get connection to check if indexes exist (for idempotency)
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # 1. Drop duplicate indexes if they exist
    # Both ix_detected_regions_region_type and ix_detected_regions_type index the same column
    detected_regions_indexes = [
        idx["name"] for idx in inspector.get_indexes("detected_regions")
    ]
    if "ix_detected_regions_type" in detected_regions_indexes:
        op.drop_index("ix_detected_regions_type", table_name="detected_regions")

    # Both ix_fused_regions_region_type and ix_fused_regions_type index the same column
    fused_regions_indexes = [
        idx["name"] for idx in inspector.get_indexes("fused_regions")
    ]
    if "ix_fused_regions_type" in fused_regions_indexes:
        op.drop_index("ix_fused_regions_type", table_name="fused_regions")

    # 2. Change Pattern.confidence from Integer to Float
    # Using batch_alter_table for better compatibility with various databases
    with op.batch_alter_table("patterns", schema=None) as batch_op:
        batch_op.alter_column(
            "confidence",
            existing_type=sa.Integer(),
            type_=sa.Float(),
            existing_nullable=False,
        )

    # 3. Remove presigned_url column (should be generated dynamically, not stored)
    # Check if column exists first (for idempotency)
    automation_screenshots_columns = [
        col["name"] for col in inspector.get_columns("automation_screenshots")
    ]
    if "presigned_url" in automation_screenshots_columns:
        op.drop_column("automation_screenshots", "presigned_url")


def downgrade() -> None:
    """Revert schema fixes."""
    # 1. Re-add presigned_url column
    op.add_column(
        "automation_screenshots",
        sa.Column("presigned_url", sa.String(length=2048), nullable=True),
    )

    # 2. Change Pattern.confidence from Float back to Integer
    # Note: This may result in data loss (truncation of decimal values)
    with op.batch_alter_table("patterns", schema=None) as batch_op:
        batch_op.alter_column(
            "confidence",
            existing_type=sa.Float(),
            type_=sa.Integer(),
            existing_nullable=False,
        )

    # 3. Re-create the duplicate indexes
    op.create_index(
        "ix_fused_regions_type", "fused_regions", ["region_type"], unique=False
    )
    op.create_index(
        "ix_detected_regions_type", "detected_regions", ["region_type"], unique=False
    )
