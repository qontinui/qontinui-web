"""
Background task for cleaning up stale runner sessions.

This task runs periodically to identify ``RunnerSession`` rows marked as
active (``disconnected_at IS NULL``) whose ``Runner`` parent has no live
WebSocket (per the in-process+Redis registry). It closes the session
row, clears the parent ``ws_session_id`` pointer, and notifies the
manager.
"""

import asyncio

import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy import select

from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.runner import Runner
from app.models.runner_session import RunnerSession
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)


async def cleanup_stale_connections() -> dict[str, int]:
    """
    Close ``RunnerSession`` rows whose runner is no longer connected.

    Returns:
        Dictionary with cleanup statistics:
        - total_active: Total number of active sessions in DB
        - stale_found: Number of stale sessions found
        - cleaned: Number of sessions successfully cleaned up
    """
    stats = {"total_active": 0, "stale_found": 0, "cleaned": 0}

    try:
        redis_client = await get_redis()
        runner_manager = await get_runner_websocket_manager(redis_client)

        connected_ids = set(await runner_manager.get_all_connected_ids())

        async with AsyncSessionLocal() as db:
            query = select(RunnerSession).where(RunnerSession.disconnected_at.is_(None))
            result = await db.execute(query)
            active_sessions = list(result.scalars().all())

            stats["total_active"] = len(active_sessions)

            stale_sessions = [
                s for s in active_sessions if str(s.runner_id) not in connected_ids
            ]
            stats["stale_found"] = len(stale_sessions)

            if stale_sessions:
                logger.info(
                    "cleanup_stale_sessions_found",
                    total_active=stats["total_active"],
                    stale_found=stats["stale_found"],
                )

                now = utc_now()
                cleaned_runner_ids: list[str] = []
                for session in stale_sessions:
                    try:
                        session.disconnected_at = now
                        session.calculate_duration()
                        stats["cleaned"] += 1
                        cleaned_runner_ids.append(str(session.runner_id))
                    except Exception as e:
                        logger.error(
                            "stale_session_cleanup_error",
                            session_pk=session.id,
                            error=str(e),
                        )

                # Clear ws_session_id on parent runners whose session was just
                # closed.
                for rid in set(cleaned_runner_ids):
                    runner_query = select(Runner).where(Runner.id == rid)
                    runner_result = await db.execute(runner_query)
                    runner = runner_result.scalar_one_or_none()
                    if (
                        runner is not None
                        and str(runner.ws_session_id or "")
                        and (runner.ws_session_id in {s.id for s in stale_sessions})
                    ):
                        runner.ws_session_id = None
                        runner.ws_connected_at = None

                await db.commit()

                # Notify the manager (best-effort) for each cleaned runner.
                for rid in set(cleaned_runner_ids):
                    try:
                        await runner_manager.unregister(rid)
                    except Exception as e:
                        logger.error(
                            "stale_session_notify_error",
                            runner_id=rid,
                            error=str(e),
                        )

                logger.info(
                    "cleanup_stale_sessions_completed",
                    total_active=stats["total_active"],
                    stale_found=stats["stale_found"],
                    cleaned=stats["cleaned"],
                )
            else:
                logger.debug(
                    "cleanup_no_stale_sessions",
                    total_active=stats["total_active"],
                )

    except Exception as e:
        logger.error(
            "cleanup_stale_sessions_error",
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )

    return stats


async def run_cleanup_loop(interval_seconds: int = 60) -> None:
    """Background loop that periodically cleans up stale sessions."""
    logger.info("cleanup_loop_started", interval_seconds=interval_seconds)

    while True:
        try:
            stats = await cleanup_stale_connections()
            if stats["stale_found"] > 0:
                logger.info("cleanup_loop_cycle_completed", stats=stats)
        except Exception as e:
            logger.error(
                "cleanup_loop_error",
                error=str(e),
                error_type=type(e).__name__,
            )
        await asyncio.sleep(interval_seconds)
