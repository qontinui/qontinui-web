"""
ARQ Background Tasks for Partition Management

Provides automated partition maintenance tasks including:
- Auto-creation of future partitions
- Cleanup of old partitions based on retention policies
- Scheduled weekly execution via ARQ cron jobs

These tasks ensure partitions are always available before they're needed
and old data is automatically cleaned up according to retention policies.
"""

import time
from datetime import timedelta
from typing import Any, TypedDict, cast

import structlog
from app.core.config import settings
from app.db.partition_manager import (
    PARTITION_CONFIG,
    PartitionTable,
    create_monthly_partition,
    create_weekly_partition,
    drop_old_partitions,
    list_partitions,
)
from qontinui_schemas.common import utc_now

logger = structlog.get_logger(__name__)


# TypedDict definitions for type safety
class PartitionResult(TypedDict):
    """Result from creating a single partition"""

    status: str
    partition_name: str
    table_name: str
    start_date: str
    end_date: str


class TableResults(TypedDict, total=False):
    """Results for partition operations on a single table"""

    created: int
    already_existed: int
    errors: int
    partitions: list[dict[str, Any]]
    error_message: str
    retention_months: int
    partitions_deleted: int
    rows_deleted: int
    cutoff_date: str
    total_partitions: int
    total_size_mb: float
    total_rows: int


class AutoCreateResults(TypedDict, total=False):
    """Results from auto_create_partitions task"""

    status: str
    tables: dict[str, TableResults]
    total_created: int
    total_already_existed: int
    execution_time_seconds: float
    timestamp: str
    error: str


class CleanupResults(TypedDict, total=False):
    """Results from cleanup_old_partitions task"""

    status: str
    tables: dict[str, TableResults]
    total_partitions_deleted: int
    total_rows_deleted: int
    execution_time_seconds: float
    timestamp: str
    error: str


class StatisticsResults(TypedDict, total=False):
    """Results from get_partition_statistics task"""

    status: str
    tables: dict[str, TableResults]
    execution_time_seconds: float
    timestamp: str
    error: str


