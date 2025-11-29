"""
Time-Series Partition Management System

Provides comprehensive partition management for high-volume PostgreSQL tables.
Supports automatic partition creation, listing, and cleanup with configurable
retention policies.

Tables managed:
- automation_logs: Monthly partitions, 12-month retention
- analytics_events: Monthly partitions, 6-month retention
- automation_input_events: Weekly partitions, 3-month retention
"""

import calendar
import re
from datetime import datetime, timedelta
from typing import Any, Literal

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

# Valid identifier pattern for PostgreSQL table names
# Only allows alphanumeric characters and underscores, must start with letter or underscore
_VALID_IDENTIFIER_PATTERN = re.compile(r"^[a-z_][a-z0-9_]*$", re.IGNORECASE)


def _validate_identifier(name: str) -> str:
    """
    Validate and sanitize a PostgreSQL identifier (table/partition name).

    Prevents SQL injection by ensuring the name contains only safe characters.

    Args:
        name: The identifier to validate

    Returns:
        The validated identifier

    Raises:
        ValueError: If the identifier contains invalid characters
    """
    if not name or not _VALID_IDENTIFIER_PATTERN.match(name):
        raise ValueError(
            f"Invalid identifier: {name!r}. Must contain only letters, "
            "numbers, and underscores, and start with a letter or underscore."
        )
    if len(name) > 63:  # PostgreSQL identifier length limit
        raise ValueError(f"Identifier too long: {len(name)} chars (max 63)")
    return name


# Partition configuration
PartitionTable = Literal[
    "automation_logs", "analytics_events", "automation_input_events"
]

PARTITION_CONFIG = {
    "automation_logs": {
        "granularity": "monthly",
        "partition_key": "created_at",
        "retention_months": 12,
    },
    "analytics_events": {
        "granularity": "monthly",
        "partition_key": "timestamp",
        "retention_months": 6,
    },
    "automation_input_events": {
        "granularity": "weekly",
        "partition_key": "timestamp",
        "retention_months": 3,
    },
}


def get_month_boundaries(year: int, month: int) -> tuple[datetime, datetime]:
    """
    Get the start and end boundaries for a given month.

    Args:
        year: Year (e.g., 2025)
        month: Month (1-12)

    Returns:
        Tuple of (start_date, end_date) for the month

    Example:
        >>> get_month_boundaries(2025, 11)
        (datetime(2025, 11, 1), datetime(2025, 12, 1))
    """
    start_date = datetime(year, month, 1)
    # Get last day of the month
    last_day = calendar.monthrange(year, month)[1]
    # End date is the first day of next month for range partitioning
    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)
    return start_date, end_date


def get_week_boundaries(reference_date: datetime) -> tuple[datetime, datetime]:
    """
    Get the start and end boundaries for the week containing the reference date.

    Uses Monday as the start of the week (ISO 8601 standard).

    Args:
        reference_date: Any date within the target week

    Returns:
        Tuple of (start_date, end_date) for the week

    Example:
        >>> get_week_boundaries(datetime(2025, 11, 21))  # Friday
        (datetime(2025, 11, 17), datetime(2025, 11, 24))  # Monday to Monday
    """
    # Get Monday of the current week (ISO weekday: Monday=1, Sunday=7)
    days_since_monday = reference_date.weekday()
    start_date = reference_date - timedelta(days=days_since_monday)
    start_date = datetime(start_date.year, start_date.month, start_date.day)

    # End date is the Monday of next week
    end_date = start_date + timedelta(days=7)
    return start_date, end_date


def format_partition_name(
    table_name: str, start_date: datetime, granularity: str
) -> str:
    """
    Generate a standardized partition name.

    Format:
    - Monthly: {table}_y{year}_m{month} (e.g., automation_logs_y2025_m11)
    - Weekly: {table}_y{year}_w{week} (e.g., automation_input_events_y2025_w47)

    Args:
        table_name: Base table name
        start_date: Start date of the partition
        granularity: 'monthly' or 'weekly'

    Returns:
        Formatted partition name

    Example:
        >>> format_partition_name("automation_logs", datetime(2025, 11, 1), "monthly")
        'automation_logs_y2025_m11'
    """
    year = start_date.year
    if granularity == "monthly":
        month = start_date.month
        return f"{table_name}_y{year}_m{month:02d}"
    elif granularity == "weekly":
        # Get ISO week number (1-53)
        week_number = start_date.isocalendar()[1]
        return f"{table_name}_y{year}_w{week_number:02d}"
    else:
        raise ValueError(f"Unsupported granularity: {granularity}")


