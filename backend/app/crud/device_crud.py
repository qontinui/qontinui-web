"""CRUD operations for the unified device registry (``coord.devices``).

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
replaces the previous ``runner_crud`` + ``runner_session`` modules. The
authoritative producer of ``coord.devices`` rows is qontinui-coord's
``POST /coord/devices/register`` endpoint, but the web backend retains
direct read+write access to the columns it owns (WS lifecycle, derived
status, heartbeat).
"""

from uuid import UUID

from fastapi import HTTPException, status
from qontinui_schemas.common import utc_now
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device
from app.models.device_connection import DeviceConnection

__all__ = [
    "register_device",
    "heartbeat_device",
    "list_devices",
    "get_device",
    "delete_device",
    "claim_ws_session",
    "clear_ws_session_if_current",
]


async def register_device(
    db: AsyncSession,
    *,
    user_id: UUID,
    name: str,
    hostname: str,
    port: int,
    capabilities: list[str],
    restate_enabled: bool,
    restate_healthy: bool,
    os: str | None = None,
    os_version: str | None = None,
    device_id: UUID | None = None,
) -> Device:
    """Register (or update) a user-paired device.

    When ``device_id`` is supplied (the canonical post-unified-devices
    case — coord's pair-cli or pair-complete mints a JWT whose
    ``device_id`` claim the WS handshake forwards here), the upsert is
    keyed on ``device_id`` and a freshly-created row is bound to that
    exact identity (overriding the model's ``default=uuid4``). This
    honors the unified-devices contract: one ``coord.devices`` row per
    physical device, identified by the machine.json UUID coord assigned
    at pair time. The row's ``user_id`` and ``name`` are refreshed from
    the JWT-asserted values on every call, since coord is the identity
    authority.

    When ``device_id`` is ``None`` (legacy test-only path via
    :func:`runner_crud.register_runner`), the upsert falls back to the
    pre-unified-devices ``(user_id, name)`` key. New rows in that path
    get a server-generated ``device_id`` from the model's
    ``default=uuid4`` — the resulting row will NOT match any
    coord-asserted device identity, which is acceptable for test
    fixtures that don't go through coord pairing.

    Both paths set ``capability_user_paired = true`` and
    ``derived_status = 'healthy'``.
    """
    if device_id is not None:
        query = select(Device).where(Device.device_id == device_id)
    else:
        query = select(Device).where(
            Device.user_id == user_id,
            Device.name == name,
        )
    result = await db.execute(query)
    existing = result.scalar_one_or_none()

    now = utc_now()

    if existing is not None:
        # When called from the WS handshake the JWT-asserted user_id /
        # name supersede whatever the row had — coord is the identity
        # authority. ``device_id`` is the PK and never updated here.
        existing.user_id = user_id
        existing.name = name
        existing.hostname = hostname
        existing.port = port
        existing.capabilities = capabilities
        existing.restate_enabled = restate_enabled
        existing.restate_healthy = restate_healthy
        existing.last_heartbeat = now
        existing.derived_status = "healthy"
        existing.capability_user_paired = True
        if os is not None:
            existing.os = os
        if os_version is not None:
            existing.os_version = os_version
        await db.commit()
        await db.refresh(existing)
        return existing

    record_kwargs: dict[str, object] = {
        "user_id": user_id,
        "name": name,
        "hostname": hostname,
        "port": port,
        "capabilities": capabilities,
        "restate_enabled": restate_enabled,
        "restate_healthy": restate_healthy,
        "last_heartbeat": now,
        "state": "healthy",
        "derived_status": "healthy",
        "capability_user_paired": True,
        "capability_web_controlled": True,
        "os": os,
        "os_version": os_version,
    }
    if device_id is not None:
        record_kwargs["device_id"] = device_id
    record = Device(**record_kwargs)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def heartbeat_device(
    db: AsyncSession,
    *,
    device_id: UUID,
    restate_healthy: bool,
    status_value: str,
    derived_status: str | None = None,
    ui_error: dict | None = None,
    recent_crash: dict | None = None,
) -> Device | None:
    """Record a heartbeat from a device, updating liveness fields."""
    query = select(Device).where(Device.device_id == device_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if record is None:
        return None

    record.last_heartbeat = utc_now()
    record.restate_healthy = restate_healthy
    if derived_status is not None:
        record.derived_status = derived_status
    else:
        record.derived_status = status_value
    record.ui_error = ui_error
    record.recent_crash = recent_crash
    await db.commit()
    await db.refresh(record)
    return record


async def claim_ws_session(
    db: AsyncSession,
    *,
    device_id: UUID,
    connection_pk: int,
) -> bool:
    """Point ``ws_session_id`` at ``connection_pk`` unless a NEWER one holds it.

    This is the *self-healing* half of the WS-presence pointer. Registration
    is the only other writer, so before this existed a pointer that got
    NULLed while the socket stayed up could never recover: the runner kept
    heartbeating every ~30s, ``last_heartbeat`` stayed fresh, and
    ``ws_session_id`` stayed NULL forever — which is exactly what
    ``_runner_proxy_relay`` reads to decide whether the mobile cloud relay
    can reach the device. The observable end state was a self-contradictory
    ``GET /api/v1/devices`` row (``wsConnected: false`` beside a 30s-old
    ``lastHeartbeat``) and a phone stuck on "Couldn't reach the runner
    through the cloud relay".

    A NULLed pointer under a live socket has several causes beyond the
    teardown race that :func:`clear_ws_session_if_current` closes — the
    scheduled ``connection_cleanup`` sweep clearing on a momentary Redis
    presence miss, a backend process restart, a failover, or an unclean
    close whose ``finally`` never ran. Rather than enumerate them, the
    heartbeat re-asserts ground truth: *this* socket is open, therefore the
    device is WS-reachable through *this* connection.

    Ordering rule — ``coord.device_connections.id`` is a monotonic sequence,
    so a strictly greater id is a strictly later connection. We claim when
    the pointer is NULL, or points at an OLDER connection, or points at a
    connection that is already CLOSED (or gone). That makes the heal
    monotonic — a superseded handler can never steal the pointer back from
    the live connection that replaced it — while still being able to escape
    a pointer stranded on a dead connection with a higher id.

    That last arm is not hypothetical bookkeeping. Without it, a pointer
    holding an id greater than ours that belongs to a DEAD connection would
    refuse every future claim, silently and forever: exactly the shape of the
    outage this function exists to end, reintroduced one level up. Sequence
    resets, a restore from a dump, and the flush-vs-commit reordering of two
    concurrent registrations can all produce it.

    A pointer already equal to ours is left untouched, so the steady-state
    heartbeat costs an UPDATE that matches no rows rather than a write.

    ``ws_connected_at`` is taken from the connection row itself, NOT
    ``utc_now()``: coord's active-device pick orders on that column
    (``coord_device.py`` — ``... AND ws_session_id IS NOT NULL ORDER BY
    ws_connected_at DESC``), so stamping "now" on a heal would jump the
    device to the front of that ordering and corrupt connection-duration
    reporting.

    The compare and the write are ONE statement, so a concurrent registration
    cannot slip between them.

    Returns:
        ``True`` when the pointer was actually (re)claimed — i.e. a heal
        happened and is worth logging — ``False`` when it was already ours
        or a newer LIVE connection owns it.
    """
    pointed_at_is_live = (
        select(DeviceConnection.id)
        .where(
            DeviceConnection.id == Device.ws_session_id,
            DeviceConnection.disconnected_at.is_(None),
        )
        .correlate(Device)
        .exists()
    )
    its_connected_at = (
        select(DeviceConnection.connected_at)
        .where(DeviceConnection.id == connection_pk)
        .scalar_subquery()
    )
    result = await db.execute(
        update(Device)
        .where(
            Device.device_id == device_id,
            Device.ws_session_id.is_distinct_from(connection_pk),
            or_(
                Device.ws_session_id.is_(None),
                Device.ws_session_id < connection_pk,
                ~pointed_at_is_live,
            ),
        )
        .values(ws_session_id=connection_pk, ws_connected_at=its_connected_at)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def clear_ws_session_if_current(
    db: AsyncSession,
    *,
    device_id: UUID,
    connection_pk: int,
) -> bool:
    """Clear ``ws_session_id`` iff it still points at ``connection_pk``.

    Atomic compare-and-clear. The teardown path used to do this as
    read-modify-write in Python (``get_device`` → compare
    ``row.ws_session_id == connection_pk`` → assign ``None`` → ``commit``),
    which is a lost-update race under READ COMMITTED: connection A reads the
    row while the pointer is still its own, connection B commits its
    registration (pointer → B), and A then commits the NULL it decided on
    from stale data. B's socket is live, but nothing will ever re-point at
    it. Doing the compare inside the UPDATE's WHERE clause lets the database
    serialize it against B's write instead.

    Returns:
        ``True`` if this call cleared the pointer, ``False`` if it had
        already been superseded (or the device row is gone).
    """
    result = await db.execute(
        update(Device)
        .where(
            Device.device_id == device_id,
            Device.ws_session_id == connection_pk,
        )
        .values(ws_session_id=None, ws_connected_at=None)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def list_devices(
    db: AsyncSession,
    user_id: UUID,
) -> list[Device]:
    """Return all user-paired devices owned by ``user_id`` (newest first)."""
    query = (
        select(Device)
        .where(
            Device.user_id == user_id,
            Device.capability_user_paired.is_(True),
        )
        .order_by(Device.created_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_device(
    db: AsyncSession,
    device_id: UUID,
) -> Device | None:
    """Fetch a device by id (no ownership check)."""
    query = select(Device).where(Device.device_id == device_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def delete_device(
    db: AsyncSession,
    device_id: UUID,
    user_id: UUID,
) -> None:
    """Delete a device registration owned by ``user_id``."""
    record = await get_device(db, device_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )
    if record.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this device",
        )

    await db.delete(record)
    await db.commit()
