"""
Background task for cleaning up stale runner connections.

This task runs periodically to identify database connections marked as active
(disconnected_at IS NULL) but are no longer actually WebSocket-connected,
and marks them as disconnected.
"""

import asyncio
from datetime import datetime

import structlog
from sqlalchemy import select

from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.runner_connection import RunnerConnection
from app.services.runner_connection_manager import get_runner_connection_manager

logger = structlog.get_logger(__name__)


async def cleanup_stale_connections() -> dict[str, int]:
    """
    Clean up database connections that are marked active but not WebSocket-connected.

    This function:
    1. Queries all connections where disconnected_at IS NULL
    2. Checks if each connection_id is in the RunnerConnectionManager.runner_connections dict
    3. If NOT in memory but in DB as "active", marks it as disconnected with
       disconnected_at = now() and calculates duration_seconds

    Returns:
        Dictionary with cleanup statistics:
        - total_active: Total number of active connections in DB
        - stale_found: Number of stale connections found
        - cleaned: Number of connections successfully cleaned up
    """
    stats = {
        "total_active": 0,
        "stale_found": 0,
        "cleaned": 0,
    }

    try:
        # Get Redis client and runner connection manager
        redis_client = await get_redis()
        runner_manager = await get_runner_connection_manager(redis_client)

        # Get set of currently connected runner IDs across all processes (Redis-backed)
        connected_ids = set(await runner_manager.get_all_connected_runner_ids_redis())

        # Query database for active connections
        async with AsyncSessionLocal() as db:
            # Get all active connections (disconnected_at IS NULL)
            query = select(RunnerConnection).where(
                RunnerConnection.disconnected_at.is_(None)
            )
            result = await db.execute(query)
            active_connections = list(result.scalars().all())

            stats["total_active"] = len(active_connections)

            # Find stale connections (in DB but not in memory)
            stale_connections = [
                conn for conn in active_connections if conn.id not in connected_ids
            ]
            stats["stale_found"] = len(stale_connections)

            if stale_connections:
                logger.info(
                    "cleanup_stale_connections_found",
                    total_active=stats["total_active"],
                    stale_found=stats["stale_found"],
                    stale_ids=[conn.id for conn in stale_connections],
                )

                # Mark stale connections as disconnected
                # Use datetime.utcnow() (naive) to match the model's DateTime column
                now = datetime.utcnow()
                cleaned_connections = []

                for conn in stale_connections:
                    try:
                        conn.disconnected_at = now
                        conn.calculate_duration()
                        stats["cleaned"] += 1
                        cleaned_connections.append(conn)

                        logger.debug(
                            "stale_connection_cleaned",
                            connection_id=conn.id,
                            user_id=str(conn.user_id),
                            connected_at=conn.connected_at.isoformat(),
                            duration_seconds=conn.duration_seconds,
                        )
                    except Exception as e:
                        logger.error(
                            "stale_connection_cleanup_error",
                            connection_id=conn.id,
                            error=str(e),
                        )

                # Commit all changes
                await db.commit()

                # Send disconnect notifications to frontend for each cleaned connection
                for conn in cleaned_connections:
                    try:
                        await runner_manager.unregister_runner(conn.id, conn.user_id)
                    except Exception as e:
                        logger.error(
                            "stale_connection_notify_error",
                            connection_id=conn.id,
                            error=str(e),
                        )

                logger.info(
                    "cleanup_stale_connections_completed",
                    total_active=stats["total_active"],
                    stale_found=stats["stale_found"],
                    cleaned=stats["cleaned"],
                )
            else:
                logger.debug(
                    "cleanup_no_stale_connections",
                    total_active=stats["total_active"],
                )

    except Exception as e:
        logger.error(
            "cleanup_stale_connections_error",
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )

    return stats


async def run_cleanup_loop(interval_seconds: int = 60) -> None:
    """
    Background loop that periodically cleans up stale connections.

    This function runs indefinitely, executing cleanup_stale_connections()
    every interval_seconds. It's designed to be run as an asyncio task.

    Args:
        interval_seconds: Time between cleanup runs (default: 60)
    """
    logger.info(
        "cleanup_loop_started",
        interval_seconds=interval_seconds,
    )

    while True:
        try:
            stats = await cleanup_stale_connections()

            # Only log if we found stale connections
            if stats["stale_found"] > 0:
                logger.info(
                    "cleanup_loop_cycle_completed",
                    stats=stats,
                )
        except Exception as e:
            logger.error(
                "cleanup_loop_error",
                error=str(e),
                error_type=type(e).__name__,
            )

        # Wait before next cleanup cycle
        await asyncio.sleep(interval_seconds)
