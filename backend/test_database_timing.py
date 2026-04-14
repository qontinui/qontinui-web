"""
Test script for database query timing middleware.

This script verifies that the database timing middleware is working correctly
by simulating various query scenarios.

Run with: poetry run python test_database_timing.py
"""

import asyncio
import os
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

# Set test environment variables
os.environ["ENABLE_QUERY_LOGGING"] = "true"
os.environ["SLOW_QUERY_THRESHOLD_MS"] = "50"
os.environ["MAX_QUERIES_PER_REQUEST"] = "5"


async def test_query_timing():
    """Test the database query timing functionality."""
    from app.config.logging_config import configure_logging, get_logger
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal, async_engine, sync_engine
    from app.middleware.database_timing import init_database_timing
    from sqlalchemy import text

    # Configure logging
    configure_logging("development")
    logger = get_logger(__name__)

    logger.info("=== Testing Database Query Timing Middleware ===")
    logger.info(
        "configuration",
        slow_query_threshold_ms=settings.SLOW_QUERY_THRESHOLD_MS,
        enable_query_logging=settings.ENABLE_QUERY_LOGGING,
        max_queries_per_request=settings.MAX_QUERIES_PER_REQUEST,
    )

    # Initialize database timing
    init_database_timing(async_engine, sync_engine)

    # Test 1: Simple fast query
    logger.info("\n--- Test 1: Fast Query ---")
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT 1"))
        logger.info("fast_query_result", result=result.scalar())

    # Test 2: Slow query (using pg_sleep)
    logger.info("\n--- Test 2: Slow Query (should trigger warning) ---")
    async with AsyncSessionLocal() as session:
        # Sleep for 100ms to trigger slow query warning
        result = await session.execute(
            text("SELECT pg_sleep(0.1), 'slow query' as message")
        )
        row = result.first()
        logger.info("slow_query_result", message=row[1] if row else None)

    # Test 3: Multiple queries
    logger.info(
        "\n--- Test 3: Multiple Queries (should warn about excessive queries) ---"
    )
    async with AsyncSessionLocal() as session:
        for i in range(7):  # More than MAX_QUERIES_PER_REQUEST (5)
            result = await session.execute(text(f"SELECT {i} as query_num"))
            logger.info("multiple_query_iteration", iteration=i, result=result.scalar())

    # Test 4: Check that queries are being tracked
    logger.info("\n--- Test 4: Query Tracking Verification ---")
    from app.middleware.database_timing import get_current_query_stats

    stats = get_current_query_stats()
    if stats:
        summary = stats.get_summary()
        logger.info("query_stats_summary", **summary)
    else:
        logger.info(
            "no_query_stats", note="Stats only available within request context"
        )

    logger.info("\n=== Tests Complete ===")
    logger.info(
        "note",
        message="Check logs above for 'slow_query_async' and 'excessive_queries' warnings",
    )


async def test_with_request_context():
    """Test query timing within a simulated request context."""
    from app.config.logging_config import get_logger
    from app.db.session import AsyncSessionLocal
    from app.middleware.database_timing import track_request_queries
    from sqlalchemy import text

    logger = get_logger(__name__)

    logger.info("\n=== Testing with Request Context ===")

    # Simulate request context
    request_id = "test-request-123"

    with track_request_queries(request_id):
        async with AsyncSessionLocal() as session:
            # Execute multiple queries
            await session.execute(text("SELECT 1"))
            await session.execute(text("SELECT 2"))
            await session.execute(text("SELECT pg_sleep(0.06), 'slow' as msg"))  # Slow

        # Get stats
        from app.middleware.database_timing import get_current_query_stats

        stats = get_current_query_stats()
        if stats:
            summary = stats.get_summary()
            logger.info("request_query_summary", request_id=request_id, **summary)
            logger.info("slow_queries_found", count=len(stats.slow_queries))

    logger.info("\n=== Request Context Test Complete ===")


async def main():
    """Run all tests."""
    try:
        await test_query_timing()
        await test_with_request_context()
    except Exception as e:
        import traceback

        from app.config.logging_config import get_logger

        logger = get_logger(__name__)
        logger.error("test_failed", error=str(e), traceback=traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
