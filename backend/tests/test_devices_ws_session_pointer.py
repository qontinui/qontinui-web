"""Regression tests for the ``coord.devices.ws_session_id`` presence pointer.

Two P0 defects are pinned here, both from a live prod relay outage on
2026-08-27: a runner held an open WebSocket to the prod backend and delivered
heartbeats every ~30s, but its ``ws_session_id`` was NULL. Because
``device_bridge_ws._runner_proxy_relay`` gates the mobile cloud relay on
``ws_session_id IS NOT NULL``, every relay call 503'd "runner not connected"
and the operator's phone showed "Couldn't reach the runner through the cloud
relay" for ~2h. ``GET /api/v1/devices`` served the contradiction plainly —
``wsConnected: false`` beside a 30s-fresh ``lastHeartbeat``.

1. **No heal.** ``ws_session_id`` was written ONLY at registration, so nothing
   in the system could recover a pointer that was lost while the socket stayed
   up. ``_handle_heartbeat`` now re-asserts it (``device_crud.claim_ws_session``),
   bounding the outage to one heartbeat interval regardless of what wiped it —
   the teardown race below, the scheduled ``connection_cleanup`` sweep firing
   on a momentary Redis presence miss, a backend restart, or an unclean close
   whose ``finally`` never ran.

2. **Non-atomic compare-and-clear.** Teardown *did* guard against clearing a
   superseded pointer, but as a read-modify-write in Python: ``get_device`` →
   compare in the interpreter → assign ``None`` → ``commit``. Under READ
   COMMITTED that is a lost update, not a guard — connection A can read the row
   while the pointer is still A's, connection B can then commit its
   registration, and A then commits the NULL it decided on from data that is no
   longer true. ``device_crud.clear_ws_session_if_current`` moves the compare
   into the UPDATE's WHERE clause so the database serializes it.

These tests are DB-backed on purpose: the fix *is* the statement's interaction
with Postgres concurrency control, and a mocked session cannot exercise it.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.endpoints import devices as devices_ep
from app.api.v1.endpoints import devices_ws
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud
from app.models.device import Device
from app.models.user import User

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def ws_env(test_engine) -> AsyncGenerator[SimpleNamespace, None]:
    """A COMMITTED device with two connection rows, plus a session factory.

    The rows must be committed (not held in the rolled-back transaction the
    shared ``async_db_session`` fixture provides) because the code under test
    opens its own sessions via ``AsyncSessionLocal`` on a different connection,
    and because the concurrency tests need two connections that can genuinely
    block on each other. Teardown deletes the device — which cascades to its
    ``coord.device_connections`` rows — and the user.
    """
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async with maker() as db:
        user = User(
            email=f"wsptr_{uuid4()}@example.com",
            username=f"wsptr_{uuid4().hex[:8]}",
            full_name="WS Pointer Test",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

        device = await device_crud.register_device(
            db,
            device_id=uuid4(),
            user_id=user.id,
            name=f"wsptr-runner-{uuid4().hex[:6]}",
            hostname="spaceship",
            port=9876,
            capabilities=["gui_automation"],
            restate_enabled=False,
            restate_healthy=False,
        )
        device_id = device.device_id

        # Connection A, then connection B. ``id`` is a BigInteger sequence, so
        # B's pk is strictly greater — that ordering is what makes the heal
        # monotonic, and several assertions below depend on it.
        conn_a = await device_connection_crud.create_connection_record(
            db, device_id=device_id, user_id=user.id, ip_address="127.0.0.1"
        )
        conn_b = await device_connection_crud.create_connection_record(
            db, device_id=device_id, user_id=user.id, ip_address="127.0.0.1"
        )
        pk_a, pk_b = conn_a.id, conn_b.id
        connected_at_a = conn_a.connected_at
        assert pk_b > pk_a, "sequence must hand out increasing connection ids"

    env = SimpleNamespace(
        maker=maker,
        user_id=user.id,
        device_id=device_id,
        pk_a=pk_a,
        pk_b=pk_b,
        connected_at_a=connected_at_a,
    )
    try:
        yield env
    finally:
        async with maker() as db:
            await db.execute(
                text("DELETE FROM coord.devices WHERE device_id = :d"),
                {"d": str(device_id)},
            )
            await db.execute(
                text("DELETE FROM auth.users WHERE id = :u"), {"u": str(user.id)}
            )
            await db.commit()


async def _set_pointer(
    maker: async_sessionmaker, device_id: UUID, value: int | None
) -> None:
    """Force ``ws_session_id`` to ``value`` — the 'artificial wipe' lever."""
    async with maker() as db:
        await db.execute(
            text("UPDATE coord.devices SET ws_session_id = :v WHERE device_id = :d"),
            {"v": value, "d": str(device_id)},
        )
        await db.commit()


async def _read_pointer(maker: async_sessionmaker, device_id: UUID) -> int | None:
    async with maker() as db:
        row = (
            await db.execute(select(Device).where(Device.device_id == device_id))
        ).scalar_one()
        pointer: int | None = row.ws_session_id
        return pointer


def _heartbeat_manager(socket: object) -> MagicMock:
    """A manager that still holds ``socket`` as this device's live connection."""
    manager = MagicMock()
    manager.refresh_ttl = AsyncMock(return_value=True)
    manager.get_websocket = MagicMock(return_value=socket)
    return manager


