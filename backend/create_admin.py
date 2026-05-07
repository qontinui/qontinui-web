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

# Cloud-control side-effect import — registers cloud-only models
# (Subscription, AdminNotificationSettings, etc.) via add_model_registrar.
# `User` declares `relationship("Subscription", ...)`, so SQLAlchemy needs
# the cloud-control hook to have fired before any `db.query(User)` triggers
# mapper configuration; otherwise it raises `KeyError: 'Subscription'`.
# Mirrors the pattern in `app/main.py` and `tests/utils/run_seed.py` —
# OSS soft-skip, CI hard-fail.
try:
    import qontinui_cloud_control  # noqa: F401, E402
except ImportError:
    if os.environ.get("CI") == "true" or os.environ.get("REQUIRE_CLOUD_CONTROL") == "1":
        raise

from app.core.test_credentials import get_admin_credentials  # noqa: E402

# Bulk-imports every in-tree model so SQLAlchemy's class registry has them
# all before `db.query(User)` triggers configure_mappers. Cloud-only models
# come in via the cloud-control import above.
from app.db.base_class import Base  # noqa: F401, E402
from app.db.session import SessionLocal  # noqa: E402
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