async def auto_create_partitions(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Automatically create partitions for the next 3 months.

    This task creates future partitions to ensure they exist before data arrives.
    Runs weekly via ARQ cron job.

    For monthly partitions (automation_logs, analytics_events):
    - Creates partitions for current month + next 3 months

    For weekly partitions (automation_input_events):
    - Creates partitions for current week + next 12 weeks

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)

    Returns:
        Dict with creation summary and statistics

    Example result:
        {
            "status": "success",
            "tables": {
                "automation_logs": {
                    "created": 2,
                    "already_existed": 2,
                    "partitions": [...]
                },
                ...
            },
            "total_created": 5,
            "execution_time_seconds": 1.23
        }
    """
    start_time = time.time()
    logger.info("auto_create_partitions_started")

    try:
        from app.db.session import AsyncSessionLocal

        results: AutoCreateResults = {
            "status": "success",
            "tables": {},
            "total_created": 0,
            "total_already_existed": 0,
        }

        async with AsyncSessionLocal() as db:
            current_date = utc_now()

            # Process each table according to its configuration
            for table_name, config in PARTITION_CONFIG.items():
                table_results: TableResults = {
                    "created": 0,
                    "already_existed": 0,
                    "errors": 0,
                    "partitions": [],
                }

                granularity = config["granularity"]

                try:
                    if granularity == "monthly":
                        # Create partitions for current month + next 3 months
                        for months_ahead in range(4):
                            target_date = current_date + timedelta(
                                days=months_ahead * 30
                            )
                            year = target_date.year
                            month = target_date.month

                            result = await create_monthly_partition(
                                db, cast(PartitionTable, table_name), year, month
                            )
                            table_results["partitions"].append(result)

                            if result["status"] == "created":
                                table_results["created"] += 1
                            elif result["status"] == "already_exists":
                                table_results["already_existed"] += 1

                    elif granularity == "weekly":
                        # Create partitions for current week + next 12 weeks
                        for weeks_ahead in range(13):
                            target_date = current_date + timedelta(weeks=weeks_ahead)

                            result = await create_weekly_partition(
                                db, cast(PartitionTable, table_name), target_date
                            )
                            table_results["partitions"].append(result)

                            if result["status"] == "created":
                                table_results["created"] += 1
                            elif result["status"] == "already_exists":
                                table_results["already_existed"] += 1

                    results["total_created"] += table_results["created"]
                    results["total_already_existed"] += table_results["already_existed"]

                except Exception as e:
                    logger.exception(
                        "partition_creation_failed_for_table",
                        table_name=table_name,
                        error=str(e),
                        error_type=type(e).__name__,
                    )
                    table_results["errors"] += 1
                    table_results["error_message"] = str(e)
                    results["status"] = "partial_success"

                results["tables"][table_name] = table_results

        execution_time = time.time() - start_time

        logger.info(
            "auto_create_partitions_completed",
            status=results["status"],
            total_created=results["total_created"],
            total_already_existed=results["total_already_existed"],
            execution_time_seconds=round(execution_time, 2),
        )

        results["execution_time_seconds"] = round(execution_time, 2)
        results["timestamp"] = utc_now().isoformat()

        return cast(dict[str, Any], results)

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "auto_create_partitions_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        error_result: AutoCreateResults = {
            "status": "error",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": utc_now().isoformat(),
        }
        return cast(dict[str, Any], error_result)


async def cleanup_old_partitions(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up old partitions based on retention policies.

    Automatically drops partitions older than the configured retention period:
    - automation_logs: 12 months
    - analytics_events: 6 months
    - automation_input_events: 3 months

    Runs weekly via ARQ cron job.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)

    Returns:
        Dict with cleanup summary and statistics

    Example result:
        {
            "status": "success",
            "tables": {
                "automation_logs": {
                    "partitions_deleted": 1,
                    "rows_deleted": 12500,
                    "partitions": [...]
                },
                ...
            },
            "total_partitions_deleted": 3,
            "total_rows_deleted": 45000,
            "execution_time_seconds": 2.45
        }
    """
    start_time = time.time()
    logger.info("cleanup_old_partitions_started")

    try:
        from app.db.session import AsyncSessionLocal

        results: CleanupResults = {
            "status": "success",
            "tables": {},
            "total_partitions_deleted": 0,
            "total_rows_deleted": 0,
        }

        async with AsyncSessionLocal() as db:
            # Process each table according to its retention policy
            for table_name, config in PARTITION_CONFIG.items():
                try:
                    # Execute cleanup (dry_run=False for actual deletion)
                    cleanup_result = await drop_old_partitions(
                        db, cast(PartitionTable, table_name), dry_run=False
                    )

                    table_results: TableResults = {
                        "retention_months": cast(int, config["retention_months"]),
                        "partitions_deleted": len(cleanup_result["partitions_deleted"]),
                        "rows_deleted": cleanup_result["total_rows_to_delete"],
                        "cutoff_date": cleanup_result["cutoff_date"],
                        "partitions": cleanup_result["partitions_deleted"],
                    }

                    results["total_partitions_deleted"] += table_results[
                        "partitions_deleted"
                    ]
                    results["total_rows_deleted"] += table_results["rows_deleted"]
                    results["tables"][table_name] = table_results

                except Exception as e:
                    logger.exception(
                        "partition_cleanup_failed_for_table",
                        table_name=table_name,
                        error=str(e),
                        error_type=type(e).__name__,
                    )
                    error_table_results: TableResults = {
                        "errors": 1,
                        "error_message": str(e),
                        "created": 0,
                        "already_existed": 0,
                        "partitions": [],
                    }
                    results["tables"][table_name] = error_table_results
                    results["status"] = "partial_success"

        execution_time = time.time() - start_time

        logger.info(
            "cleanup_old_partitions_completed",
            status=results["status"],
            total_partitions_deleted=results["total_partitions_deleted"],
            total_rows_deleted=results["total_rows_deleted"],
            execution_time_seconds=round(execution_time, 2),
        )

        results["execution_time_seconds"] = round(execution_time, 2)
        results["timestamp"] = utc_now().isoformat()

        return cast(dict[str, Any], results)

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_old_partitions_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        error_result: CleanupResults = {
            "status": "error",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": utc_now().isoformat(),
        }
        return cast(dict[str, Any], error_result)


