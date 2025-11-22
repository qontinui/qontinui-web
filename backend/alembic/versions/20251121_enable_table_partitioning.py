"""enable_table_partitioning

Revision ID: 20251121_partitioning
Revises: b46613e9b784
Create Date: 2025-11-21 12:00:00.000000

This migration converts high-volume tables to partitioned tables:
- automation_logs: Partitioned by range (created_at) - Monthly partitions
- analytics_events: Partitioned by range (timestamp) - Monthly partitions
- automation_input_events: Partitioned by range (timestamp) - Weekly partitions

The migration:
1. Creates new partitioned parent tables with "_new" suffix
2. Copies indexes and constraints to the new tables
3. Migrates existing data to the new tables
4. Creates initial partitions for current month + next 2 months
5. Swaps the old tables with new partitioned tables
6. Cleans up the old tables

This enables automatic partition management for high-volume data.
"""

from datetime import datetime, timedelta
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = '20251121_partitioning'
down_revision: Union[str, None] = 'b46613e9b784'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def get_month_boundaries(year: int, month: int) -> tuple[str, str]:
    """Get ISO format start and end dates for a month."""
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)
    return start_date.isoformat(), end_date.isoformat()


def get_week_boundaries(reference_date: datetime) -> tuple[str, str]:
    """Get ISO format start and end dates for a week."""
    days_since_monday = reference_date.weekday()
    start_date = reference_date - timedelta(days=days_since_monday)
    start_date = datetime(start_date.year, start_date.month, start_date.day)
    end_date = start_date + timedelta(days=7)
    return start_date.isoformat(), end_date.isoformat()


