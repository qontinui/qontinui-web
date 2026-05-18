"""CRUD operations for the device connections audit log.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
replaces the previous ``runner_session`` CRUD. The renamed table is
``coord.device_connections`` (NOT ``coord.device_sessions``, to avoid
colliding with the existing user-fingerprinting
``auth.device_sessions`` table).
"""

from uuid import UUID

from qontinui_schemas.common import utc_now
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_connection import DeviceConnection

__all__ = [
    "create_connection_record",
    "close_connection_record",
    "get_connection_history",
    "get_active_connections",
    "get_active_connection_for_project",
    "close_orphaned_connections",
    "get_connection_by_session_id",
]


async def create_connection_record(
    db: AsyncSession,
    *,
    device_id: UUID,
    user_id: UUID,
    ip_address: str | None = None,
    project_id: UUID | None = None,
    session_id: str | None = None,
) -> DeviceConnection:
    """Log the start of a device WebSocket connection."""
    record = DeviceConnection(
        device_id=device_id,
        user_id=user_id,
        ip_address=ip_address,
        project_id=project_id,
        session_id=session_id,
    )

    db.add(record)
    await db.commit()
    await db.refresh(record)

    return record


async def close_connection_record(
    db: AsyncSession,
    connection_pk: int,
) -> DeviceConnection | None:
    """Log the end of a device WebSocket connection."""
    query = select(DeviceConnection).where(DeviceConnection.id == connection_pk)
    result = await db.execute(query)
    record = result.scalar_one_or_none()

    if not record:
        return None

    record.disconnected_at = utc_now()
    record.calculate_duration()

    await db.commit()
    await db.refresh(record)

    return record


async def get_connection_history(
    db: AsyncSession,
    user_id: UUID,
    *,
    device_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[DeviceConnection], int]:
    """Return paginated connection history for a user, newest first."""
    conditions = [DeviceConnection.user_id == user_id]
    if device_id is not None:
        conditions.append(DeviceConnection.device_id == device_id)

    where_clause = and_(*conditions)

    count_query = select(func.count(DeviceConnection.id)).where(where_clause)
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    query = (
        select(DeviceConnection)
        .where(where_clause)
        .order_by(DeviceConnection.connected_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    connections = list(result.scalars().all())

    return connections, total


async def get_active_connections(
    db: AsyncSession,
    user_id: UUID,
) -> list[DeviceConnection]:
    """Return currently-open connections for a user, newest first."""
    query = (
        select(DeviceConnection)
        .where(
            and_(
                DeviceConnection.user_id == user_id,
                DeviceConnection.disconnected_at.is_(None),
            )
        )
        .order_by(DeviceConnection.connected_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_active_connection_for_project(
    db: AsyncSession,
    project_id: UUID,
) -> DeviceConnection | None:
    """Return the currently-open connection for a specific project, if any."""
    query = (
        select(DeviceConnection)
        .where(
            and_(
                DeviceConnection.project_id == project_id,
                DeviceConnection.disconnected_at.is_(None),
            )
        )
        .order_by(DeviceConnection.connected_at.desc())
    )
    result = await db.execute(query)
    return result.scalars().first()


async def close_orphaned_connections(
    db: AsyncSession,
    user_id: UUID,
    exclude_connection_id: int | None = None,
) -> list[int]:
    """Close any orphaned (still-open) connections for a user."""
    conditions = [
        DeviceConnection.user_id == user_id,
        DeviceConnection.disconnected_at.is_(None),
    ]

    if exclude_connection_id is not None:
        conditions.append(DeviceConnection.id != exclude_connection_id)

    query = select(DeviceConnection).where(and_(*conditions))
    result = await db.execute(query)
    orphaned = list(result.scalars().all())

    closed_ids: list[int] = []
    for record in orphaned:
        record.disconnected_at = utc_now()
        record.calculate_duration()
        closed_ids.append(record.id)

    if closed_ids:
        await db.commit()

    return closed_ids


async def get_connection_by_session_id(
    db: AsyncSession,
    session_id: str,
) -> DeviceConnection | None:
    """Look up a connection by its WebSocket session_id correlation string."""
    query = select(DeviceConnection).where(DeviceConnection.session_id == session_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()