# ---------------------------------------------------------------------------
# P0 #1 — the heartbeat heals a pointer that was lost under a live socket
# ---------------------------------------------------------------------------


async def test_heartbeat_heals_a_nulled_pointer_under_a_live_connection(
    ws_env: SimpleNamespace,
) -> None:
    """The outage, reproduced and recovered.

    Artificially NULL ``ws_session_id`` while connection A's socket is still
    open (exactly the prod state: live WS, fresh heartbeats, NULL pointer),
    then deliver one heartbeat on A. The pointer must come back pointing at A,
    which is what flips ``wsConnected`` back to true and unblocks the relay.
    """
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_a)
    # --- the wipe ---
    await _set_pointer(ws_env.maker, ws_env.device_id, None)
    assert await _read_pointer(ws_env.maker, ws_env.device_id) is None

    sock = object()
    manager = _heartbeat_manager(sock)

    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            ws_env.pk_a,
            sock,
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_a, (
        "one heartbeat on a live connection must re-assert ws_session_id; "
        "without it a NULLed pointer never heals and the cloud relay 503s "
        "for as long as the socket stays up"
    )

    # ...and the recovery must be visible on the wire, which is the operator-
    # facing half of the outage: GET /api/v1/devices reports wsConnected:true
    # again, and derivedStatus leaves the relay-unroutable state.
    async with ws_env.maker() as db:
        row = (
            await db.execute(select(Device).where(Device.device_id == ws_env.device_id))
        ).scalar_one()
    wire = devices_ep._device_to_wire(row)
    assert wire.wsConnected is True
    assert wire.derivedStatus.value == "healthy"


async def test_wire_reports_the_contradiction_before_the_heal(
    ws_env: SimpleNamespace,
) -> None:
    """P1: the wiped state must NOT read ``healthy`` to an operator.

    This is the whole point of the relay-unroutable gate — during the prod
    incident ``GET /api/v1/devices`` served ``derivedStatus: healthy`` beside
    ``wsConnected: false`` for ~2h, so nothing in the operator view said the
    relay was down.
    """
    await _set_pointer(ws_env.maker, ws_env.device_id, None)
    async with ws_env.maker() as db:
        row = (
            await db.execute(select(Device).where(Device.device_id == ws_env.device_id))
        ).scalar_one()

    # A device that just registered has a fresh heartbeat and derived_status
    # "healthy" — the exact contradiction, now that the pointer is NULL.
    wire = devices_ep._device_to_wire(row)
    assert wire.wsConnected is False
    assert wire.derivedStatus.value == "degraded", (
        "a fresh heartbeat with no ws_session_id is relay-unroutable; "
        "reporting it as healthy hides the outage from operators"
    )


