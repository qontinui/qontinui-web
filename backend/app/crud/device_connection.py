"""CRUD operations for the device connections audit log.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
replaces the previous ``runner_session`` CRUD. The renamed table is
``coord.device_connections`` (NOT ``coord.device_sessions``, to avoid
colliding with the existing user-fingerprinting
``auth.device_sessions`` table).
"""

from collections.abc import Iterable, Sequence
from datetime import timedelta
from uuid import UUID

from qontinui_schemas.common import utc_now
from sqlalchemy import and_, func, or_, select, update
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
    "INSTANCE_ROLE_PRIMARY",
    "INSTANCE_ROLE_SECONDARY",
    "SECONDARY_STALE_AFTER",
    "get_open_connections_with_key",
    "close_connection_records",
    "touch_connection",
    "list_live_instance_rows",
]

INSTANCE_ROLE_PRIMARY = "primary"
INSTANCE_ROLE_SECONDARY = "secondary"

# Every socket stamps ``last_seen_at`` on every heartbeat (~30s). An open
# secondary row not stamped for this long is treated as dead: the
# ``connection_cleanup`` sweep closes it and ``Runner.instances`` omits it.
# Four heartbeat intervals — long enough that one delayed heartbeat never
# flickers an instance out of the list, short enough that a crash-orphaned
# temp runner leaves it within two minutes.
SECONDARY_STALE_AFTER = timedelta(seconds=120)


async def create_connection_record(
    db: AsyncSession,
    *,
    device_id: UUID,
    user_id: UUID,
    ip_address: str | None = None,
    project_id: UUID | None = None,
    session_id: str | None = None,
    instance_key: str | None = None,
    instance_role: str | None = None,
    port: int | None = None,
) -> DeviceConnection:
    """Log the start of a device WebSocket connection.

    ``instance_key`` / ``instance_role`` / ``port`` identify WHICH runner
    instance on the machine this socket is (every instance shares the
    machine's ``device_id``). Raises ``IntegrityError`` when another OPEN row
    on the same device already holds ``instance_key`` — the partial unique
    index ``uq_device_connections_live_instance_key`` — which the WS handshake
    treats as a duplicate-instance conflict.
    """
    record = DeviceConnection(
        device_id=device_id,
        user_id=user_id,
        ip_address=ip_address,
        project_id=project_id,
        session_id=session_id,
        instance_key=instance_key,
        instance_role=instance_role,
        port=port,
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
    if record.disconnected_at is not None:
        # Already closed (a supersede or the sweep got there first): its
        # close time is the real one and must not be rewritten.
        return record

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


async def get_open_connections_with_key(
    db: AsyncSession,
    *,
    device_id: UUID,
    instance_key: str,
) -> list[DeviceConnection]:
    """Open (``disconnected_at IS NULL``) rows on ``device_id`` holding ``instance_key``."""
    query = (
        select(DeviceConnection)
        .where(
            DeviceConnection.device_id == device_id,
            DeviceConnection.instance_key == instance_key,
            DeviceConnection.disconnected_at.is_(None),
        )
        .order_by(DeviceConnection.id)
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def close_connection_records(
    db: AsyncSession,
    connection_pks: Iterable[int],
) -> list[int]:
    """Close every still-open row in ``connection_pks``; return the ids closed.

    Rows already closed are left untouched (their ``disconnected_at`` is the
    real close time and must not be rewritten).
    """
    pks = list(connection_pks)
    if not pks:
        return []
    query = select(DeviceConnection).where(
        DeviceConnection.id.in_(pks),
        DeviceConnection.disconnected_at.is_(None),
    )
    result = await db.execute(query)
    closed: list[int] = []
    now = utc_now()
    for record in result.scalars().all():
        record.disconnected_at = now
        record.calculate_duration()
        closed.append(record.id)
    if closed:
        await db.commit()
    return closed


async def touch_connection(
    db: AsyncSession,
    connection_pk: int,
) -> bool:
    """Stamp ``last_seen_at`` on an OPEN row. ``True`` iff the row was open.

    One UPDATE, no read, run on every heartbeat of every socket. A ``False``
    is a MEASUREMENT that the row was closed under a socket that is still
    delivering heartbeats (the sweep, or a supersede elsewhere) — the caller
    closes that socket so the runner reconnects and registers a fresh row.
    """
    result = await db.execute(
        update(DeviceConnection)
        .where(
            DeviceConnection.id == connection_pk,
            DeviceConnection.disconnected_at.is_(None),
        )
        .values(last_seen_at=utc_now())
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def list_live_instance_rows(
    db: AsyncSession,
    device_ids: Sequence[UUID],
) -> dict[UUID, list[DeviceConnection]]:
    """Candidate live instance rows for many devices in ONE query.

    Returns open rows grouped by device. Secondary rows are pre-filtered by
    freshness (``COALESCE(last_seen_at, connected_at)`` within
    :data:`SECONDARY_STALE_AFTER`); primary and legacy rows are returned as-is
    because their liveness is the DEVICE row's ``ws_session_id`` pointer,
    which the caller holds and applies (only the pointed-at primary row is a
    live instance — an older open primary row is an orphan of an unclean
    close).
    """
    grouped: dict[UUID, list[DeviceConnection]] = {d: [] for d in device_ids}
    if not device_ids:
        return grouped
    cutoff = utc_now() - SECONDARY_STALE_AFTER
    query = (
        select(DeviceConnection)
        .where(
            DeviceConnection.device_id.in_(list(device_ids)),
            DeviceConnection.disconnected_at.is_(None),
            or_(
                DeviceConnection.instance_role.is_distinct_from(
                    INSTANCE_ROLE_SECONDARY
                ),
                func.coalesce(
                    DeviceConnection.last_seen_at, DeviceConnection.connected_at
                )
                >= cutoff,
            ),
        )
        .order_by(DeviceConnection.id)
    )
    result = await db.execute(query)
    for record in result.scalars().all():
        grouped.setdefault(record.device_id, []).append(record)
    return grouped
