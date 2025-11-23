"""add_code_package_models

Revision ID: 20251123_add_code_package_models
Revises: 114017dc2943
Create Date: 2025-11-23 01:15:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251123_add_code_package_models"
down_revision: Union[str, None] = "114017dc2943"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Detect projects.id column type dynamically
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            """
        SELECT data_type
        FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'id'
    """
        )
    )
    row = result.fetchone()
    project_id_type = sa.UUID() if row and "uuid" in row[0].lower() else sa.Integer()

    # Create package_categories table
    op.create_table(
        "package_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("idx_category_slug", "package_categories", ["slug"], unique=False)
    op.create_index(
        op.f("ix_package_categories_id"), "package_categories", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_package_categories_slug"), "package_categories", ["slug"], unique=True
    )

    # Create code_packages table
    op.create_table(
        "code_packages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("long_description", sa.Text(), nullable=True),
        sa.Column("author_id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("license", sa.String(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.Column("total_downloads", sa.Integer(), nullable=False),
        sa.Column("avg_rating", sa.Numeric(precision=3, scale=2), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["category_id"], ["package_categories.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("idx_package_author", "code_packages", ["author_id"], unique=False)
    op.create_index(
        "idx_package_category", "code_packages", ["category_id"], unique=False
    )
    op.create_index(
        "idx_package_created", "code_packages", ["created_at"], unique=False
    )
    op.create_index("idx_package_name", "code_packages", ["name"], unique=False)
    op.create_index("idx_package_slug", "code_packages", ["slug"], unique=False)
    op.create_index(
        "idx_package_verified", "code_packages", ["is_verified"], unique=False
    )
    op.create_index(
        op.f("ix_code_packages_category_id"),
        "code_packages",
        ["category_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_code_packages_created_at"),
        "code_packages",
        ["created_at"],
        unique=False,
    )
    op.create_index(op.f("ix_code_packages_id"), "code_packages", ["id"], unique=False)
    op.create_index(
        op.f("ix_code_packages_is_verified"),
        "code_packages",
        ["is_verified"],
        unique=False,
    )
    op.create_index(
        op.f("ix_code_packages_name"), "code_packages", ["name"], unique=True
    )
    op.create_index(
        op.f("ix_code_packages_slug"), "code_packages", ["slug"], unique=True
    )

    # Create package_versions table
    op.create_table(
        "package_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("package_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("code_content", sa.Text(), nullable=False),
        sa.Column("function_name", sa.String(), nullable=False),
        sa.Column("changelog", sa.Text(), nullable=True),
        sa.Column("dependencies", sa.JSON(), nullable=False),
        sa.Column("min_python_version", sa.String(), nullable=True),
        sa.Column("security_scan_status", sa.String(), nullable=False),
        sa.Column("security_scan_result", sa.JSON(), nullable=True),
        sa.Column("download_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "security_scan_status IN ('pending', 'scanning', 'passed', 'failed', 'skipped')",
            name="chk_security_scan_status",
        ),
        sa.ForeignKeyConstraint(
            ["package_id"], ["code_packages.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("package_id", "version", name="uq_package_version"),
    )
    op.create_index(
        "idx_version_created", "package_versions", ["created_at"], unique=False
    )
    op.create_index(
        "idx_version_package", "package_versions", ["package_id"], unique=False
    )
    op.create_index(
        "idx_version_security",
        "package_versions",
        ["security_scan_status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_versions_created_at"),
        "package_versions",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_versions_id"), "package_versions", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_package_versions_package_id"),
        "package_versions",
        ["package_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_versions_security_scan_status"),
        "package_versions",
        ["security_scan_status"],
        unique=False,
    )

    # Create package_ratings table
    op.create_table(
        "package_ratings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("package_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("review_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("rating >= 1 AND rating <= 5", name="chk_rating_range"),
        sa.ForeignKeyConstraint(
            ["package_id"], ["code_packages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("package_id", "user_id", name="uq_package_user_rating"),
    )
    op.create_index(
        "idx_rating_created", "package_ratings", ["created_at"], unique=False
    )
    op.create_index(
        "idx_rating_package", "package_ratings", ["package_id"], unique=False
    )
    op.create_index("idx_rating_user", "package_ratings", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_package_ratings_created_at"),
        "package_ratings",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_ratings_id"), "package_ratings", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_package_ratings_package_id"),
        "package_ratings",
        ["package_id"],
        unique=False,
    )

    # Create package_installations table
    op.create_table(
        "package_installations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("package_id", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("project_id", project_id_type, nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("installed_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'disabled')", name="chk_installation_status"
        ),
        sa.ForeignKeyConstraint(
            ["package_id"], ["code_packages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["version_id"], ["package_versions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "package_id", name="uq_project_package"),
    )
    op.create_index(
        "idx_installation_package",
        "package_installations",
        ["package_id"],
        unique=False,
    )
    op.create_index(
        "idx_installation_project",
        "package_installations",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "idx_installation_status", "package_installations", ["status"], unique=False
    )
    op.create_index(
        "idx_installation_user", "package_installations", ["user_id"], unique=False
    )
    op.create_index(
        "idx_installation_version",
        "package_installations",
        ["version_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_installations_id"),
        "package_installations",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_installations_package_id"),
        "package_installations",
        ["package_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_installations_status"),
        "package_installations",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_package_installations_version_id"),
        "package_installations",
        ["version_id"],
        unique=False,
    )


def downgrade() -> None:
    # Drop package_installations table
    op.drop_index(
        op.f("ix_package_installations_version_id"), table_name="package_installations"
    )
    op.drop_index(
        op.f("ix_package_installations_status"), table_name="package_installations"
    )
    op.drop_index(
        op.f("ix_package_installations_package_id"), table_name="package_installations"
    )
    op.drop_index(
        op.f("ix_package_installations_id"), table_name="package_installations"
    )
    op.drop_index("idx_installation_version", table_name="package_installations")
    op.drop_index("idx_installation_user", table_name="package_installations")
    op.drop_index("idx_installation_status", table_name="package_installations")
    op.drop_index("idx_installation_project", table_name="package_installations")
    op.drop_index("idx_installation_package", table_name="package_installations")
    op.drop_table("package_installations")

    # Drop package_ratings table
    op.drop_index(op.f("ix_package_ratings_package_id"), table_name="package_ratings")
    op.drop_index(op.f("ix_package_ratings_id"), table_name="package_ratings")
    op.drop_index(op.f("ix_package_ratings_created_at"), table_name="package_ratings")
    op.drop_index("idx_rating_user", table_name="package_ratings")
    op.drop_index("idx_rating_package", table_name="package_ratings")
    op.drop_index("idx_rating_created", table_name="package_ratings")
    op.drop_table("package_ratings")

    # Drop package_versions table
    op.drop_index(
        op.f("ix_package_versions_security_scan_status"), table_name="package_versions"
    )
    op.drop_index(op.f("ix_package_versions_package_id"), table_name="package_versions")
    op.drop_index(op.f("ix_package_versions_id"), table_name="package_versions")
    op.drop_index(op.f("ix_package_versions_created_at"), table_name="package_versions")
    op.drop_index("idx_version_security", table_name="package_versions")
    op.drop_index("idx_version_package", table_name="package_versions")
    op.drop_index("idx_version_created", table_name="package_versions")
    op.drop_table("package_versions")

    # Drop code_packages table
    op.drop_index(op.f("ix_code_packages_slug"), table_name="code_packages")
    op.drop_index(op.f("ix_code_packages_name"), table_name="code_packages")
    op.drop_index(op.f("ix_code_packages_is_verified"), table_name="code_packages")
    op.drop_index(op.f("ix_code_packages_id"), table_name="code_packages")
    op.drop_index(op.f("ix_code_packages_created_at"), table_name="code_packages")
    op.drop_index(op.f("ix_code_packages_category_id"), table_name="code_packages")
    op.drop_index("idx_package_verified", table_name="code_packages")
    op.drop_index("idx_package_slug", table_name="code_packages")
    op.drop_index("idx_package_name", table_name="code_packages")
    op.drop_index("idx_package_created", table_name="code_packages")
    op.drop_index("idx_package_category", table_name="code_packages")
    op.drop_index("idx_package_author", table_name="code_packages")
    op.drop_table("code_packages")

    # Drop package_categories table
    op.drop_index(op.f("ix_package_categories_slug"), table_name="package_categories")
    op.drop_index(op.f("ix_package_categories_id"), table_name="package_categories")
    op.drop_index("idx_category_slug", table_name="package_categories")
    op.drop_table("package_categories")