async def test_heartbeat_heals_a_pointer_left_on_an_older_dead_connection(
    ws_env: SimpleNamespace,
) -> None:
    """A stale pointer at an OLDER connection is also healed, not just NULL."""
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_a)

    sock = object()
    manager = _heartbeat_manager(sock)

    # B is the live socket; the pointer is stuck on A, which is gone.
    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            ws_env.pk_b,
            sock,
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_b


async def test_heartbeat_never_steals_the_pointer_from_a_newer_connection(
    ws_env: SimpleNamespace,
) -> None:
    """The heal must be monotonic.

    If a superseded handler could claim the pointer back, two connections
    reconnecting in a burst would fight over it and the heal would become a
    second source of the very corruption it exists to repair.
    """
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_b)

    sock = object()
    manager = _heartbeat_manager(sock)

    # A is older than B — its heartbeat must not win.
    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            ws_env.pk_a,
            sock,
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_b


async def test_claim_is_a_no_op_when_the_pointer_is_already_ours(
    ws_env: SimpleNamespace,
) -> None:
    """Steady state costs no write — ``claim_ws_session`` reports False."""
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_a)
    async with ws_env.maker() as db:
        claimed = await device_crud.claim_ws_session(
            db, device_id=ws_env.device_id, connection_pk=ws_env.pk_a
        )
    assert claimed is False
    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_a


async def test_heartbeat_without_a_connection_pk_still_persists(
    ws_env: SimpleNamespace,
) -> None:
    """Callers that don't know their connection skip the heal, not the beat."""
    await _set_pointer(ws_env.maker, ws_env.device_id, None)
    sock = object()
    manager = _heartbeat_manager(sock)

    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            None,
            sock,
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) is None
    manager.refresh_ttl.assert_awaited_once()


# ---------------------------------------------------------------------------
# P0 #2 — teardown must never clear a pointer that is no longer ours
# ---------------------------------------------------------------------------


def _cleanup_manager(holds: object = None) -> MagicMock:
    """A manager whose registry currently holds ``holds`` for this device."""
    manager = MagicMock()
    manager.unregister = AsyncMock()
    manager.publish_runner_disconnected = AsyncMock()
    manager.get_websocket = MagicMock(return_value=holds)
    return manager


async def test_teardown_clears_the_pointer_when_it_is_still_ours(
    ws_env: SimpleNamespace,
) -> None:
    """The ordinary disconnect still works — the guard is not a blanket skip."""
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_a)

    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._cleanup(
            ws_env.device_id, ws_env.pk_a, ws_env.user_id, _cleanup_manager()
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) is None


