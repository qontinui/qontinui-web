#!/usr/bin/env python3
"""
Production Database Diagnostic Script
======================================
Safely checks the production database state before running migrations.

Usage:
    python check_prod_db.py <database_url>

Example:
    python check_prod_db.py "postgresql://user:pass@host:5432/dbname"
"""

import sys
from sqlalchemy import create_engine, text, inspect


def check_production_database(database_url: str):
    """Check production database state and readiness for migrations."""

    print("=" * 80)
    print("PRODUCTION DATABASE DIAGNOSTIC REPORT")
    print("=" * 80)
    print()

    try:
        # Create engine (read-only queries only)
        engine = create_engine(database_url, echo=False)

        with engine.connect() as conn:
            # 1. Check current alembic version
            print("1. CURRENT MIGRATION VERSION")
            print("-" * 40)
            try:
                result = conn.execute(text("SELECT version_num FROM alembic_version"))
                versions = [row[0] for row in result]
                if versions:
                    for v in versions:
                        print(f"   ✓ Migration version: {v}")
                    if len(versions) > 1:
                        print(f"   ⚠️  WARNING: Multiple heads detected ({len(versions)} versions)")
                else:
                    print("   ⚠️  No alembic version found - database not initialized")
            except Exception as e:
                print(f"   ❌ Error reading alembic_version: {e}")
            print()

            # 2. Check required tables exist
            print("2. REQUIRED TABLES (for migration dependencies)")
            print("-" * 40)
            inspector = inspect(engine)
            existing_tables = inspector.get_table_names()

            required_tables = ['users', 'annotation_sets']
            for table in required_tables:
                if table in existing_tables:
                    print(f"   ✓ {table} exists")
                else:
                    print(f"   ❌ {table} MISSING (migration will fail!)")
            print()

            # 3. Check if new tables already exist
            print("3. NEW TABLES (should NOT exist before migration)")
            print("-" * 40)
            new_tables = [
                'analytics_events',
                'analysis_jobs',
                'region_analysis_jobs',
                'analyzer_results',
                'fused_elements',
                'fused_regions',
                'region_analyzer_results',
                'detected_elements',
                'detected_regions'
            ]

            already_exist = []
            for table in new_tables:
                if table in existing_tables:
                    print(f"   ⚠️  {table} ALREADY EXISTS")
                    already_exist.append(table)
                else:
                    print(f"   ✓ {table} does not exist (ready to create)")
            print()

            # 4. Count total tables
            print("4. TOTAL TABLES IN DATABASE")
            print("-" * 40)
            print(f"   Total: {len(existing_tables)} tables")
            print()

            # 5. Check for JSONB columns with GIN indexes
            print("5. JSONB COLUMNS WITH GIN INDEXES")
            print("-" * 40)
            jsonb_tables = ['automation_logs', 'automation_screenshots',
                           'automation_sessions', 'screenshot_input_associations']
            for table in jsonb_tables:
                if table in existing_tables:
                    indexes = inspector.get_indexes(table)
                    gin_indexes = [idx for idx in indexes if 'gin' in str(idx).lower()]
                    if gin_indexes:
                        print(f"   ℹ️  {table} has GIN indexes: {len(gin_indexes)}")
            print()

            # 6. Summary and recommendations
            print("=" * 80)
            print("RECOMMENDATIONS")
            print("=" * 80)

            if already_exist:
                print("⚠️  CAUTION: Some tables already exist!")
                print("   The migration may fail with 'table already exists' errors.")
                print("   Consider:")
                print("   1. Creating a custom migration that skips existing tables")
                print("   2. Manually creating only missing tables")
                print()

            if versions and versions[0] != '0a5fcb4bb6cd':
                print("⚠️  CAUTION: Production is not at expected parent migration!")
                print(f"   Current: {versions[0] if versions else 'none'}")
                print("   Expected: 0a5fcb4bb6cd")
                print("   You may need to run intermediate migrations first.")
                print()

            if not already_exist and versions and versions[0] == '0a5fcb4bb6cd':
                print("✅ READY: Production database is ready for migration!")
                print("   Run: alembic upgrade head")
                print()

    except Exception as e:
        print(f"❌ ERROR: Failed to connect to database")
        print(f"   {type(e).__name__}: {e}")
        print()
        print("Check your connection string format:")
        print("   postgresql://user:password@host:port/database")
        return 1

    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        print("\n❌ Error: Database URL required")
        print("\nExample:")
        print('   python check_prod_db.py "postgresql://user:pass@host:5432/dbname"')
        sys.exit(1)

    database_url = sys.argv[1]
    sys.exit(check_production_database(database_url))