async def create_monthly_partition(
    db: AsyncSession,
    table_name: PartitionTable,
    year: int,
    month: int,
) -> dict[str, Any]:
    """
    Create a monthly partition for the specified table.

    Creates a partition using PostgreSQL native PARTITION BY RANGE.
    The partition covers the entire month from the 1st to the 1st of next month.

    Args:
        db: Database session
        table_name: Name of the partitioned table
        year: Year for the partition
        month: Month for the partition (1-12)

    Returns:
        Dict with partition creation status and details

    Example:
        >>> await create_monthly_partition(db, "automation_logs", 2025, 11)
        {
            "status": "created",
            "partition_name": "automation_logs_y2025_m11",
            "table_name": "automation_logs",
            "start_date": "2025-11-01T00:00:00",
            "end_date": "2025-12-01T00:00:00"
        }
    """
    config = PARTITION_CONFIG[table_name]
    if config["granularity"] != "monthly":
        raise ValueError(f"Table {table_name} does not use monthly partitions")

    start_date, end_date = get_month_boundaries(year, month)
    partition_name = format_partition_name(table_name, start_date, "monthly")

    # Check if partition already exists
    check_query = text(
        """
        SELECT EXISTS (
            SELECT 1 FROM pg_tables
            WHERE tablename = :partition_name
        )
    """
    )
    result = await db.execute(check_query, {"partition_name": partition_name})
    exists = result.scalar()

    if exists:
        logger.info(
            "partition_already_exists",
            partition_name=partition_name,
            table_name=table_name,
        )
        return {
            "status": "already_exists",
            "partition_name": partition_name,
            "table_name": table_name,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }

    # Create the partition
    create_query = text(
        f"""
        CREATE TABLE {partition_name}
        PARTITION OF {table_name}
        FOR VALUES FROM ('{start_date.isoformat()}') TO ('{end_date.isoformat()}')
    """
    )

    try:
        await db.execute(create_query)
        await db.commit()

        logger.info(
            "partition_created",
            partition_name=partition_name,
            table_name=table_name,
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
        )

        return {
            "status": "created",
            "partition_name": partition_name,
            "table_name": table_name,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }

    except Exception as e:
        await db.rollback()
        logger.exception(
            "partition_creation_failed",
            partition_name=partition_name,
            table_name=table_name,
            error=str(e),
        )
        raise


async def create_weekly_partition(
    db: AsyncSession,
    table_name: PartitionTable,
    reference_date: datetime,
) -> dict[str, Any]:
    """
    Create a weekly partition for the specified table.

    Creates a partition for the week containing the reference date.
    Uses Monday as the start of the week (ISO 8601 standard).

    Args:
        db: Database session
        table_name: Name of the partitioned table
        reference_date: Any date within the target week

    Returns:
        Dict with partition creation status and details

    Example:
        >>> await create_weekly_partition(db, "automation_input_events", datetime(2025, 11, 21))
        {
            "status": "created",
            "partition_name": "automation_input_events_y2025_w47",
            "table_name": "automation_input_events",
            "start_date": "2025-11-17T00:00:00",
            "end_date": "2025-11-24T00:00:00"
        }
    """
    config = PARTITION_CONFIG[table_name]
    if config["granularity"] != "weekly":
        raise ValueError(f"Table {table_name} does not use weekly partitions")

    start_date, end_date = get_week_boundaries(reference_date)
    partition_name = format_partition_name(table_name, start_date, "weekly")

    # Check if partition already exists
    check_query = text(
        """
        SELECT EXISTS (
            SELECT 1 FROM pg_tables
            WHERE tablename = :partition_name
        )
    """
    )
    result = await db.execute(check_query, {"partition_name": partition_name})
    exists = result.scalar()

    if exists:
        logger.info(
            "partition_already_exists",
            partition_name=partition_name,
            table_name=table_name,
        )
        return {
            "status": "already_exists",
            "partition_name": partition_name,
            "table_name": table_name,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }

    # Create the partition
    create_query = text(
        f"""
        CREATE TABLE {partition_name}
        PARTITION OF {table_name}
        FOR VALUES FROM ('{start_date.isoformat()}') TO ('{end_date.isoformat()}')
    """
    )

    try:
        await db.execute(create_query)
        await db.commit()

        logger.info(
            "partition_created",
            partition_name=partition_name,
            table_name=table_name,
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
        )

        return {
            "status": "created",
            "partition_name": partition_name,
            "table_name": table_name,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        }

    except Exception as e:
        await db.rollback()
        logger.exception(
            "partition_creation_failed",
            partition_name=partition_name,
            table_name=table_name,
            error=str(e),
        )
        raise


