#!/usr/bin/env python3
"""
Script to add is_beta column to users table
Run this to update your database schema
"""

import sys
from pathlib import Path

# Add the backend directory to the path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.db.session import engine  # noqa: E402


def add_beta_flag():
    """Add is_beta column to users table if it doesn't exist"""

    # Get database inspector
    inspector = inspect(engine)

    # Check if users table exists
    if "users" not in inspector.get_table_names():
        print("❌ Users table doesn't exist. Run the app first to create tables.")
        return

    # Get existing columns
    columns = [col["name"] for col in inspector.get_columns("users")]

    if "is_beta" not in columns:
        # Add the column
        with engine.connect() as conn:
            conn.execute(
                text(
                    """
                ALTER TABLE users
                ADD COLUMN is_beta BOOLEAN DEFAULT 0
            """
                )
            )
            conn.commit()
            print("✅ Added is_beta column to users table")
    else:
        print("ℹ️ is_beta column already exists")


if __name__ == "__main__":
    add_beta_flag()
