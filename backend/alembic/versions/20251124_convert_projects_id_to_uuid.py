"""convert_projects_id_to_uuid

Revision ID: 20251124_projects_uuid
Revises: 20251124_training_datasets
Create Date: 2025-11-24

This migration converts projects.id from Integer to UUID for consistency
with the rest of the schema (users, organizations, etc).

Steps:
1. Add new UUID column to projects
2. Generate UUIDs for existing projects
3. Add new UUID project_id columns to all referencing tables
4. Populate new columns by joining to projects
5. Drop old foreign keys and columns
6. Rename new columns and add constraints
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251124_projects_uuid"
down_revision: Union[str, None] = "20251124_training_datasets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tables that reference projects.id with their constraints
# Format: (table_name, column_name, constraint_name, on_delete, nullable)
REFERENCING_TABLES = [
    ("storage_usage", "project_id", "storage_usage_project_id_fkey", "CASCADE", True),
    (
        "project_versions",
        "project_id",
        "project_versions_project_id_fkey",
        "CASCADE",
        False,
    ),
    (
        "automation_videos",
        "project_id",
        "automation_videos_project_id_fkey",
        "SET NULL",
        True,
    ),
    ("snapshot_runs", "project_id", "snapshot_runs_project_id_fkey", "CASCADE", True),
    (
        "software_test_runs",
        "project_id",
        "software_test_runs_project_id_fkey",
        "CASCADE",
        False,
    ),
    (
        "project_access_control",
        "project_id",
        "project_access_control_project_id_fkey",
        "CASCADE",
        False,
    ),
    (
        "workflow_variables",
        "project_id",
        "workflow_variables_project_id_fkey",
        None,
        False,
    ),
    (
        "transition_reliability",
        "project_id",
        "transition_reliability_project_id_fkey",
        "CASCADE",
        False,
    ),
    (
        "automation_sessions",
        "project_id",
        "automation_sessions_project_id_fkey",
        "SET NULL",
        True,
    ),
    ("notifications", "project_id", "notifications_project_id_fkey", "CASCADE", True),
    (
        "automation_screenshots",
        "project_id",
        "fk_automation_screenshots_project_id",
        "SET NULL",
        True,
    ),
    (
        "package_installations",
        "project_id",
        "package_installations_project_id_fkey",
        "CASCADE",
        False,
    ),
    (
        "coverage_snapshots",
        "project_id",
        "coverage_snapshots_project_id_fkey",
        "CASCADE",
        False,
    ),
    (
        "capture_sessions",
        "project_id",
        "capture_sessions_project_id_fkey",
        "CASCADE",
        False,
    ),
    (
        "capture_events",
        "project_id",
        "capture_events_project_id_fkey",
        "CASCADE",
        False,
    ),
    ("edit_commands", "project_id", "edit_commands_project_id_fkey", "CASCADE", False),
    ("custom_functions", "project_id", "custom_functions_project_id_fkey", None, False),
    ("runner_connections", "project_id", None, None, True),  # No FK constraint
    (
        "learned_workflows",
        "project_id",
        "learned_workflows_project_id_fkey",
        "CASCADE",
        False,
    ),
    ("project_locks", "project_id", None, "CASCADE", False),  # If exists
    ("project_comments", "project_id", None, "CASCADE", False),  # If exists
    ("activity_logs", "project_id", None, "CASCADE", False),  # If exists
]


def table_exists(conn, table_name: str) -> bool:
    """Check if a table exists in the database."""
    result = conn.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = :name)"
        ),
        {"name": table_name},
    )
    return result.scalar()


def column_exists(conn, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    result = conn.execute(
        sa.text(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = :table AND column_name = :column
            )
            """
        ),
        {"table": table_name, "column": column_name},
    )
    return result.scalar()


