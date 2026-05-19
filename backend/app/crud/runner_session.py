"""Legacy compat shim — wrappers around :mod:`app.crud.device_connection`.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
renamed ``RunnerSession`` → ``DeviceConnection`` and moved the table
to ``coord.device_connections``. This shim adapts the legacy call
shape — ``runner_id=`` / ``session_pk=`` — to the new
``device_id=`` / ``connection_pk=`` signature so the broader fleet
of consumers (``websockets/testing/handler.py`` etc.) compiles while
the rename propagates.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import device_connection as _dev_conn

# Legacy fleet CRUD helpers (Runner registration) are re-exported via
# wrapper functions from the runner_crud shim.
from app.crud.runner_crud import (
    delete_runner,
    get_runner,
    heartbeat_runner,
    list_runners,
    register_runner,
)
from app.models.device_connection import DeviceConnection

__all__ = [
    # Re-exported from runner_crud (which wraps device_crud)
    "register_runner",
    "heartbeat_runner",
    "list_runners",
    "get_runner",
    "delete_runner",
    # Session history CRUD (re-exported with legacy names)
    "create_session_record",
    "close_session_record",
    "get_session_history",
    "get_active_sessions",
    "get_active_session_for_project",
    "close_orphaned_sessions",
    "get_session_by_session_id",
]


async def create_session_record(
    db: AsyncSession,
    *,
    runner_id: UUID,
    user_id: UUID,
    ip_address: str | None = None,
    project_id: UUID | None = None,
    session_id: str | None = None,
) -> DeviceConnection:
    """Legacy adapter for :func:`device_connection.create_connection_record`
    (renames ``runner_id`` → ``device_id``)."""
    return await _dev_conn.create_connection_record(
        db,
        device_id=runner_id,
        user_id=user_id,
        ip_address=ip_address,
        project_id=project_id,
        session_id=session_id,
    )


async def close_session_record(
    db: AsyncSession,
    session_pk: int,
) -> DeviceConnection | None:
    """Legacy adapter for :func:`device_connection.close_connection_record`
    (renames ``session_pk`` → ``connection_pk``)."""
    return await _dev_conn.close_connection_record(db, connection_pk=session_pk)


# These do not have a renamed keyword in their public surface, so a
# straight re-export under the legacy name is fine.
get_session_history = _dev_conn.get_connection_history
get_active_sessions = _dev_conn.get_active_connections
get_active_session_for_project = _dev_conn.get_active_connection_for_project
close_orphaned_sessions = _dev_conn.close_orphaned_connections
get_session_by_session_id = _dev_conn.get_connection_by_session_id