async def test_a_registers_b_registers_a_tears_down_leaves_b_intact(
    ws_env: SimpleNamespace,
) -> None:
    """The A/B interleave from the incident logs.

    A connects, B reconnects and takes the pointer, THEN A's teardown finally
    runs (the logs showed a quick disconnect followed by two 'kicked while
    connected' teardowns). A must not clear B's live pointer.
    """
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_a)
    # B registers, taking the pointer.
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_b)

    # ...and only now does A's teardown run.
    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._cleanup(
            ws_env.device_id, ws_env.pk_a, ws_env.user_id, _cleanup_manager()
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_b, (
        "A's teardown stomped B's live pointer — the device is now "
        "permanently unroutable for the mobile cloud relay"
    )


async def test_concurrent_teardown_cannot_lose_b_s_update(
    ws_env: SimpleNamespace, test_engine
) -> None:
    """The atomicity itself: A's clear must lose the race, not win it.

    This is the interleave a Python-side compare cannot survive. B's
    registration is held OPEN (row locked, pointer written, not yet committed)
    while A's teardown clear is issued concurrently. A blocks on B's row lock;
    when B commits, Postgres re-evaluates A's WHERE clause against the newly
    committed row, finds ``ws_session_id`` is now B's, and matches zero rows.

    With the old read-modify-write A would have read the pre-B value, decided
    "still mine", and committed a NULL over B's live pointer.
    """
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_a)

    session_b = ws_env.maker()
    a_task: asyncio.Task[bool] | None = None
    try:
        # B: take the row lock and write its pointer, but do NOT commit.
        await session_b.execute(
            text("UPDATE coord.devices SET ws_session_id = :v WHERE device_id = :d"),
            {"v": ws_env.pk_b, "d": str(ws_env.device_id)},
        )

        async def a_clears() -> bool:
            async with ws_env.maker() as session_a:
                return await device_crud.clear_ws_session_if_current(
                    session_a,
                    device_id=ws_env.device_id,
                    connection_pk=ws_env.pk_a,
                )

        a_task = asyncio.create_task(a_clears())
        # Give A time to reach the statement and block on B's lock. Poll
        # rather than sleeping a fixed interval: on a loaded box a single
        # short sleep produces a false "not blocked" verdict, and the
        # assertion message would then be actively misleading.
        for _ in range(50):
            await asyncio.sleep(0.05)
            if a_task.done():
                break
        assert not a_task.done(), (
            "A's clear should be blocked on B's uncommitted row lock; if it "
            "returned already the compare is not happening in the database"
        )

        await session_b.commit()
        cleared = await asyncio.wait_for(a_task, timeout=10)
    finally:
        # If any assertion above fired, a_task is still pending; closing
        # session_b releases the lock and the orphan would resolve into a
        # torn-down loop as "Task exception was never retrieved" noise that
        # masks the real failure.
        if a_task is not None and not a_task.done():
            a_task.cancel()
            await asyncio.gather(a_task, return_exceptions=True)
        await session_b.close()

    assert cleared is False, "A must observe that it was superseded"
    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_b, (
        "lost update: A's teardown NULLed the pointer B had just committed"
    )


async def test_registration_rollback_does_not_stomp_a_newer_pointer(
    ws_env: SimpleNamespace,
) -> None:
    """The second clear site (failed manager registration) has the same guard."""
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_b)
    async with ws_env.maker() as db:
        cleared = await device_crud.clear_ws_session_if_current(
            db, device_id=ws_env.device_id, connection_pk=ws_env.pk_a
        )
    assert cleared is False
    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_b


# ---------------------------------------------------------------------------
# The heal must not outrun the manager — a pointer we cannot route through
# ---------------------------------------------------------------------------


async def test_heal_refuses_when_the_manager_no_longer_holds_this_socket(
    ws_env: SimpleNamespace,
) -> None:
    """Healing a pointer the relay cannot use would be worse than not healing.

    ``_runner_proxy_relay`` is gated ONLY on ``ws_session_id`` and is the sole
    503 emitter on that path — ``dispatch_and_wait`` publishes over Redis
    pub/sub and cannot detect a missing runner itself. So if the manager has
    dropped this device's registration (its inbound listener cancelled) while
    the socket is still open, asserting the pointer converts a fast, accurate
    ``503 "runner not connected"`` into a full-timeout hang, AND puts
    ``derivedStatus`` back to ``healthy`` so the relay-unroutable signal stops
    firing. Stay NULL and stay honest.
    """
    await _set_pointer(ws_env.maker, ws_env.device_id, None)

    sock = object()
    manager = _heartbeat_manager(sock)
    manager.get_websocket = MagicMock(return_value=None)  # registration gone

    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            ws_env.pk_a,
            sock,
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) is None


