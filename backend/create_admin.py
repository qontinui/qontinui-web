#!/usr/bin/env python3
"""Script to create an admin/superuser in the database."""
import os
import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from passlib.context import CryptContext  # noqa: E402

from app.core.test_credentials import get_admin_credentials  # noqa: E402
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
    admin = db.query(User).filter(User.email == email).first()
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
finally:
    db.close()
