#!/usr/bin/env python3
"""Reset password for jspinak@hotmail.com - run once then delete."""

import psycopg2
from passlib.context import CryptContext

# Password hashing context (same as used in the app)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# New password
new_password = "2008NawaNawa="
hashed_password = pwd_context.hash(new_password)

# Database connection
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

    # Update password for jspinak@hotmail.com
    cur.execute(
        "UPDATE users SET hashed_password = %s WHERE email = %s RETURNING username, email",
        (hashed_password, "jspinak@hotmail.com"),
    )

    result = cur.fetchone()

    if result:
        conn.commit()
        print(f"✅ Success! Password updated for {result[0]} ({result[1]})")
        print("\nYou can now login with:")
        print("  Email: jspinak@hotmail.com")
        print(f"  Password: {new_password}")
    else:
        print("❌ User jspinak@hotmail.com not found in database")

    cur.close()
finally:
    conn.close()
