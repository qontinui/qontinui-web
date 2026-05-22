#!/usr/bin/env python3
"""Reset passwords for all local development users.

This script ensures all dev users have the correct password from the
centralized test_credentials.py configuration.

Run this after:
- Fresh database setup
- Password mismatch issues
- Changing the standard dev password
"""

import os
import sys

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from passlib.context import CryptContext  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

import app.core.passlib_bcrypt5_compat  # noqa: F401, E402  # bcrypt 5 compat patch
from app.core.test_credentials import (
    DEV_USER_EMAIL,  # noqa: E402
    STANDARD_DEV_PASSWORD,
)

# Password hashing context (same as used in the app)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Hash the standard password
hashed_password = pwd_context.hash(STANDARD_DEV_PASSWORD)

# Local database connection (canonical PG :5433 from qontinui-stack — legacy :5432 retired 2026-05-01)
DATABASE_URL = (
    "postgresql://qontinui_user:qontinui_dev_password@localhost:5433/qontinui_db"
)
engine = create_engine(DATABASE_URL, connect_args={"connect_timeout": 10})

# Users to reset - all should use the same standard password
users_to_reset = [
    DEV_USER_EMAIL,  # Primary dev user (josh@qontinui.io)
    "jspinak@hotmail.com",  # Legacy test user
]

print(f"Resetting passwords to: {STANDARD_DEV_PASSWORD}")
print("-" * 50)

try:
    with engine.connect() as conn:
        for email in users_to_reset:
            result = conn.execute(
                text(
                    # Schema-qualified: this codebase keeps users in the `auth`
                    # schema (see forbid-public-schema CI), not `public`. An
                    # unqualified `UPDATE users` resolves via search_path to
                    # public.users and fails with UndefinedTable.
                    "UPDATE auth.users SET hashed_password = :password WHERE email = :email RETURNING username, email"
                ),
                {"password": hashed_password, "email": email},
            )

            row = result.fetchone()

            if row:
                print(f"[OK] Updated: {row[0]} ({row[1]})")
            else:
                print(f"[--] Not found: {email}")

        conn.commit()

    print("-" * 50)
    print(f"\nAll users can now login with password: {STANDARD_DEV_PASSWORD}")
except Exception as e:
    print(f"Error: {e}")
    import traceback

    traceback.print_exc()
