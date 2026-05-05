#!/usr/bin/env python3
"""One-time script to make the first admin user via direct DB access."""

import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("Set DATABASE_URL before running this script.")

print("Connecting to database...")
engine = create_engine(DATABASE_URL, connect_args={"connect_timeout": 10})

try:
    with engine.connect() as conn:
        # Make jspinak@hotmail.com an admin
        result = conn.execute(
            text(
                "UPDATE users SET is_superuser = true WHERE email = 'jspinak@hotmail.com' RETURNING id, username, email"
            )
        )
        user = result.fetchone()

        if user:
            conn.commit()
            print(f"✅ Made {user.username} ({user.email}) an admin!")
        else:
            print("❌ User jspinak@hotmail.com not found")
            print("\nLet's check what users exist:")
            result = conn.execute(text("SELECT id, username, email FROM users LIMIT 5"))
            for row in result:
                print(f"  - {row.username} ({row.email})")
except Exception as e:
    print(f"❌ Error: {e}")
