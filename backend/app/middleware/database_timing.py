"""
Database query timing middleware using SQLAlchemy event listeners.

This module provides comprehensive query performance monitoring:
- Tracks query execution time
- Logs slow queries (configurable threshold)
- Counts queries per request
- Warns about N+1 query problems
- Provides query statistics

Usage:
    from app.middleware.database_timing import init_database_timing

    # In app startup:
    init_database_timing(async_engine, sync_engine)
"""

import time
from collections.abc import Callable
from contextlib import contextmanager
from typing import Any

import structlog
from app.core.config import settings
from fastapi import Request, Response
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.middleware.base import BaseHTTPMiddleware

logger = structlog.get_logger(__name__)


class QueryStats:
    """Container for tracking query statistics during a request."""

    def __init__(self):
        self.query_count = 0
        self.total_time = 0.0
        self.slow_queries = []
        self.queries = []

    def add_query(self, duration: float, statement: str, parameters: Any = None):
        """Record a query execution."""
        self.query_count += 1
        self.total_time += duration

        query_info = {
            "duration_ms": round(duration * 1000, 2),
            "statement": statement[:200],  # Truncate long queries
        }

        self.queries.append(query_info)

        # Track slow queries separately
        if duration * 1000 > settings.SLOW_QUERY_THRESHOLD_MS:
            query_info["parameters"] = str(parameters)[:100] if parameters else None
            self.slow_queries.append(query_info)

    def get_summary(self) -> dict:
        """Get statistics summary."""
        return {
            "query_count": self.query_count,
            "total_time_ms": round(self.total_time * 1000, 2),
            "avg_time_ms": (
                round((self.total_time / self.query_count) * 1000, 2)
                if self.query_count > 0
                else 0
            ),
            "slow_query_count": len(self.slow_queries),
        }


# Request-local storage for query stats
_request_query_stats: dict[str, QueryStats] = {}


@contextmanager
def track_request_queries(request_id: str):
    """Context manager to track queries for a specific request."""
    stats = QueryStats()
    _request_query_stats[request_id] = stats
    try:
        yield stats
    finally:
        _request_query_stats.pop(request_id, None)


def get_current_query_stats() -> QueryStats | None:
    """Get query stats for the current request (if any)."""
    # Try to find stats for the current request
    # This works because we store by request_id
    if _request_query_stats:
        # Return the most recently created stats
        return next(iter(_request_query_stats.values()), None)
    return None


# Event listeners for sync engine (used by Alembic and init_db)
@event.listens_for(Engine, "before_cursor_execute")
def before_cursor_execute_sync(
    conn, cursor, statement, parameters, context, executemany
):
    """Track query start time for sync engine."""
    conn.info.setdefault("query_start_time", []).append(time.time())


@event.listens_for(Engine, "after_cursor_execute")
def after_cursor_execute_sync(
    conn, cursor, statement, parameters, context, executemany
):
    """Track query completion for sync engine."""
    if "query_start_time" not in conn.info or not conn.info["query_start_time"]:
        return

    duration = time.time() - conn.info["query_start_time"].pop()

    # Only log if query logging is enabled
    if not settings.ENABLE_QUERY_LOGGING:
        return

    # Get current request stats (if in request context)
    stats = get_current_query_stats()
    if stats:
        stats.add_query(duration, statement, parameters)

    # Log slow queries
    duration_ms = duration * 1000
    if duration_ms > settings.SLOW_QUERY_THRESHOLD_MS:
        logger.warning(
            "slow_query_sync",
            duration_ms=round(duration_ms, 2),
            statement=statement[:200],
            parameters=str(parameters)[:100] if parameters else None,
            threshold_ms=settings.SLOW_QUERY_THRESHOLD_MS,
        )


# Event listeners (will be registered via init_database_timing)
def before_cursor_execute_handler(
    conn, cursor, statement, parameters, context, executemany
):
    """Track query start time."""
    conn.info.setdefault("query_start_time", []).append(time.time())


