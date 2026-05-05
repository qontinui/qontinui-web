#!/usr/bin/env python3
"""Script to create an admin/superuser in the database."""

import os
import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from passlib.context import CryptContext  # noqa: E402

import app.core.passlib_bcrypt5_compat  # noqa: F401, E402  # bcrypt 5 compat patch
from app.core.test_credentials import get_admin_credentials  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
# Bulk-imports every model in the codebase. Required before db.query(User)
# so SQLAlchemy can resolve string-based relationships (e.g. User has a
# `relationship("Subscription", ...)`); without this the query raises
# `KeyError: 'Subscription'` because `app.models.subscription` was never
# imported and the class registry doesn't see it.
from app.db.base_class import Base  # noqa: F401, E402
from app.models.user import User  # noqa: E402

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Get default credentials from centralized config
default_creds = get_admin_credentials()

# Allow customization via command line or environment
email = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.getenv("ADMIN_EMAIL", default_creds["email"])
)
username = (
    sys.argv[2]
    if len(sys.argv) > 2
    else os.getenv("ADMIN_USERNAME", default_creds["username"])
)
password = (
    sys.argv[3]
    if len(sys.argv) > 3
    else os.getenv("ADMIN_PASSWORD", default_creds["password"])
)

db = SessionLocal()
try:
    # Check if admin user exists
    admin = db.query(User).filter(User.email == email).first()  # type: ignore[arg-type]
    if not admin:
        admin = User(
            email=email,
            username=username,
            hashed_password=pwd_context.hash(password),
            is_active=True,
            is_superuser=True,
            is_verified=True,
        )
        db.add(admin)
        db.commit()
        print("Admin user created successfully!")
        print("Login with:")
        print(f"  Email: {email}")
        print(f"  Password: {password}")
    else:
        print("Admin user already exists")
        print("Login with:")
        print(f"  Email: {email}")
except Exception as e:
    print(f"Error: {e}")
    import traceback

    traceback.print_exc()
    db.rollback()
    # Re-raise so callers (CI in particular) get a non-zero exit code.
    # Previously this except clause swallowed the failure and exited 0,
    # which made downstream auth-dependent tests fail mysteriously.
    raise
finally:
    db.close()
