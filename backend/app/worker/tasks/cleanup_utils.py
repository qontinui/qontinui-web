"""Shared utilities for cleanup tasks."""

import io
import time
from datetime import datetime
from typing import Any

import pandas as pd  # type: ignore[import-untyped]
import structlog
from qontinui_schemas.common import utc_now

logger = structlog.get_logger(__name__)

# Type for generic cleanup result
CleanupResult = dict[str, Any]


def create_success_result(
    task_name: str,
    execution_time: float,
    **extra_fields: Any,
) -> CleanupResult:
    """Create a standardized success result dictionary.

    Args:
        task_name: Name of the cleanup task
        execution_time: Time taken to execute in seconds
        **extra_fields: Additional fields to include in the result

    Returns:
        Standardized result dictionary
    """
    result: CleanupResult = {
        "status": "success",
        "task": task_name,
        "execution_time_seconds": round(execution_time, 2),
        "timestamp": utc_now().isoformat(),
    }
    result.update(extra_fields)
    return result


def create_error_result(
    task_name: str,
    error: Exception,
    execution_time: float,
    **extra_fields: Any,
) -> CleanupResult:
    """Create a standardized error result dictionary.

    Args:
        task_name: Name of the cleanup task
        error: The exception that occurred
        execution_time: Time taken before failure in seconds
        **extra_fields: Additional fields to include in the result

    Returns:
        Standardized error result dictionary
    """
    result: CleanupResult = {
        "status": "error",
        "task": task_name,
        "error": str(error),
        "execution_time_seconds": round(execution_time, 2),
        "timestamp": utc_now().isoformat(),
    }
    result.update(extra_fields)
    return result


def create_partial_success_result(
    task_name: str,
    execution_time: float,
    **extra_fields: Any,
) -> CleanupResult:
    """Create a standardized partial success result dictionary.

    Args:
        task_name: Name of the cleanup task
        execution_time: Time taken to execute in seconds
        **extra_fields: Additional fields to include in the result

    Returns:
        Standardized result dictionary with partial_success status
    """
    result: CleanupResult = {
        "status": "partial_success",
        "task": task_name,
        "execution_time_seconds": round(execution_time, 2),
        "timestamp": utc_now().isoformat(),
    }
    result.update(extra_fields)
    return result


class TaskTimer:
    """Context manager for timing task execution.

    Usage:
        with TaskTimer() as timer:
            # do work
        print(timer.elapsed)
    """

    def __init__(self) -> None:
        self.start_time: float = 0.0
        self.end_time: float = 0.0

    def __enter__(self) -> "TaskTimer":
        self.start_time = time.time()
        return self

    def __exit__(self, *args: Any) -> None:
        self.end_time = time.time()

    @property
    def elapsed(self) -> float:
        """Return elapsed time in seconds."""
        if self.end_time > 0:
            return self.end_time - self.start_time
        return time.time() - self.start_time


def dataframe_to_parquet_buffer(df: pd.DataFrame) -> io.BytesIO:
    """Convert a DataFrame to a Parquet buffer.

    Args:
        df: The DataFrame to convert

    Returns:
        BytesIO buffer containing the Parquet data
    """
    parquet_buffer = io.BytesIO()
    df.to_parquet(
        parquet_buffer,
        engine="pyarrow",
        compression="snappy",
        index=False,
    )
    parquet_buffer.seek(0)
    return parquet_buffer


def generate_archive_s3_keys(
    archive_type: str,
    data_types: list[str],
    archive_date: datetime | None = None,
) -> dict[str, str]:
    """Generate S3 keys for archive files with date-based partitioning.

    Args:
        archive_type: Type of archive (e.g., 'automation', 'analytics')
        data_types: List of data type names to generate keys for
        archive_date: Date to use for partitioning (defaults to now)

    Returns:
        Dictionary mapping data types to S3 keys
    """
    if archive_date is None:
        archive_date = utc_now()

    year = archive_date.strftime("%Y")
    month = archive_date.strftime("%m")
    date_str = archive_date.strftime("%Y%m%d")

    return {
        data_type: f"archives/{archive_type}/{year}/{month}/{data_type}_{date_str}.parquet"
        for data_type in data_types
    }


def upload_dataframes_to_s3(
    dataframes: dict[str, pd.DataFrame],
    s3_keys: dict[str, str],
    archive_date: datetime,
    cutoff_date: datetime,
    max_retries: int = 3,
    skip_empty_except: list[str] | None = None,
) -> tuple[dict[str, Any], int]:
    """Upload multiple DataFrames to S3 as Parquet files with retry logic.

    Args:
        dataframes: Dictionary mapping data type names to DataFrames
        s3_keys: Dictionary mapping data type names to S3 keys
        archive_date: Date of archival for metadata
        cutoff_date: Cutoff date for metadata
        max_retries: Maximum number of upload attempts per file
        skip_empty_except: Data types to NOT skip even if empty (e.g., ['sessions'])

    Returns:
        Tuple of (upload_results dict, failed_uploads count)
    """
    from app.services.object_storage import object_storage

    if skip_empty_except is None:
        skip_empty_except = []

    upload_results: dict[str, Any] = {}
    failed_uploads = 0

    for data_type, s3_key in s3_keys.items():
        df = dataframes.get(data_type, pd.DataFrame())

        if df.empty and data_type not in skip_empty_except:
            logger.info(f"skipping_empty_{data_type}_archive")
            continue

        # Convert to Parquet
        parquet_buffer = dataframe_to_parquet_buffer(df)

        # Upload with retry
        for attempt in range(max_retries):
            try:
                object_storage.backend.upload_file(
                    file_obj=parquet_buffer,
                    key=s3_key,
                    content_type="application/octet-stream",
                    metadata={
                        "data_type": data_type,
                        "archive_date": archive_date.isoformat(),
                        "record_count": str(len(df)),
                        "cutoff_date": cutoff_date.isoformat(),
                    },
                )
                upload_results[data_type] = {
                    "success": True,
                    "s3_key": s3_key,
                    "record_count": len(df),
                }
                logger.info(
                    f"{data_type}_archived_to_s3",
                    s3_key=s3_key,
                    record_count=len(df),
                    attempt=attempt + 1,
                )
                break
            except Exception as e:
                logger.warning(
                    f"{data_type}_upload_retry",
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    error=str(e),
                )
                if attempt == max_retries - 1:
                    logger.error(
                        f"{data_type}_upload_failed",
                        s3_key=s3_key,
                        error=str(e),
                        error_type=type(e).__name__,
                    )
                    failed_uploads += 1
                    upload_results[data_type] = {
                        "success": False,
                        "error": str(e),
                    }
                parquet_buffer.seek(0)  # Reset buffer for retry

    return upload_results, failed_uploads


# Export all utilities
__all__ = [
    "CleanupResult",
    "create_success_result",
    "create_error_result",
    "create_partial_success_result",
    "TaskTimer",
    "dataframe_to_parquet_buffer",
    "generate_archive_s3_keys",
    "upload_dataframes_to_s3",
    "logger",
]
