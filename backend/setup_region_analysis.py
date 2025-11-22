#!/usr/bin/env python3
"""
Setup script for region analysis result tables

This creates the region analysis-related tables without using Alembic.
Safe to run multiple times - checks if tables exist before creating.
"""

import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from app.db.base_class import Base
from app.db.session import engine
from app.models.region_result import (
    DetectedRegionModel,
    FusedRegionModel,
    RegionAnalysisJob,
    RegionAnalyzerResult,
)
from sqlalchemy import inspect


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database"""
    inspector = inspect(engine)
    return table_name in inspector.get_table_names()


def create_region_analysis_tables():
    """Create region analysis tables if they don't exist"""
    print("Checking region analysis tables...")

    tables_to_create = []

    if not table_exists("region_analysis_jobs"):
        tables_to_create.append("region_analysis_jobs")
    else:
        print("  ✓ region_analysis_jobs table already exists")

    if not table_exists("region_analyzer_results"):
        tables_to_create.append("region_analyzer_results")
    else:
        print("  ✓ region_analyzer_results table already exists")

    if not table_exists("detected_regions"):
        tables_to_create.append("detected_regions")
    else:
        print("  ✓ detected_regions table already exists")

    if not table_exists("fused_regions"):
        tables_to_create.append("fused_regions")
    else:
        print("  ✓ fused_regions table already exists")

    if tables_to_create:
        print(f"\nCreating tables: {', '.join(tables_to_create)}")

        # Create the region analysis tables in order (respecting foreign keys)
        RegionAnalysisJob.__table__.create(engine, checkfirst=True)
        RegionAnalyzerResult.__table__.create(engine, checkfirst=True)
        DetectedRegionModel.__table__.create(engine, checkfirst=True)
        FusedRegionModel.__table__.create(engine, checkfirst=True)

        print("  ✓ Tables created successfully")
    else:
        print("\n✓ All region analysis tables already exist")

    print("\n✅ Region analysis system database is ready!")


def drop_region_analysis_tables():
    """Drop region analysis tables (use with caution!)"""
    print("⚠️  Dropping region analysis tables...")

    if table_exists("fused_regions"):
        FusedRegionModel.__table__.drop(engine)
        print("  ✓ Dropped fused_regions table")

    if table_exists("detected_regions"):
        DetectedRegionModel.__table__.drop(engine)
        print("  ✓ Dropped detected_regions table")

    if table_exists("region_analyzer_results"):
        RegionAnalyzerResult.__table__.drop(engine)
        print("  ✓ Dropped region_analyzer_results table")

    if table_exists("region_analysis_jobs"):
        RegionAnalysisJob.__table__.drop(engine)
        print("  ✓ Dropped region_analysis_jobs table")

    print("✅ Region analysis tables dropped")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Manage region analysis database tables"
    )
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Drop existing region analysis tables (⚠️  destroys data)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate region analysis tables (⚠️  destroys data)",
    )

    args = parser.parse_args()

    if args.reset:
        drop_region_analysis_tables()
        print()
        create_region_analysis_tables()
    elif args.drop:
        drop_region_analysis_tables()
    else:
        create_region_analysis_tables()
