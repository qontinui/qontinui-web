#!/usr/bin/env python3
"""Debug authentication issue"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
from app.models.user import User
from app.models.project import Project  # Import to resolve relationship
from app.core.security import verify_password, get_password_hash

# Create database connection
engine = create_engine("sqlite:///qontinui.db")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

# Get test user
test_user = db.query(User).filter(User.email == "test@example.com").first()

if test_user:
    print(f"User found: {test_user.email}")
    print(f"Username: {test_user.username}")
    print(f"Hashed password exists: {bool(test_user.hashed_password)}")
    
    # Test password verification
    test_password = "testpassword"
    is_valid = verify_password(test_password, test_user.hashed_password)
    print(f"Password 'testpassword' is valid: {is_valid}")
    
    # If not valid, update the password
    if not is_valid:
        print("Updating password...")
        test_user.hashed_password = get_password_hash("testpassword")
        db.commit()
        print("Password updated!")
        
        # Verify again
        is_valid = verify_password(test_password, test_user.hashed_password)
        print(f"Password 'testpassword' is now valid: {is_valid}")
else:
    print("User not found!")

db.close()