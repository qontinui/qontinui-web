#!/usr/bin/env python3
"""Make jspinak@hotmail.com an admin - run this once then delete it."""

import psycopg2

# Database connection details
conn = psycopg2.connect(
    host="qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com",
    port=5432,
    database="postgres",
    user="qontinui_admin",
    password="QontinuiSecure2025",
    sslmode="require",
    connect_timeout=10,
)

try:
    cur = conn.cursor()

    # Make jspinak@hotmail.com an admin
    cur.execute(
        "UPDATE users SET is_superuser = true WHERE email = %s RETURNING username, email, is_superuser",
        ("jspinak@hotmail.com",),
    )

    result = cur.fetchone()

    if result:
        conn.commit()
        print(f"✅ Success! Made {result[0]} ({result[1]}) an admin")
        print(f"   is_superuser: {result[2]}")
        print("\nYou can now access: https://qontinui.com/admin")
    else:
        print("❌ User jspinak@hotmail.com not found in database")

        # Show what users exist
        cur.execute("SELECT username, email FROM users LIMIT 5")
        users = cur.fetchall()
        print("\nExisting users:")
        for user in users:
            print(f"  - {user[0]} ({user[1]})")

    cur.close()
finally:
    conn.close()
