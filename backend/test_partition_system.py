#!/usr/bin/env python3
"""
Test script for partition management system.

This script tests all core partition management functionality:
- Creating monthly partitions
- Creating weekly partitions
- Listing partitions
- Cleanup with dry run
- Configuration validation

Run this script after running the migration to verify everything works.

Usage:
    python test_partition_system.py
"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from app.db.partition_manager import (PARTITION_CONFIG,
                                      create_monthly_partition,
                                      create_weekly_partition,
                                      drop_old_partitions,
                                      format_partition_name,
                                      get_month_boundaries,
                                      get_week_boundaries, list_partitions)
from app.db.session import AsyncSessionLocal


async def test_helper_functions():
    """Test helper functions for boundary calculations."""
    print("\n" + "=" * 80)
    print("TEST 1: Helper Functions")
    print("=" * 80)

    # Test month boundaries
    print("\n[Month Boundaries]")
    start, end = get_month_boundaries(2025, 11)
    print(f"  November 2025: {start} → {end}")
    assert start == datetime(2025, 11, 1), "Invalid November start"
    assert end == datetime(2025, 12, 1), "Invalid November end"

    start, end = get_month_boundaries(2025, 12)
    print(f"  December 2025: {start} → {end}")
    assert start == datetime(2025, 12, 1), "Invalid December start"
    assert end == datetime(2026, 1, 1), "Invalid December end (year transition)"

    # Test week boundaries
    print("\n[Week Boundaries]")
    ref_date = datetime(2025, 11, 21)  # Friday
    start, end = get_week_boundaries(ref_date)
    print(f"  Week of Nov 21, 2025: {start} → {end}")
    assert start.weekday() == 0, "Week should start on Monday"
    assert (end - start).days == 7, "Week should be 7 days"

    # Test partition naming
    print("\n[Partition Naming]")
    name = format_partition_name("automation_logs", datetime(2025, 11, 1), "monthly")
    print(f"  Monthly: {name}")
    assert name == "automation_logs_y2025_m11", "Invalid monthly partition name"

    name = format_partition_name(
        "automation_input_events", datetime(2025, 11, 17), "weekly"
    )
    print(f"  Weekly: {name}")
    assert name.startswith(
        "automation_input_events_y2025_w"
    ), "Invalid weekly partition name"

    print("\n✓ All helper functions passed")


async def test_configuration():
    """Test partition configuration."""
    print("\n" + "=" * 80)
    print("TEST 2: Partition Configuration")
    print("=" * 80)

    for table_name, config in PARTITION_CONFIG.items():
        print(f"\n[{table_name}]")
        print(f"  Granularity: {config['granularity']}")
        print(f"  Partition Key: {config['partition_key']}")
        print(f"  Retention: {config['retention_months']} months")

        assert config["granularity"] in ["monthly", "weekly"], "Invalid granularity"
        assert config["retention_months"] > 0, "Invalid retention period"  # type: ignore[operator]

    print("\n✓ Configuration valid")


async def test_create_monthly_partitions():
    """Test creating monthly partitions."""
    print("\n" + "=" * 80)
    print("TEST 3: Create Monthly Partitions")
    print("=" * 80)

    async with AsyncSessionLocal() as db:
        current_date = datetime.now(UTC)

        # Test automation_logs
        print("\n[automation_logs]")
        for months_ahead in range(3):
            target_date = current_date + timedelta(days=months_ahead * 30)
            year = target_date.year
            month = target_date.month

            result = await create_monthly_partition(db, "automation_logs", year, month)
            status = result["status"]
            partition_name = result["partition_name"]

            print(f"  {partition_name}: {status}")

            if status not in ["created", "already_exists"]:
                raise AssertionError(f"Unexpected status: {status}")

        # Test analytics_events
        print("\n[analytics_events]")
        for months_ahead in range(3):
            target_date = current_date + timedelta(days=months_ahead * 30)
            year = target_date.year
            month = target_date.month

            result = await create_monthly_partition(db, "analytics_events", year, month)
            status = result["status"]
            partition_name = result["partition_name"]

            print(f"  {partition_name}: {status}")

            if status not in ["created", "already_exists"]:
                raise AssertionError(f"Unexpected status: {status}")

    print("\n✓ Monthly partitions created successfully")


async def test_create_weekly_partitions():
    """Test creating weekly partitions."""
    print("\n" + "=" * 80)
    print("TEST 4: Create Weekly Partitions")
    print("=" * 80)

    async with AsyncSessionLocal() as db:
        current_date = datetime.now(UTC)

        print("\n[automation_input_events]")
        for weeks_ahead in range(3):
            target_date = current_date + timedelta(weeks=weeks_ahead)

            result = await create_weekly_partition(
                db, "automation_input_events", target_date
            )
            status = result["status"]
            partition_name = result["partition_name"]

            print(f"  {partition_name}: {status}")

            if status not in ["created", "already_exists"]:
                raise AssertionError(f"Unexpected status: {status}")

    print("\n✓ Weekly partitions created successfully")


async def test_list_partitions():
    """Test listing partitions."""
    print("\n" + "=" * 80)
    print("TEST 5: List Partitions")
    print("=" * 80)

    async with AsyncSessionLocal() as db:
        for table_name in PARTITION_CONFIG.keys():
            print(f"\n[{table_name}]")
            partitions = await list_partitions(db, cast(Any, table_name))

            if not partitions:
                print("  No partitions found (table may not be partitioned yet)")
                continue

            print(f"  Total partitions: {len(partitions)}")
            total_size_mb = sum(p["size_mb"] for p in partitions)
            total_rows = sum(p["row_count"] for p in partitions)

            print(f"  Total size: {total_size_mb:.2f} MB")
            print(f"  Total rows: {total_rows}")

            print("\n  Recent partitions:")
            for partition in partitions[-5:]:  # Show last 5
                print(
                    f"    {partition['partition_name']}: "
                    f"{partition['row_count']} rows, "
                    f"{partition['size_mb']} MB"
                )

    print("\n✓ Partition listing successful")


async def test_cleanup_dry_run():
    """Test cleanup with dry run."""
    print("\n" + "=" * 80)
    print("TEST 6: Cleanup with Dry Run")
    print("=" * 80)

    async with AsyncSessionLocal() as db:
        for table_name in PARTITION_CONFIG.keys():
            print(f"\n[{table_name}]")
            config = PARTITION_CONFIG[table_name]

            result = await drop_old_partitions(db, cast(Any, table_name), dry_run=True)

            print(f"  Retention: {config['retention_months']} months")
            print(f"  Cutoff date: {result['cutoff_date']}")
            print(f"  Partitions to delete: {len(result['partitions_to_delete'])}")
            print(f"  Total rows to delete: {result['total_rows_to_delete']}")

            if result["partitions_to_delete"]:
                print("\n  Partitions that would be deleted:")
                for p in result["partitions_to_delete"]:
                    print(
                        f"    {p['partition_name']}: "
                        f"{p['row_count']} rows, "
                        f"{p['size_mb']} MB, "
                        f"{p['age_months']} months old"
                    )

    print("\n✓ Cleanup dry run successful")


async def test_duplicate_creation():
    """Test that duplicate partition creation is handled correctly."""
    print("\n" + "=" * 80)
    print("TEST 7: Duplicate Creation Handling")
    print("=" * 80)

    async with AsyncSessionLocal() as db:
        current_date = datetime.now(UTC)
        year = current_date.year
        month = current_date.month

        print("\n[Creating same partition twice]")

        # First creation
        result1 = await create_monthly_partition(db, "automation_logs", year, month)
        print(f"  First attempt: {result1['status']}")

        # Second creation (should return "already_exists")
        result2 = await create_monthly_partition(db, "automation_logs", year, month)
        print(f"  Second attempt: {result2['status']}")

        assert result2["status"] == "already_exists", "Duplicate creation not handled"

    print("\n✓ Duplicate creation handled correctly")


async def run_all_tests():
    """Run all tests."""
    print("\n" + "=" * 80)
    print("PARTITION SYSTEM TEST SUITE")
    print("=" * 80)

    try:
        await test_helper_functions()
        await test_configuration()
        await test_create_monthly_partitions()
        await test_create_weekly_partitions()
        await test_list_partitions()
        await test_cleanup_dry_run()
        await test_duplicate_creation()

        print("\n" + "=" * 80)
        print("ALL TESTS PASSED ✓")
        print("=" * 80)
        print("\nPartition system is working correctly!")
        print("You can now:")
        print("  1. Use the partition management API")
        print("  2. Run ARQ background tasks")
        print("  3. Start inserting data into partitioned tables")
        print("\nSee PARTITION_MANAGEMENT_GUIDE.md for usage examples.")
        print("=" * 80 + "\n")

    except Exception as e:
        print("\n" + "=" * 80)
        print("TEST FAILED ✗")
        print("=" * 80)
        print(f"\nError: {e}")
        print("\nCheck the error above and:")
        print("  1. Ensure the migration has been run: alembic upgrade head")
        print("  2. Ensure the database is running and accessible")
        print("  3. Check logs for more details")
        print("=" * 80 + "\n")
        raise


if __name__ == "__main__":
    asyncio.run(run_all_tests())