def constraint_exists(conn, constraint_name: str) -> bool:
    """Check if a constraint exists."""
    result = conn.execute(
        sa.text(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = :name
            )
            """
        ),
        {"name": constraint_name},
    )
    return result.scalar()


def get_column_type(conn, table_name: str, column_name: str) -> str | None:
    """Get the data type of a column."""
    result = conn.execute(
        sa.text(
            """
            SELECT data_type FROM information_schema.columns
            WHERE table_name = :table AND column_name = :column
            """
        ),
        {"table": table_name, "column": column_name},
    )
    row = result.fetchone()
    return row[0] if row else None


def upgrade() -> None:
    """Convert projects.id from Integer to UUID."""
    conn = op.get_bind()

    print("=" * 80)
    print("CONVERTING projects.id FROM INTEGER TO UUID")
    print("=" * 80)

    # Check if projects.id is already UUID - if so, skip this migration
    projects_id_type = get_column_type(conn, "projects", "id")
    print(f"\nCurrent projects.id type: {projects_id_type}")

    if projects_id_type == "uuid":
        print("\n" + "=" * 80)
        print("SKIPPING: projects.id is already UUID type")
        print(
            "This migration has already been applied or the schema was created with UUID."
        )
        print("=" * 80)
        return

    # Step 1: Add new UUID column to projects table
    print("\n[1/6] Adding UUID column to projects table...")
    if not column_exists(conn, "projects", "id_new"):
        op.add_column(
            "projects",
            sa.Column(
                "id_new",
                UUID(as_uuid=True),
                server_default=sa.text("gen_random_uuid()"),
                nullable=False,
            ),
        )
        print("  Added id_new column to projects")
    else:
        print("  id_new column already exists, skipping")

    # Step 2: Generate UUIDs for existing projects (if not already done)
    print("\n[2/6] Generating UUIDs for existing projects...")
    conn.execute(
        sa.text(
            """
            UPDATE projects
            SET id_new = gen_random_uuid()
            WHERE id_new IS NULL OR id_new = '00000000-0000-0000-0000-000000000000'::uuid
            """
        )
    )

    # Step 3: Add new UUID columns to referencing tables
    print("\n[3/6] Adding UUID columns to referencing tables...")
    for table_name, col_name, _, _, nullable in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            print(f"  Skipping {table_name} (table does not exist)")
            continue

        new_col_name = f"{col_name}_new"
        if not column_exists(conn, table_name, new_col_name):
            op.add_column(
                table_name,
                sa.Column(new_col_name, UUID(as_uuid=True), nullable=True),
            )
            print(f"  Added {new_col_name} to {table_name}")
        else:
            print(f"  {new_col_name} already exists in {table_name}, skipping")

    # Step 4: Populate new UUID columns by joining to projects
    print("\n[4/6] Populating UUID columns from projects table...")
    for table_name, col_name, _, _, _ in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue

        new_col_name = f"{col_name}_new"
        if column_exists(conn, table_name, new_col_name):
            conn.execute(
                sa.text(
                    f"""
                    UPDATE {table_name} t
                    SET {new_col_name} = p.id_new
                    FROM projects p
                    WHERE t.{col_name} = p.id AND t.{new_col_name} IS NULL
                    """
                )
            )
            # Count how many were updated
            result = conn.execute(
                sa.text(
                    f"SELECT COUNT(*) FROM {table_name} WHERE {new_col_name} IS NOT NULL"
                )
            )
            count = result.scalar()
            print(f"  Populated {count} rows in {table_name}")

    # Step 5: Drop old foreign key constraints and columns, rename new columns
    print("\n[5/6] Dropping old constraints and columns, renaming new columns...")
    for (
        table_name,
        col_name,
        constraint_name,
        on_delete,
        nullable,
    ) in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue

        new_col_name = f"{col_name}_new"
        if not column_exists(conn, table_name, new_col_name):
            print(f"  Skipping {table_name} (new column does not exist)")
            continue

        # Drop old foreign key constraint if it exists
        if constraint_name and constraint_exists(conn, constraint_name):
            op.drop_constraint(constraint_name, table_name, type_="foreignkey")
            print(f"  Dropped constraint {constraint_name}")

        # Drop old indexes if they exist (using IF EXISTS to avoid transaction abort)
        # Try common index naming patterns
        possible_index_names = [
            f"ix_{table_name}_{col_name}",
            f"idx_{table_name.replace('_', '')}_{col_name}",
            f"idx_{table_name}_{col_name}",
        ]
        for idx_name in possible_index_names:
            conn.execute(sa.text(f"DROP INDEX IF EXISTS {idx_name}"))
        print(f"  Dropped indexes for {table_name}.{col_name}")

        # Drop old column
        if column_exists(conn, table_name, col_name):
            op.drop_column(table_name, col_name)
            print(f"  Dropped column {table_name}.{col_name}")

        # Rename new column
        op.alter_column(table_name, new_col_name, new_column_name=col_name)
        print(f"  Renamed {new_col_name} to {col_name}")

        # Set nullable constraint
        if not nullable:
            # For non-nullable columns, we need to handle NULLs first
            # (orphaned records where project was deleted)
            null_count = conn.execute(
                sa.text(f"SELECT COUNT(*) FROM {table_name} WHERE {col_name} IS NULL")
            ).scalar()
            if null_count > 0:
                print(
                    f"  Warning: {null_count} rows in {table_name} have NULL {col_name}"
                )
                # Delete orphaned records
                conn.execute(
                    sa.text(f"DELETE FROM {table_name} WHERE {col_name} IS NULL")
                )
                print(f"  Deleted {null_count} orphaned rows")

            op.alter_column(table_name, col_name, nullable=False)

    # Step 6: Update projects table - swap id columns
    print("\n[6/6] Updating projects primary key...")

    # Drop old primary key and index (using CASCADE to handle dependent FK constraints)
    conn.execute(sa.text("ALTER TABLE projects DROP CONSTRAINT projects_pkey CASCADE"))
    print("  Dropped old primary key (with CASCADE)")

    conn.execute(sa.text("DROP INDEX IF EXISTS ix_projects_id"))
    print("  Dropped old index (if it existed)")

    # Drop old id column
    op.drop_column("projects", "id")
    print("  Dropped old id column")

    # Rename id_new to id
    op.alter_column("projects", "id_new", new_column_name="id")
    print("  Renamed id_new to id")

    # Add new primary key
    op.create_primary_key("projects_pkey", "projects", ["id"])
    print("  Created new primary key")

    # Add index
    op.create_index("ix_projects_id", "projects", ["id"])
    print("  Created new index")

    # Step 7: Add new foreign key constraints
    print("\n[7/7] Adding new foreign key constraints...")
    for table_name, col_name, constraint_name, on_delete, _ in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue
        if not constraint_name:
            continue  # Some tables don't have FK constraints

        if not constraint_exists(conn, constraint_name):
            op.create_foreign_key(
                constraint_name,
                table_name,
                "projects",
                [col_name],
                ["id"],
                ondelete=on_delete,
            )
            print(f"  Created constraint {constraint_name}")

        # Create index for foreign key
        index_name = f"ix_{table_name}_{col_name}"
        try:
            op.create_index(index_name, table_name, [col_name])
            print(f"  Created index {index_name}")
        except Exception:
            pass  # Index might already exist

    print("\n" + "=" * 80)
    print("CONVERSION COMPLETE: projects.id is now UUID")
    print("=" * 80)


def downgrade() -> None:
    """
    Revert projects.id from UUID back to Integer.

    WARNING: This will lose the UUID values and generate new sequential integers.
    Any external references to project IDs will be broken.
    """
    conn = op.get_bind()

    print("=" * 80)
    print("REVERTING projects.id FROM UUID TO INTEGER")
    print("WARNING: This will break external references to project IDs!")
    print("=" * 80)

    # Step 1: Add temporary integer columns
    print("\n[1/4] Adding temporary integer columns...")

    # Add temp id column to projects
    op.add_column(
        "projects",
        sa.Column("id_old", sa.Integer(), autoincrement=True, nullable=True),
    )

    # Generate sequential IDs
    conn.execute(
        sa.text(
            """
            WITH numbered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as rn
                FROM projects
            )
            UPDATE projects p
            SET id_old = n.rn
            FROM numbered n
            WHERE p.id = n.id
            """
        )
    )

    # Add temp columns to referencing tables
    for table_name, col_name, _, _, _ in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue
        op.add_column(
            table_name,
            sa.Column(f"{col_name}_old", sa.Integer(), nullable=True),
        )

    # Step 2: Populate integer columns
    print("\n[2/4] Populating integer columns...")
    for table_name, col_name, _, _, _ in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue
        conn.execute(
            sa.text(
                f"""
                UPDATE {table_name} t
                SET {col_name}_old = p.id_old
                FROM projects p
                WHERE t.{col_name} = p.id
                """
            )
        )

    # Step 3: Drop constraints and swap columns
    print("\n[3/4] Swapping columns...")

    # Drop FK constraints
    for table_name, col_name, constraint_name, _, _ in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue
        if constraint_name and constraint_exists(conn, constraint_name):
            op.drop_constraint(constraint_name, table_name, type_="foreignkey")

    # Drop PK and swap in projects
    op.drop_constraint("projects_pkey", "projects", type_="primary")
    op.drop_column("projects", "id")
    op.alter_column("projects", "id_old", new_column_name="id")
    op.alter_column("projects", "id", nullable=False)
    op.create_primary_key("projects_pkey", "projects", ["id"])

    # Swap columns in referencing tables
    for table_name, col_name, _, _, nullable in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue
        op.drop_column(table_name, col_name)
        op.alter_column(table_name, f"{col_name}_old", new_column_name=col_name)
        if not nullable:
            op.alter_column(table_name, col_name, nullable=False)

    # Step 4: Recreate FK constraints
    print("\n[4/4] Recreating foreign key constraints...")
    for table_name, col_name, constraint_name, on_delete, _ in REFERENCING_TABLES:
        if not table_exists(conn, table_name):
            continue
        if not constraint_name:
            continue
        op.create_foreign_key(
            constraint_name,
            table_name,
            "projects",
            [col_name],
            ["id"],
            ondelete=on_delete,
        )

    print("\n" + "=" * 80)
    print("REVERSION COMPLETE: projects.id is now Integer")
    print("=" * 80)
