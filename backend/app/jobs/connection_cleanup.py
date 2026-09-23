"""Scheduled job — clean up stale device connections.

Runs on the scheduler's ``connection_cleanup`` cadence (every 60s) to
identify ``DeviceConnection`` rows marked active (``disconnected_at IS
NULL``) whose ``Device`` parent has no live WebSocket (per the in-process +
Redis registry). It closes the connection row, clears the parent
``ws_session_id`` pointer, and notifies the manager.

SECONDARY runner-instance rows (``instance_role = 'secondary'``, plan
``2026-09-20-runner-selector-drives-a-transport-not-a-target`` Phase 6) are
judged differently. A secondary never registers with the manager — the
manager is keyed on ``device_id`` and belongs to the primary — so "is the
device in the manager's registry" says nothing about it: it would close a live
secondary whenever its primary is away, and keep a dead one open whenever its
primary is present. A secondary row is stale when its own heartbeat stamp
(``COALESCE(last_seen_at, connected_at)``) is older than
``SECONDARY_STALE_AFTER``, and closing one touches neither the pointer (a
secondary never holds it) nor the manager (it would unregister the primary).
"""

from uuid import UUID

import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy import Integer, func, select, update

from app.config.redis_config import get_redis
from app.crud import device_crud
from app.crud.device_connection import INSTANCE_ROLE_SECONDARY, SECONDARY_STALE_AFTER
from app.db.session import AsyncSessionLocal
from app.models.device_connection import DeviceConnection
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)


async def cleanup_stale_connections() -> dict[str, int]:
    """
    Close ``DeviceConnection`` rows whose device is no longer connected.

    Returns:
        Dictionary with cleanup statistics:
        - total_active: Total number of active connections in DB
        - stale_found: Number of stale connections found
        - cleaned: Number of connections successfully cleaned up
    """
    stats = {"total_active": 0, "stale_found": 0, "cleaned": 0}

    try:
        redis_client = await get_redis()
        runner_manager = await get_runner_websocket_manager(redis_client)

        scanned = await runner_manager.get_all_connected_ids()
        # ``None`` is a FAILED scan, not an empty fleet. The primary arm below
        # closes every row whose device is absent from the set, so running it
        # on a failed scan would close every live primary's row and force a
        # fleet-wide reconnect. Skip that arm; the secondary arm needs no scan.
        scan_failed = scanned is None
        connected_ids = set(scanned or [])
        if scan_failed:
            logger.warning("cleanup_primary_arm_skipped_presence_scan_failed")

        async with AsyncSessionLocal() as db:
            query = select(DeviceConnection).where(
                DeviceConnection.disconnected_at.is_(None)
            )
            result = await db.execute(query)
            active_sessions = list(result.scalars().all())

            stats["total_active"] = len(active_sessions)

            secondary_cutoff = utc_now() - SECONDARY_STALE_AFTER
            stale_secondaries = [
                s
                for s in active_sessions
                if s.instance_role == INSTANCE_ROLE_SECONDARY
                and (s.last_seen_at or s.connected_at) < secondary_cutoff
            ]
            stale_sessions = [
                s
                for s in active_sessions
                if not scan_failed
                and s.instance_role != INSTANCE_ROLE_SECONDARY
                and str(s.device_id) not in connected_ids
            ]
            stats["stale_found"] = len(stale_sessions) + len(stale_secondaries)

            if stale_secondaries:
                # The staleness test is repeated INSIDE the UPDATE: a
                # heartbeat that stamped last_seen_at after the read above
                # must win, or a live secondary loses its row to a decision
                # made from data that is no longer true.
                result = await db.execute(
                    update(DeviceConnection)
                    .where(
                        DeviceConnection.id.in_([s.id for s in stale_secondaries]),
                        DeviceConnection.disconnected_at.is_(None),
                        func.coalesce(
                            DeviceConnection.last_seen_at,
                            DeviceConnection.connected_at,
                        )
                        < secondary_cutoff,
                    )
                    .values(
                        disconnected_at=func.now(),
                        duration_seconds=func.extract(
                            "epoch", func.now() - DeviceConnection.connected_at
                        ).cast(Integer),
                    )
                    .returning(DeviceConnection.id)
                    .execution_options(synchronize_session=False)
                )
                closed_ids = [row[0] for row in result.all()]
                await db.commit()
                stats["cleaned"] += len(closed_ids)
                logger.info(
                    "cleanup_stale_secondary_instances_closed",
                    connection_pks=closed_ids,
                )

            if stale_sessions:
                logger.info(
                    "cleanup_stale_sessions_found",
                    total_active=stats["total_active"],
                    stale_found=stats["stale_found"],
                )

                now = utc_now()
                cleaned_device_ids: list[str] = []
                for session in stale_sessions:
                    try:
                        session.disconnected_at = now
                        session.calculate_duration()
                        stats["cleaned"] += 1
                        cleaned_device_ids.append(str(session.device_id))
                    except Exception as e:
                        logger.error(
                            "stale_session_cleanup_error",
                            session_pk=session.id,
                            error=str(e),
                        )

                # Clear ws_session_id on parent devices whose connection was
                # just closed — but ONLY where it still points at one of the
                # sessions this pass declared stale.
                #
                # This used to be a read-modify-write in Python (SELECT →
                # compare → assign → commit), the same lost-update pattern
                # that broke the teardown path, and with a WIDER stale window:
                # `connected_ids` is read from Redis at the top of this
                # function, well before this commit lands. A device that
                # reconnects anywhere in that window had its brand-new pointer
                # NULLed by a decision made from data that was already old,
                # and — until the heartbeat heal existed — nothing could undo
                # it. Delegate to the atomic compare-and-clear so the database
                # arbitrates instead.
                await db.commit()

                stale_ids_by_device: dict[str, list[int]] = {}
                for session in stale_sessions:
                    stale_ids_by_device.setdefault(str(session.device_id), []).append(
                        session.id
                    )
                for did, stale_ids in stale_ids_by_device.items():
                    for stale_id in stale_ids:
                        await device_crud.clear_ws_session_if_current(
                            db, device_id=UUID(did), connection_pk=stale_id
                        )

                # Notify the manager (best-effort) for each cleaned device.
                for did in set(cleaned_device_ids):
                    try:
                        await runner_manager.unregister(did)
                    except Exception as e:
                        logger.error(
                            "stale_session_notify_error",
                            device_id=did,
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
        # Re-raise: the scheduler records `last_status="failed"` on /health and
        # keeps looping. Swallowing here (needed by the old `while True` loop, which
        # would have died) would make every failed run report `"ok"` — the exact
        # silent-no-op blindness this scheduler exists to end.
        raise

    return stats
