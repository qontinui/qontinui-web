"""add_organization_and_team_management

Revision ID: z9fc6936875
Revises: 63e5da6dd826
Create Date: 2025-11-14 00:00:00.000000

This migration adds organization and team management capabilities:
1. Creates organizations, team_members, organization_invitations, and project_access_control tables
2. Migrates existing users to have a "Personal Organization"
3. Migrates existing projects to be owned by personal organizations
4. Preserves backward compatibility with existing project ownership
"""

import secrets
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "z9fc6936875"
down_revision: str | None = "63e5da6dd826"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def generate_slug(name: str, suffix: str = "") -> str:
    """Generate a URL-safe slug from a name"""
    slug = name.lower().replace(" ", "-")
    # Remove non-alphanumeric characters except hyphens
    slug = "".join(c for c in slug if c.isalnum() or c == "-")
    # Remove consecutive hyphens
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-")
    if suffix:
        slug = f"{slug}-{suffix}"
    return slug


def upgrade() -> None:
    # Create organizations table
    op.create_table(
        "organizations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("settings", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_organization_slug"),
    )
    op.create_index("idx_org_slug", "organizations", ["slug"])
    op.create_index(op.f("ix_organizations_name"), "organizations", ["name"])

    # Create team_members table
    op.create_table(
        "team_members",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="member"),
        sa.Column("permissions", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "joined_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("last_active_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_org_user"),
    )
    op.create_index("idx_org_user", "team_members", ["organization_id", "user_id"])
    op.create_index("idx_team_member_user", "team_members", ["user_id"])
    op.create_index("idx_team_member_org", "team_members", ["organization_id"])

    # Create organization_invitations table
    op.create_table(
        "organization_invitations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="member"),
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_invitation_token"),
    )
    op.create_index("idx_invitation_email", "organization_invitations", ["email"])
    op.create_index(
        "idx_invitation_org", "organization_invitations", ["organization_id"]
    )
    op.create_index("idx_invitation_token", "organization_invitations", ["token"])

    # Create project_access_control table
    op.create_table(
        "project_access_control",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "permission_level", sa.String(), nullable=False, server_default="view"
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.CheckConstraint(
            "(user_id IS NOT NULL AND organization_id IS NULL) OR (user_id IS NULL AND organization_id IS NOT NULL)",
            name="chk_user_or_org",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_project_access_project", "project_access_control", ["project_id"]
    )
    op.create_index("idx_project_access_user", "project_access_control", ["user_id"])
    op.create_index(
        "idx_project_access_org", "project_access_control", ["organization_id"]
    )

    # Data migration: Create personal organizations for existing users
    connection = op.get_bind()

    # Get all existing users
    users = connection.execute(
        sa.text(
            "SELECT id, username, full_name, created_at FROM users ORDER BY created_at"
        )
    ).fetchall()

    for user in users:
        user_id = user[0]
        username = user[1]
        full_name = user[2] or username
        created_at = user[3]

        # Create a personal organization for each user
        org_name = f"{full_name}'s Organization"
        org_slug = generate_slug(username, suffix="personal")

        # Ensure slug is unique
        existing_slug = connection.execute(
            sa.text("SELECT id FROM organizations WHERE slug = :slug"),
            {"slug": org_slug},
        ).fetchone()

        if existing_slug:
            # Add a random suffix if slug already exists
            org_slug = f"{org_slug}-{secrets.token_hex(4)}"

        # Insert organization
        result = connection.execute(
            sa.text(
                """
                INSERT INTO organizations (name, slug, description, owner_id, is_active, created_at, updated_at)
                VALUES (:name, :slug, :description, :owner_id, true, :created_at, :updated_at)
                RETURNING id
            """
            ),
            {
                "name": org_name,
                "slug": org_slug,
                "description": f"Personal organization for {full_name}",
                "owner_id": user_id,
                "created_at": created_at,
                "updated_at": created_at,
            },
        )
        org_id = result.fetchone()[0]

        # Add the user as an owner member of their personal organization
        connection.execute(
            sa.text(
                """
                INSERT INTO team_members (organization_id, user_id, role, joined_at)
                VALUES (:org_id, :user_id, 'owner', :joined_at)
            """
            ),
            {
                "org_id": org_id,
                "user_id": user_id,
                "joined_at": created_at,
            },
        )

    # Migrate existing projects to have access control entries
    projects = connection.execute(
        sa.text("SELECT id, owner_id, created_at FROM projects")
    ).fetchall()

    for project in projects:
        project_id = project[0]
        owner_id = project[1]
        created_at = project[2]

        # Get the user's personal organization
        org = connection.execute(
            sa.text(
                """
                SELECT id FROM organizations
                WHERE owner_id = :owner_id
                AND slug LIKE '%-personal%'
                LIMIT 1
            """
            ),
            {"owner_id": owner_id},
        ).fetchone()

        if org:
            org_id = org[0]

            # Create organization-level access control for the project
            connection.execute(
                sa.text(
                    """
                    INSERT INTO project_access_control
                    (project_id, organization_id, permission_level, created_by, created_at)
                    VALUES (:project_id, :org_id, 'admin', :owner_id, :created_at)
                """
                ),
                {
                    "project_id": project_id,
                    "org_id": org_id,
                    "owner_id": owner_id,
                    "created_at": created_at,
                },
            )


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index("idx_project_access_org", table_name="project_access_control")
    op.drop_index("idx_project_access_user", table_name="project_access_control")
    op.drop_index("idx_project_access_project", table_name="project_access_control")
    op.drop_table("project_access_control")

    op.drop_index("idx_invitation_token", table_name="organization_invitations")
    op.drop_index("idx_invitation_org", table_name="organization_invitations")
    op.drop_index("idx_invitation_email", table_name="organization_invitations")
    op.drop_table("organization_invitations")

    op.drop_index("idx_team_member_org", table_name="team_members")
    op.drop_index("idx_team_member_user", table_name="team_members")
    op.drop_index("idx_org_user", table_name="team_members")
    op.drop_table("team_members")

    op.drop_index(op.f("ix_organizations_name"), table_name="organizations")
    op.drop_index("idx_org_slug", table_name="organizations")
    op.drop_table("organizations")