def after_cursor_execute_handler(
    conn, cursor, statement, parameters, context, executemany
):
    """Track query completion."""
    if "query_start_time" not in conn.info or not conn.info["query_start_time"]:
        return

    duration = time.time() - conn.info["query_start_time"].pop()

    # Only log if query logging is enabled
    if not settings.ENABLE_QUERY_LOGGING:
        return

    # Get current request stats (if in request context)
    stats = get_current_query_stats()
    if stats:
        stats.add_query(duration, statement, parameters)

    # Log slow queries
    duration_ms = duration * 1000
    if duration_ms > settings.SLOW_QUERY_THRESHOLD_MS:
        logger.warning(
            "slow_query_async",
            duration_ms=round(duration_ms, 2),
            statement=statement[:200],
            parameters=str(parameters)[:100] if parameters else None,
            threshold_ms=settings.SLOW_QUERY_THRESHOLD_MS,
        )


class DatabaseTimingMiddleware(BaseHTTPMiddleware):
    """
    Middleware to track database query statistics per request.

    Tracks:
    - Query count per request
    - Total query time
    - Slow queries
    - N+1 query warnings
    """

    EXCLUDED_PATHS = [
        "/health",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/favicon.ico",
        "/",
    ]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and track database queries."""
        # Skip tracking for excluded paths
        if any(request.url.path.startswith(path) for path in self.EXCLUDED_PATHS):
            response: Response = await call_next(request)
            return response

        # Get or generate request ID
        request_id = request.headers.get("X-Request-ID", str(id(request)))

        # Track queries for this request
        with track_request_queries(request_id):
            stats = get_current_query_stats()

            # Process the request
            response = await call_next(request)

            # Log query statistics if enabled
            if stats and settings.ENABLE_QUERY_LOGGING:
                summary = stats.get_summary()

                # Log summary
                logger.info(
                    "request_query_stats",
                    request_id=request_id,
                    path=request.url.path,
                    method=request.method,
                    **summary,
                )

                # Warn if too many queries
                if stats.query_count > settings.MAX_QUERIES_PER_REQUEST:
                    logger.warning(
                        "excessive_queries",
                        request_id=request_id,
                        path=request.url.path,
                        query_count=stats.query_count,
                        max_allowed=settings.MAX_QUERIES_PER_REQUEST,
                        message="Possible N+1 query problem",
                    )

                # Log slow queries
                if stats.slow_queries:
                    for slow_query in stats.slow_queries:
                        logger.warning(
                            "slow_query_in_request",
                            request_id=request_id,
                            path=request.url.path,
                            **slow_query,
                        )

                # Add query stats to response headers (for debugging)
                if settings.ENVIRONMENT == "development":
                    response.headers["X-Query-Count"] = str(stats.query_count)
                    response.headers["X-Query-Time-Ms"] = str(
                        round(stats.total_time * 1000, 2)
                    )

            return response


def init_database_timing(async_engine: AsyncEngine, sync_engine: Engine | None = None):
    """
    Initialize database query timing.

    This function should be called during application startup to attach
    event listeners to both async and sync database engines.

    Args:
        async_engine: AsyncEngine instance for async queries
        sync_engine: Engine instance for sync queries (Alembic, init_db)
    """
    # Register event listeners on the sync engine from async_engine
    if async_engine:
        sync_engine_from_async = async_engine.sync_engine
        event.listen(
            sync_engine_from_async,
            "before_cursor_execute",
            before_cursor_execute_handler,
        )
        event.listen(
            sync_engine_from_async, "after_cursor_execute", after_cursor_execute_handler
        )
        logger.info("database_timing_listeners_registered", engine_type="async")

    # Also register on sync engine if provided
    if sync_engine:
        event.listen(
            sync_engine, "before_cursor_execute", before_cursor_execute_handler
        )
        event.listen(sync_engine, "after_cursor_execute", after_cursor_execute_handler)
        logger.info("database_timing_listeners_registered", engine_type="sync")

    logger.info(
        "database_timing_initialized",
        slow_query_threshold_ms=settings.SLOW_QUERY_THRESHOLD_MS,
        query_logging_enabled=settings.ENABLE_QUERY_LOGGING,
        max_queries_per_request=settings.MAX_QUERIES_PER_REQUEST,
    )

    if settings.ENABLE_QUERY_LOGGING:
        logger.info("database_query_logging_enabled")
    else:
        logger.info(
            "database_query_logging_disabled",
            note="Set ENABLE_QUERY_LOGGING=true to enable",
        )
