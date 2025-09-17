#!/usr/bin/env python3
"""Setup test data directly in the database"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
from app.models.user import User
from app.models.project import Project
from app.core.security import get_password_hash
import json

# Create database connection
engine = create_engine("sqlite:///qontinui.db")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables if they don't exist
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Check if test user exists
test_user = db.query(User).filter(User.email == "test@example.com").first()

if not test_user:
    # Create test user
    test_user = User(
        email="test@example.com",
        username="testuser",
        full_name="Test User",
        hashed_password=get_password_hash("testpassword"),
        is_active=True,
        is_superuser=False
    )
    db.add(test_user)
    db.commit()
    db.refresh(test_user)
    print(f"Created test user: {test_user.email}")
else:
    print(f"Test user already exists: {test_user.email}")

# Create a sample project for the test user
sample_config = {
    "version": "1.0.0",
    "metadata": {
        "name": "Sample Automation",
        "description": "Test configuration for export/import",
        "tags": ["test", "sample"],
        "targetApplication": "Test App"
    },
    "images": [],
    "processes": [],
    "states": [],
    "transitions": [],
    "settings": {
        "execution": {
            "defaultTimeout": 10000,
            "defaultRetryCount": 3,
            "actionDelay": 100,
            "failureStrategy": "stop"
        }
    }
}

# Check if project exists
test_project = db.query(Project).filter(
    Project.owner_id == test_user.id,
    Project.name == "Test Project"
).first()

if not test_project:
    test_project = Project(
        name="Test Project",
        description="A test project for export/import",
        configuration=sample_config,
        owner_id=test_user.id
    )
    db.add(test_project)
    db.commit()
    db.refresh(test_project)
    print(f"Created test project: {test_project.name} (ID: {test_project.id})")
else:
    print(f"Test project already exists: {test_project.name} (ID: {test_project.id})")

db.close()
print("\nTest data setup complete!")
print("You can now login with:")
print("  Email: test@example.com")
print("  Password: testpassword")