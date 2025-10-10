#!/usr/bin/env python3
"""Script to make a user an admin."""

import sys

from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql://qontinui_admin:QontinuiSecure2025@qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com:5432/postgres?sslmode=require"


def main():
    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # First, show all users
        print("\nCurrent users:")
        result = conn.execute(
            text("SELECT id, username, email, is_superuser FROM users ORDER BY id")
        )
        for row in result:
            admin_status = "ADMIN" if row.is_superuser else "user"
            print(f"  {row.id}: {row.username} ({row.email}) - {admin_status}")

        if len(sys.argv) < 2:
            print("\nUsage: python make_admin.py <username_or_email>")
            sys.exit(1)

        identifier = sys.argv[1]

        # Find user by username or email
        result = conn.execute(
            text(
                "SELECT id, username, email, is_superuser FROM users WHERE username = :id OR email = :id"
            ),
            {"id": identifier},
        )
        user = result.fetchone()

        if not user:
            print(f"\n❌ User '{identifier}' not found")
            sys.exit(1)

        if user.is_superuser:
            print(f"\n✅ {user.username} is already an admin")
            sys.exit(0)

        # Make user admin
        conn.execute(
            text("UPDATE users SET is_superuser = true WHERE id = :id"), {"id": user.id}
        )
        conn.commit()

        print(f"\n✅ Successfully made {user.username} ({user.email}) an admin!")
        print("   User can now access https://qontinui.com/admin")


if __name__ == "__main__":
    main()