def upgrade() -> None:
    """Convert tables to partitioned tables."""
    bind = op.get_bind()

    # Import inspect to check table existence
    from sqlalchemy import inspect
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    print("=" * 80)
    print("STARTING TABLE PARTITIONING MIGRATION")
    print("=" * 80)

    # =========================================================================
    # 1. AUTOMATION_LOGS - Monthly partitioning by created_at
    # =========================================================================
    if "automation_logs" in existing_tables:
        print("\n[1/3] Converting automation_logs to partitioned table...")

        # Create new partitioned parent table
        print("  Creating partitioned parent table automation_logs_new...")
        op.execute(text("""
            CREATE TABLE automation_logs_new (
                id UUID DEFAULT gen_random_uuid(),
                session_id UUID NOT NULL,
                sequence_number INTEGER NOT NULL,
                level VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                log_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                PRIMARY KEY (id, created_at),
                FOREIGN KEY (session_id) REFERENCES automation_sessions(id) ON DELETE CASCADE
            ) PARTITION BY RANGE (created_at)
        """))

        # Create initial partitions for current month + next 2 months
        print("  Creating initial partitions...")
        current_date = datetime.utcnow()
        for months_ahead in range(3):
            target_date = current_date + timedelta(days=months_ahead * 30)
            year = target_date.year
            month = target_date.month
            start_date, end_date = get_month_boundaries(year, month)
            partition_name = f"automation_logs_y{year}_m{month:02d}"

            print(f"    Creating partition {partition_name}...")
            op.execute(text(f"""
                CREATE TABLE {partition_name}
                PARTITION OF automation_logs_new
                FOR VALUES FROM ('{start_date}') TO ('{end_date}')
            """))

        # Copy data from old table to new table
        print("  Migrating existing data...")
        op.execute(text("""
            INSERT INTO automation_logs_new
            SELECT * FROM automation_logs
        """))

        # Create indexes on partitioned table
        print("  Creating indexes...")
        op.execute(text("""
            CREATE INDEX ix_automation_logs_new_session_id
            ON automation_logs_new (session_id)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_new_level
            ON automation_logs_new (level)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_new_timestamp
            ON automation_logs_new (timestamp)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_new_session_sequence
            ON automation_logs_new (session_id, sequence_number)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_new_event_type
            ON automation_logs_new USING gin (log_data)
        """))

        # Swap tables
        print("  Swapping tables...")
        op.execute(text("DROP TABLE automation_logs CASCADE"))
        op.execute(text("ALTER TABLE automation_logs_new RENAME TO automation_logs"))

        # Note: Cannot recreate foreign key from screenshot_input_associations because
        # partitioned tables require unique constraints to include the partition key.
        # Foreign key referenced automation_logs(id) but PRIMARY KEY is now (id, created_at).
        # Referential integrity must be maintained at application level.
        print("  Note: Foreign key constraints dropped (partitioned table limitation)")

        print("  ✓ automation_logs successfully partitioned")

    else:
        print("\n[1/3] automation_logs table not found, skipping...")

    # =========================================================================
    # 2. ANALYTICS_EVENTS - Monthly partitioning by timestamp
    # =========================================================================
    if "analytics_events" in existing_tables:
        print("\n[2/3] Converting analytics_events to partitioned table...")

        # Create new partitioned parent table
        print("  Creating partitioned parent table analytics_events_new...")
        op.execute(text("""
            CREATE TABLE analytics_events_new (
                id UUID,
                event_name VARCHAR(255) NOT NULL,
                user_id UUID,
                properties JSONB NOT NULL DEFAULT '{}'::jsonb,
                timestamp TIMESTAMP NOT NULL,
                created_at TIMESTAMP NOT NULL,
                PRIMARY KEY (id, timestamp),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) PARTITION BY RANGE (timestamp)
        """))

        # Create initial partitions for current month + next 2 months
        print("  Creating initial partitions...")
        current_date = datetime.utcnow()
        for months_ahead in range(3):
            target_date = current_date + timedelta(days=months_ahead * 30)
            year = target_date.year
            month = target_date.month
            start_date, end_date = get_month_boundaries(year, month)
            partition_name = f"analytics_events_y{year}_m{month:02d}"

            print(f"    Creating partition {partition_name}...")
            op.execute(text(f"""
                CREATE TABLE {partition_name}
                PARTITION OF analytics_events_new
                FOR VALUES FROM ('{start_date}') TO ('{end_date}')
            """))

        # Copy data from old table to new table
        print("  Migrating existing data...")
        op.execute(text("""
            INSERT INTO analytics_events_new
            SELECT * FROM analytics_events
        """))

        # Create indexes on partitioned table
        print("  Creating indexes...")
        op.execute(text("""
            CREATE INDEX ix_analytics_events_new_event_name
            ON analytics_events_new (event_name)
        """))
        op.execute(text("""
            CREATE INDEX ix_analytics_events_new_user_id
            ON analytics_events_new (user_id)
        """))
        op.execute(text("""
            CREATE INDEX ix_analytics_events_new_timestamp
            ON analytics_events_new (timestamp)
        """))
        op.execute(text("""
            CREATE INDEX ix_analytics_events_new_name_timestamp
            ON analytics_events_new (event_name, timestamp)
        """))
        op.execute(text("""
            CREATE INDEX ix_analytics_events_new_user_name
            ON analytics_events_new (user_id, event_name)
        """))
        op.execute(text("""
            CREATE INDEX ix_analytics_events_new_timestamp_desc
            ON analytics_events_new (timestamp DESC)
        """))

        # Swap tables
        print("  Swapping tables...")
        op.execute(text("DROP TABLE analytics_events CASCADE"))
        op.execute(text("ALTER TABLE analytics_events_new RENAME TO analytics_events"))

        print("  ✓ analytics_events successfully partitioned")

    else:
        print("\n[2/3] analytics_events table not found, skipping...")

    # =========================================================================
    # 3. AUTOMATION_INPUT_EVENTS - Weekly partitioning by timestamp
    # =========================================================================
    if "automation_input_events" in existing_tables:
        print("\n[3/3] Converting automation_input_events to partitioned table...")

        # Create new partitioned parent table
        print("  Creating partitioned parent table automation_input_events_new...")
        op.execute(text("""
            CREATE TABLE automation_input_events_new (
                id BIGSERIAL,
                session_id UUID NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                mouse_x INTEGER,
                mouse_y INTEGER,
                mouse_button VARCHAR(20),
                drag_from_x INTEGER,
                drag_from_y INTEGER,
                drag_to_x INTEGER,
                drag_to_y INTEGER,
                drag_duration FLOAT,
                drag_path_points JSONB,
                drag_avg_speed FLOAT,
                drag_max_speed FLOAT,
                text_typed TEXT,
                character_count INTEGER,
                screenshot_before_id UUID,
                screenshot_after_id UUID,
                created_at TIMESTAMP NOT NULL,
                PRIMARY KEY (id, timestamp),
                FOREIGN KEY (session_id) REFERENCES automation_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (screenshot_before_id) REFERENCES automation_screenshots(id) ON DELETE SET NULL,
                FOREIGN KEY (screenshot_after_id) REFERENCES automation_screenshots(id) ON DELETE SET NULL
            ) PARTITION BY RANGE (timestamp)
        """))

        # Create initial partitions for current week + next 12 weeks
        print("  Creating initial partitions...")
        current_date = datetime.utcnow()
        for weeks_ahead in range(13):
            target_date = current_date + timedelta(weeks=weeks_ahead)
            start_date, end_date = get_week_boundaries(target_date)
            year = target_date.year
            week_number = target_date.isocalendar()[1]
            partition_name = f"automation_input_events_y{year}_w{week_number:02d}"

            print(f"    Creating partition {partition_name}...")
            op.execute(text(f"""
                CREATE TABLE {partition_name}
                PARTITION OF automation_input_events_new
                FOR VALUES FROM ('{start_date}') TO ('{end_date}')
            """))

        # Copy data from old table to new table
        print("  Migrating existing data...")
        op.execute(text("""
            INSERT INTO automation_input_events_new
            SELECT * FROM automation_input_events
        """))

        # Create indexes on partitioned table
        print("  Creating indexes...")
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_new_id
            ON automation_input_events_new (id)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_new_session_id
            ON automation_input_events_new (session_id)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_new_session_timestamp
            ON automation_input_events_new (session_id, timestamp)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_new_event_type
            ON automation_input_events_new (event_type)
        """))

        # Swap tables
        print("  Swapping tables...")
        op.execute(text("DROP TABLE automation_input_events CASCADE"))
        op.execute(text("ALTER TABLE automation_input_events_new RENAME TO automation_input_events"))

        # Note: Cannot recreate foreign key from screenshot_input_associations because
        # partitioned tables require unique constraints to include the partition key.
        # Foreign key referenced automation_input_events(id) but PRIMARY KEY is now (id, timestamp).
        # Referential integrity must be maintained at application level.
        print("  Note: Foreign key constraints dropped (partitioned table limitation)")

        print("  ✓ automation_input_events successfully partitioned")

    else:
        print("\n[3/3] automation_input_events table not found, skipping...")

    print("\n" + "=" * 80)
    print("PARTITIONING MIGRATION COMPLETED SUCCESSFULLY")
    print("=" * 80)
    print("\nPartition Management:")
    print("  - Partitions will be auto-created weekly via ARQ background task")
    print("  - Old partitions will be auto-cleaned based on retention policies:")
    print("    • automation_logs: 12 months retention")
    print("    • analytics_events: 6 months retention")
    print("    • automation_input_events: 3 months retention")
    print("\nTo manually manage partitions, see:")
    print("  app/db/partition_manager.py")
    print("  app/worker/tasks/partition_tasks.py")
    print("=" * 80 + "\n")


def downgrade() -> None:
    """Revert partitioned tables back to regular tables."""
    bind = op.get_bind()

    print("=" * 80)
    print("REVERTING TABLE PARTITIONING")
    print("=" * 80)

    # Import inspect to check table existence
    from sqlalchemy import inspect
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    # =========================================================================
    # 1. Revert automation_logs
    # =========================================================================
    if "automation_logs" in existing_tables:
        print("\n[1/3] Reverting automation_logs to regular table...")

        # Create regular table
        op.execute(text("""
            CREATE TABLE automation_logs_regular (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id UUID NOT NULL,
                sequence_number INTEGER NOT NULL,
                level VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                log_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                FOREIGN KEY (session_id) REFERENCES automation_sessions(id) ON DELETE CASCADE
            )
        """))

        # Copy data
        op.execute(text("""
            INSERT INTO automation_logs_regular
            SELECT * FROM automation_logs
        """))

        # Recreate indexes
        op.execute(text("""
            CREATE INDEX ix_automation_logs_regular_session_id
            ON automation_logs_regular (session_id)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_regular_level
            ON automation_logs_regular (level)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_regular_timestamp
            ON automation_logs_regular (timestamp)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_regular_session_sequence
            ON automation_logs_regular (session_id, sequence_number)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_logs_regular_event_type
            ON automation_logs_regular USING gin (log_data)
        """))

        # Swap tables
        op.execute(text("DROP TABLE automation_logs CASCADE"))
        op.execute(text("ALTER TABLE automation_logs_regular RENAME TO automation_logs"))

        print("  ✓ automation_logs reverted to regular table")

    # =========================================================================
    # 2. Revert analytics_events
    # =========================================================================
    if "analytics_events" in existing_tables:
        print("\n[2/3] Reverting analytics_events to regular table...")

        # Create regular table
        op.execute(text("""
            CREATE TABLE analytics_events_regular (
                id UUID PRIMARY KEY,
                event_name VARCHAR(255) NOT NULL,
                user_id UUID,
                properties JSONB NOT NULL DEFAULT '{}'::jsonb,
                timestamp TIMESTAMP NOT NULL,
                created_at TIMESTAMP NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))

        # Copy data
        op.execute(text("""
            INSERT INTO analytics_events_regular
            SELECT * FROM analytics_events
        """))

        # Recreate indexes
        op.execute(text("""
            CREATE INDEX ix_analytics_events_regular_event_name
            ON analytics_events_regular (event_name)
        """))
        op.execute(text("""
            CREATE INDEX ix_analytics_events_regular_user_id
            ON analytics_events_regular (user_id)
        """))
        op.execute(text("""
            CREATE INDEX ix_analytics_events_regular_timestamp
            ON analytics_events_regular (timestamp)
        """))

        # Swap tables
        op.execute(text("DROP TABLE analytics_events CASCADE"))
        op.execute(text("ALTER TABLE analytics_events_regular RENAME TO analytics_events"))

        print("  ✓ analytics_events reverted to regular table")

    # =========================================================================
    # 3. Revert automation_input_events
    # =========================================================================
    if "automation_input_events" in existing_tables:
        print("\n[3/3] Reverting automation_input_events to regular table...")

        # Create regular table
        op.execute(text("""
            CREATE TABLE automation_input_events_regular (
                id BIGSERIAL PRIMARY KEY,
                session_id UUID NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                mouse_x INTEGER,
                mouse_y INTEGER,
                mouse_button VARCHAR(20),
                drag_from_x INTEGER,
                drag_from_y INTEGER,
                drag_to_x INTEGER,
                drag_to_y INTEGER,
                drag_duration FLOAT,
                drag_path_points JSONB,
                drag_avg_speed FLOAT,
                drag_max_speed FLOAT,
                text_typed TEXT,
                character_count INTEGER,
                screenshot_before_id UUID,
                screenshot_after_id UUID,
                created_at TIMESTAMP NOT NULL,
                FOREIGN KEY (session_id) REFERENCES automation_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (screenshot_before_id) REFERENCES automation_screenshots(id) ON DELETE SET NULL,
                FOREIGN KEY (screenshot_after_id) REFERENCES automation_screenshots(id) ON DELETE SET NULL
            )
        """))

        # Copy data
        op.execute(text("""
            INSERT INTO automation_input_events_regular
            SELECT * FROM automation_input_events
        """))

        # Recreate indexes
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_regular_id
            ON automation_input_events_regular (id)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_regular_session_id
            ON automation_input_events_regular (session_id)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_regular_session_timestamp
            ON automation_input_events_regular (session_id, timestamp)
        """))
        op.execute(text("""
            CREATE INDEX ix_automation_input_events_regular_event_type
            ON automation_input_events_regular (event_type)
        """))

        # Swap tables
        op.execute(text("DROP TABLE automation_input_events CASCADE"))
        op.execute(text("ALTER TABLE automation_input_events_regular RENAME TO automation_input_events"))

        print("  ✓ automation_input_events reverted to regular table")

    print("\n" + "=" * 80)
    print("PARTITIONING ROLLBACK COMPLETED")
    print("=" * 80 + "\n")
