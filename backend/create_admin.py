#!/usr/bin/env python3
import sys

sys.path.insert(0, "/home/jspinak/qontinui_parent_directory/qontinui-web/backend")

from passlib.context import CryptContext

from app.db.session import SessionLocal
from app.models.user import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

db = SessionLocal()
try:
    # Check if admin user exists
    admin = db.query(User).filter(User.email == "admin@qontinui.com").first()
    if not admin:
        admin = User(
            email="admin@qontinui.com",
            username="admin",
            hashed_password=pwd_context.hash("admin123"),
            is_active=True,
            is_superuser=True,
        )
        db.add(admin)
        db.commit()
        print("Admin user created successfully!")
        print("Login with:")
        print("  Email: admin@qontinui.com")
        print("  Password: admin123")
    else:
        print("Admin user already exists")
        print("Login with:")
        print("  Email: admin@qontinui.com")
        print("  Password: admin123")
except Exception as e:
    print(f"Error: {e}")
    db.rollback()
finally:
    db.close()