async def get_partition_statistics(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Get comprehensive statistics about all partitions.

    Provides an overview of partition health and storage usage.
    Useful for monitoring and capacity planning.

    Args:
        ctx: ARQ context

    Returns:
        Dict with statistics for all partitioned tables

    Example result:
        {
            "status": "success",
            "tables": {
                "automation_logs": {
                    "total_partitions": 12,
                    "total_size_mb": 1024.5,
                    "total_rows": 500000000,
                    "partitions": [...]
                },
                ...
            }
        }
    """
    start_time = time.time()
    logger.info("get_partition_statistics_started")

    try:
        from app.db.session import AsyncSessionLocal

        results: StatisticsResults = {
            "status": "success",
            "tables": {},
        }

        async with AsyncSessionLocal() as db:
            for table_name in PARTITION_CONFIG.keys():
                try:
                    partitions = await list_partitions(
                        db, cast(PartitionTable, table_name)
                    )

                    total_size_mb = sum(cast(float, p["size_mb"]) for p in partitions)
                    total_rows = sum(cast(int, p["row_count"]) for p in partitions)

                    table_stats: TableResults = {
                        "total_partitions": len(partitions),
                        "total_size_mb": round(total_size_mb, 2),
                        "total_rows": total_rows,
                        "partitions": partitions,
                        "created": 0,
                        "already_existed": 0,
                        "errors": 0,
                    }
                    results["tables"][table_name] = table_stats

                except Exception as e:
                    logger.exception(
                        "partition_statistics_failed_for_table",
                        table_name=table_name,
                        error=str(e),
                    )
                    error_stats: TableResults = {
                        "errors": 1,
                        "error_message": str(e),
                        "created": 0,
                        "already_existed": 0,
                        "partitions": [],
                    }
                    results["tables"][table_name] = error_stats

        execution_time = time.time() - start_time

        logger.info(
            "get_partition_statistics_completed",
            execution_time_seconds=round(execution_time, 2),
        )

        results["execution_time_seconds"] = round(execution_time, 2)
        results["timestamp"] = utc_now().isoformat()

        return cast(dict[str, Any], results)

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "get_partition_statistics_failed",
            error=str(e),
            error_type=type(e).__name__,
        )
        error_result: StatisticsResults = {
            "status": "error",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": utc_now().isoformat(),
        }
        return cast(dict[str, Any], error_result)


def get_partition_cron_jobs() -> list[dict[str, Any]]:
    """
    Get cron job definitions for partition maintenance tasks.

    Schedules:
    - auto_create_partitions: Weekly on Sundays at 1 AM UTC
    - cleanup_old_partitions: Weekly on Sundays at 3 AM UTC

    Returns:
        List of cron job definitions for ARQ

    Example:
        [
            {
                "function": auto_create_partitions,
                "weekday": 0,  # Sunday
                "hour": 1,
                "minute": 0,
                "keep_result_forever": True
            },
            ...
        ]
    """
    # Check if partition maintenance is enabled (default: True)
    partition_enabled = getattr(settings, "PARTITION_ENABLED", True)

    if not partition_enabled:
        logger.info("partition_jobs_disabled", reason="PARTITION_ENABLED=False")
        return []

    cron_jobs = [
        # Auto-create partitions - Weekly on Sundays at 1 AM UTC
        {
            "function": auto_create_partitions,
            "weekday": 0,  # Sunday (0 = Monday, 6 = Sunday in ARQ)
            "hour": 1,
            "minute": 0,
            "keep_result_forever": True,  # Keep results for audit
        },
        # Cleanup old partitions - Weekly on Sundays at 3 AM UTC
        {
            "function": cleanup_old_partitions,
            "weekday": 0,  # Sunday
            "hour": 3,
            "minute": 0,
            "keep_result_forever": True,  # Keep results for audit
        },
    ]

    logger.info(
        "partition_jobs_scheduled",
        job_count=len(cron_jobs),
        schedule="Weekly on Sundays (1 AM and 3 AM UTC)",
    )

    return cron_jobs


# Export all partition task functions
__all__ = [
    "auto_create_partitions",
    "cleanup_old_partitions",
    "get_partition_statistics",
    "get_partition_cron_jobs",
]