async def list_partitions(
    db: AsyncSession, table_name: PartitionTable
) -> list[dict[str, Any]]:
    """
    List all existing partitions for a table.

    Queries the PostgreSQL catalog to find all child partitions.

    Args:
        db: Database session
        table_name: Name of the partitioned parent table

    Returns:
        List of partition details including name, start/end ranges, size

    Example:
        >>> await list_partitions(db, "automation_logs")
        [
            {
                "partition_name": "automation_logs_y2025_m11",
                "parent_table": "automation_logs",
                "partition_expression": "FOR VALUES FROM ('2025-11-01') TO ('2025-12-01')",
                "size_bytes": 1048576,
                "row_count": 15000
            }
        ]
    """
    query = text(
        """
        SELECT
            c.relname AS partition_name,
            pg_get_expr(c.relpartbound, c.oid) AS partition_expression,
            pg_total_relation_size(c.oid) AS size_bytes,
            c.reltuples::bigint AS row_count
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class parent ON i.inhparent = parent.oid
        WHERE parent.relname = :table_name
        AND c.relkind = 'r'
        ORDER BY c.relname
    """
    )

    result = await db.execute(query, {"table_name": table_name})
    partitions = []

    for row in result:
        partitions.append(
            {
                "partition_name": row.partition_name,
                "parent_table": table_name,
                "partition_expression": row.partition_expression,
                "size_bytes": row.size_bytes,
                "size_mb": round(row.size_bytes / (1024 * 1024), 2),
                "row_count": row.row_count,
            }
        )

    logger.info(
        "partitions_listed",
        table_name=table_name,
        partition_count=len(partitions),
    )

    return partitions


async def drop_partition(
    db: AsyncSession,
    partition_name: str,
    cascade: bool = False,
) -> dict[str, Any]:
    """
    Drop a specific partition.

    WARNING: This permanently deletes data. Use with caution.

    Args:
        db: Database session
        partition_name: Name of the partition to drop (must be valid identifier)
        cascade: Whether to cascade deletion to dependent objects

    Returns:
        Dict with deletion status and details

    Raises:
        ValueError: If partition_name contains invalid characters (SQL injection prevention)

    Example:
        >>> await drop_partition(db, "automation_logs_y2024_m01", cascade=False)
        {
            "status": "deleted",
            "partition_name": "automation_logs_y2024_m01",
            "rows_deleted": 12500
        }
    """
    # Validate partition name to prevent SQL injection
    safe_partition_name = _validate_identifier(partition_name)

    # Get row count before deletion
    count_query = text(f"SELECT COUNT(*) FROM {safe_partition_name}")
    try:
        result = await db.execute(count_query)
        row_count = result.scalar()
    except Exception:
        row_count = None

    # Drop the partition
    cascade_clause = "CASCADE" if cascade else ""
    drop_query = text(f"DROP TABLE {safe_partition_name} {cascade_clause}")

    try:
        await db.execute(drop_query)
        await db.commit()

        logger.warning(
            "partition_dropped",
            partition_name=safe_partition_name,
            rows_deleted=row_count,
            cascade=cascade,
        )

        return {
            "status": "deleted",
            "partition_name": safe_partition_name,
            "rows_deleted": row_count,
            "cascade": cascade,
        }

    except Exception as e:
        await db.rollback()
        logger.exception(
            "partition_drop_failed",
            partition_name=safe_partition_name,
            error=str(e),
        )
        raise


