#!/usr/bin/env python3
"""
Setup script for annotation tables

This creates the annotation_sets and annotations tables without using Alembic.
Safe to run multiple times - checks if tables exist before creating.
"""

import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from sqlalchemy import inspect

from app.db.session import engine
from app.models.annotation import Annotation, AnnotationSet


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database"""
    inspector = inspect(engine)
    return table_name in inspector.get_table_names()


def create_annotation_tables():
    """Create annotation tables if they don't exist"""
    print("Checking annotation tables...")

    tables_to_create = []

    if not table_exists("annotation_sets"):
        tables_to_create.append("annotation_sets")
    else:
        print("  ✓ annotation_sets table already exists")

    if not table_exists("annotations"):
        tables_to_create.append("annotations")
    else:
        print("  ✓ annotations table already exists")

    if tables_to_create:
        print(f"\nCreating tables: {', '.join(tables_to_create)}")

        # Create only the annotation tables
        AnnotationSet.__table__.create(engine, checkfirst=True)
        Annotation.__table__.create(engine, checkfirst=True)

        print("  ✓ Tables created successfully")
    else:
        print("\n✓ All annotation tables already exist")

    print("\n✅ Annotation system is ready!")


def drop_annotation_tables():
    """Drop annotation tables (use if you need to reset)"""
    print("⚠️  Dropping annotation tables...")

    if table_exists("annotations"):
        Annotation.__table__.drop(engine)
        print("  ✓ Dropped annotations table")

    if table_exists("annotation_sets"):
        AnnotationSet.__table__.drop(engine)
        print("  ✓ Dropped annotation_sets table")

    print("✅ Annotation tables dropped")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Manage annotation database tables")
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Drop existing annotation tables (⚠️  destroys data)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate annotation tables (⚠️  destroys data)",
    )

    args = parser.parse_args()

    if args.reset:
        drop_annotation_tables()
        print()
        create_annotation_tables()
    elif args.drop:
        drop_annotation_tables()
    else:
        create_annotation_tables()
