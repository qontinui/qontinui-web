"""Create all database tables from SQLAlchemy models."""

import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from app.db.base_class import Base  # This imports Base and all models
from app.db.session import engine


def create_tables():
    """Create all tables defined in SQLAlchemy models."""
    print("Creating all tables...")
    Base.metadata.create_all(bind=engine)
    print("All tables created successfully!")


if __name__ == "__main__":
    create_tables()
