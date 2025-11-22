#!/usr/bin/env python3
"""
Setup script for analysis result tables

This creates the analysis-related tables without using Alembic.
Safe to run multiple times - checks if tables exist before creating.
"""

import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from app.db.base_class import Base
from app.db.session import engine
from app.models.analysis_result import (
    AnalysisJob,
    AnalyzerResult,
    DetectedElementModel,
    FusedElement,
)
from sqlalchemy import inspect


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database"""
    inspector = inspect(engine)
    return table_name in inspector.get_table_names()


def create_analysis_tables():
    """Create analysis tables if they don't exist"""
    print("Checking analysis tables...")

    tables_to_create = []

    if not table_exists("analysis_jobs"):
        tables_to_create.append("analysis_jobs")
    else:
        print("  ✓ analysis_jobs table already exists")

    if not table_exists("analyzer_results"):
        tables_to_create.append("analyzer_results")
    else:
        print("  ✓ analyzer_results table already exists")

    if not table_exists("detected_elements"):
        tables_to_create.append("detected_elements")
    else:
        print("  ✓ detected_elements table already exists")

    if not table_exists("fused_elements"):
        tables_to_create.append("fused_elements")
    else:
        print("  ✓ fused_elements table already exists")

    if tables_to_create:
        print(f"\nCreating tables: {', '.join(tables_to_create)}")

        # Create the analysis tables in order (respecting foreign keys)
        AnalysisJob.__table__.create(engine, checkfirst=True)
        AnalyzerResult.__table__.create(engine, checkfirst=True)
        DetectedElementModel.__table__.create(engine, checkfirst=True)
        FusedElement.__table__.create(engine, checkfirst=True)

        print("  ✓ Tables created successfully")
    else:
        print("\n✓ All analysis tables already exist")

    print("\n✅ Analysis system database is ready!")


def drop_analysis_tables():
    """Drop analysis tables (use with caution!)"""
    print("⚠️  Dropping analysis tables...")

    if table_exists("fused_elements"):
        FusedElement.__table__.drop(engine)
        print("  ✓ Dropped fused_elements table")

    if table_exists("detected_elements"):
        DetectedElementModel.__table__.drop(engine)
        print("  ✓ Dropped detected_elements table")

    if table_exists("analyzer_results"):
        AnalyzerResult.__table__.drop(engine)
        print("  ✓ Dropped analyzer_results table")

    if table_exists("analysis_jobs"):
        AnalysisJob.__table__.drop(engine)
        print("  ✓ Dropped analysis_jobs table")

    print("✅ Analysis tables dropped")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Manage analysis database tables")
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Drop existing analysis tables (⚠️  destroys data)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate analysis tables (⚠️  destroys data)",
    )

    args = parser.parse_args()

    if args.reset:
        drop_analysis_tables()
        print()
        create_analysis_tables()
    elif args.drop:
        drop_analysis_tables()
    else:
        create_analysis_tables()