async def test_heal_refuses_when_the_manager_holds_a_different_socket(
    ws_env: SimpleNamespace,
) -> None:
    """A superseded handler's heartbeat must not claim on B's behalf."""
    await _set_pointer(ws_env.maker, ws_env.device_id, None)

    sock = object()
    manager = _heartbeat_manager(object())  # someone else's socket

    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            ws_env.pk_a,
            sock,
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) is None


async def test_heal_escapes_a_pointer_stranded_on_a_newer_dead_connection(
    ws_env: SimpleNamespace,
) -> None:
    """The monotonic rule must not become its own permanent-failure mode.

    A pointer holding a HIGHER id that belongs to a CLOSED connection would,
    under a bare ``ws_session_id < pk`` rule, refuse every future claim
    silently and forever — the exact outage shape this work exists to end.
    """
    # B is newer than A, but B is closed; A is the live socket.
    async with ws_env.maker() as db:
        await db.execute(
            text(
                "UPDATE coord.device_connections SET disconnected_at = now() "
                "WHERE id = :i"
            ),
            {"i": ws_env.pk_b},
        )
        await db.commit()
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_b)

    sock = object()
    manager = _heartbeat_manager(sock)
    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            ws_env.pk_a,
            sock,
        )

    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_a


async def test_heal_stamps_ws_connected_at_from_the_connection_row(
    ws_env: SimpleNamespace,
) -> None:
    """Not ``utc_now()``.

    coord's active-device pick orders on ``ws_connected_at DESC``, so a heal
    that stamped "now" would jump the device to the front of that ordering
    and corrupt connection-duration reporting.
    """
    await _set_pointer(ws_env.maker, ws_env.device_id, None)

    sock = object()
    manager = _heartbeat_manager(sock)
    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._handle_heartbeat(
            {"type": "heartbeat", "status": "healthy"},
            ws_env.device_id,
            manager,
            ws_env.pk_a,
            sock,
        )

    async with ws_env.maker() as db:
        row = (
            await db.execute(select(Device).where(Device.device_id == ws_env.device_id))
        ).scalar_one()
    assert row.ws_connected_at == ws_env.connected_at_a


# ---------------------------------------------------------------------------
# P0 #2, manager half — teardown must not unregister a socket that isn't ours
# ---------------------------------------------------------------------------


async def test_teardown_unregisters_the_manager_when_the_socket_is_ours(
    ws_env: SimpleNamespace,
) -> None:
    """The ordinary disconnect must still release the manager registration."""
    sock = object()
    manager = _cleanup_manager(holds=sock)
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_a)

    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._cleanup(
            ws_env.device_id, ws_env.pk_a, ws_env.user_id, manager, sock
        )

    manager.unregister.assert_awaited_once()
    manager.publish_runner_disconnected.assert_awaited_once()


async def test_superseded_teardown_does_not_unregister_b_s_live_socket(
    ws_env: SimpleNamespace,
) -> None:
    """The manager half of the A/B race.

    ``manager.unregister`` is keyed on ``device_id`` ALONE and cancels the
    shared inbound pub/sub listener, so an unguarded call here destroys the
    listener belonging to B's LIVE socket. Guarding only the database pointer
    would leave a subtler outage than the original: pointer correct, relay
    gate passes, dispatch publishes to a channel with no subscriber and hangs
    until timeout, while GET /api/v1/devices reports healthy.
    """
    a_sock, b_sock = object(), object()
    manager = _cleanup_manager(holds=b_sock)  # B already took over
    await _set_pointer(ws_env.maker, ws_env.device_id, ws_env.pk_b)

    with patch.object(devices_ws, "AsyncSessionLocal", ws_env.maker):
        await devices_ws._cleanup(
            ws_env.device_id, ws_env.pk_a, ws_env.user_id, manager, a_sock
        )

    manager.unregister.assert_not_awaited()
    manager.publish_runner_disconnected.assert_not_awaited()
    assert await _read_pointer(ws_env.maker, ws_env.device_id) == ws_env.pk_b
