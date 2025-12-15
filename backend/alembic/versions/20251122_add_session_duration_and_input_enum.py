"""add_session_duration_and_input_enum

Revision ID: 20251122_add_session_duration_and_input_enum
Revises: fe6100cf21ca
Create Date: 2025-11-22 08:00:00.000000

Manual migration to add:
1. max_duration_seconds column to automation_sessions
2. input_event_type_enum PostgreSQL enum type
3. Convert automation_input_events.event_type from VARCHAR to enum
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251122_session_input_enum"
down_revision: str | None = "fe6100cf21ca"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """
    Apply schema changes:
    1. Add max_duration_seconds to automation_sessions (default 28800 = 8 hours)
    2. Create input_event_type_enum with values for mouse and keyboard events
    3. Convert automation_input_events.event_type from VARCHAR(50) to enum
    """
    # Step 1: Add max_duration_seconds column to automation_sessions
    # Default to 28800 seconds (8 hours) for session timeout
    # Check if column already exists (may have been added in earlier migration)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col["name"] for col in inspector.get_columns("automation_sessions")]

    if "max_duration_seconds" not in columns:
        op.add_column(
            "automation_sessions",
            sa.Column(
                "max_duration_seconds",
                sa.Integer(),
                nullable=False,
                server_default="28800",
            ),
        )

    # Step 2: Create the input_event_type_enum PostgreSQL enum type
    # Values map to the InputEventType enum NAMES in app/models/automation.py
    # Note: When using native_enum=True with SQLAlchemy, it uses enum.name not enum.value
    op.execute(
        """
        CREATE TYPE input_event_type_enum AS ENUM (
            'MOUSE_CLICKED',
            'MOUSE_MOVED',
            'MOUSE_DRAGGED',
            'KEYBOARD_TEXT_TYPED'
        )
    """
    )

    # Step 3: Alter automation_input_events.event_type column to use the enum
    # Since the table is currently empty, we can do a direct type conversion
    # If the table had data, we would need to:
    #   a) Add a temporary column with the new enum type
    #   b) Copy and convert data from old column to new column
    #   c) Drop old column
    #   d) Rename new column to original name
    #
    # But since table is empty, we can use ALTER TYPE with USING clause
    op.execute(
        """
        ALTER TABLE automation_input_events
        ALTER COLUMN event_type TYPE input_event_type_enum
        USING event_type::text::input_event_type_enum
    """
    )


def downgrade() -> None:
    """
    Reverse schema changes:
    1. Convert automation_input_events.event_type back to VARCHAR(50)
    2. Drop input_event_type_enum type
    3. Remove max_duration_seconds column from automation_sessions
    """
    # Step 1: Convert event_type back to VARCHAR(50)
    # Cast enum values to text first
    op.execute(
        """
        ALTER TABLE automation_input_events
        ALTER COLUMN event_type TYPE VARCHAR(50)
        USING event_type::text
    """
    )

    # Step 2: Drop the enum type
    # Must be done after converting column away from enum type
    op.execute("DROP TYPE input_event_type_enum")

    # Step 3: Remove max_duration_seconds column
    op.drop_column("automation_sessions", "max_duration_seconds")