async def drop_old_partitions(
    db: AsyncSession,
    table_name: PartitionTable,
    dry_run: bool = True,
) -> dict[str, Any]:
    """
    Drop partitions older than the retention period for a table.

    Uses the retention policy defined in PARTITION_CONFIG.
    Performs a dry run by default to preview what would be deleted.

    Args:
        db: Database session
        table_name: Name of the partitioned table
        dry_run: If True, only simulates deletion without actually dropping

    Returns:
        Dict with cleanup summary and list of affected partitions

    Example:
        >>> await drop_old_partitions(db, "automation_logs", dry_run=True)
        {
            "status": "dry_run",
            "table_name": "automation_logs",
            "retention_months": 12,
            "partitions_to_delete": [
                {
                    "partition_name": "automation_logs_y2023_m11",
                    "age_months": 13,
                    "row_count": 8500
                }
            ],
            "total_rows_to_delete": 8500
        }
    """
    config = PARTITION_CONFIG[table_name]
    retention_months = config["retention_months"]
    granularity = config["granularity"]

    # Calculate cutoff date
    cutoff_date = datetime.utcnow() - timedelta(days=retention_months * 30)  # type: ignore[operator]

    logger.info(
        "drop_old_partitions_started",
        table_name=table_name,
        retention_months=retention_months,
        cutoff_date=cutoff_date.isoformat(),
        dry_run=dry_run,
    )

    # List all partitions
    partitions = await list_partitions(db, table_name)
    partitions_to_delete = []
    total_rows = 0

    for partition in partitions:
        # Parse partition name to extract date
        partition_name = partition["partition_name"]

        # Extract year and month/week from partition name
        # Format: {table}_y{year}_m{month} or {table}_y{year}_w{week}
        try:
            parts = partition_name.split("_")
            year_part = next(p for p in parts if p.startswith("y"))
            year = int(year_part[1:])

            if granularity == "monthly":
                month_part = next(p for p in parts if p.startswith("m"))
                month = int(month_part[1:])
                partition_date = datetime(year, month, 1)
            else:  # weekly
                week_part = next(p for p in parts if p.startswith("w"))
                week = int(week_part[1:])
                # Convert ISO week to date
                # Use January 4th which is always in week 1
                jan4 = datetime(year, 1, 4)
                partition_date = (
                    jan4 - timedelta(days=jan4.weekday()) + timedelta(weeks=week - 1)
                )

            # Check if partition is older than retention period
            if partition_date < cutoff_date:
                age_months = (datetime.utcnow().year - partition_date.year) * 12 + (
                    datetime.utcnow().month - partition_date.month
                )

                partitions_to_delete.append(
                    {
                        "partition_name": partition_name,
                        "partition_date": partition_date.isoformat(),
                        "age_months": age_months,
                        "row_count": partition["row_count"],
                        "size_mb": partition["size_mb"],
                    }
                )
                total_rows += partition["row_count"]

        except (StopIteration, ValueError, IndexError) as e:
            logger.warning(
                "partition_name_parse_failed",
                partition_name=partition_name,
                error=str(e),
            )
            continue

    # Execute deletions if not a dry run
    deleted_partitions = []
    if not dry_run and partitions_to_delete:
        for partition_info in partitions_to_delete:
            try:
                result = await drop_partition(db, partition_info["partition_name"])
                deleted_partitions.append(result)
            except Exception as e:
                logger.exception(
                    "partition_deletion_failed",
                    partition_name=partition_info["partition_name"],
                    error=str(e),
                )

    status = "dry_run" if dry_run else "completed"
    logger.info(
        "drop_old_partitions_completed",
        table_name=table_name,
        status=status,
        partitions_identified=len(partitions_to_delete),
        partitions_deleted=len(deleted_partitions),
        total_rows=total_rows,
    )

    return {
        "status": status,
        "table_name": table_name,
        "retention_months": retention_months,
        "cutoff_date": cutoff_date.isoformat(),
        "partitions_to_delete": partitions_to_delete,
        "partitions_deleted": deleted_partitions if not dry_run else [],
        "total_rows_to_delete": total_rows,
    }


# Export public API
__all__ = [
    "PARTITION_CONFIG",
    "create_monthly_partition",
    "create_weekly_partition",
    "list_partitions",
    "drop_partition",
    "drop_old_partitions",
    "get_month_boundaries",
    "get_week_boundaries",
    "format_partition_name",
]
