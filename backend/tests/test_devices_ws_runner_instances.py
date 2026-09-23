"""Runner-instance granularity on the device WebSocket (plan
``2026-09-20-runner-selector-drives-a-transport-not-a-target``, Phase 6).

Every runner instance on one machine — the primary on ``:9876`` and each
supervisor-spawned secondary on ``:9877-9899`` — authenticates with the SAME
machine device JWT, so they all register against ONE ``coord.devices`` row.
Before this change the LAST instance to connect overwrote that row's ``port``,
its relay pointer ``ws_session_id`` and the manager's device-keyed socket, so
starting a temp runner silently took the device's relay away from the primary.

What is pinned here, driving the real endpoint against the test Postgres:

* a primary registers exactly as before — port, pointer, manager;
* a SECONDARY records its own connection row (key / role / port) and writes
  none of the three, on connect, on heartbeat (including the pointer-heal path)
  and on disconnect;
* a legacy runner (no ``instanceKey`` / ``instanceRole``) behaves as before,
  unless its older ``devenv.instance_role`` block demotes it;
* two LIVE sockets with the same key on one device are a CONFLICT: the
  newcomer is refused when the holder is demonstrably alive, and an orphaned
  holder's row is closed (logged) rather than blocking a reconnect;
* ``Runner.instances`` lists the live instances in one query per response;
* the ``connection_cleanup`` sweep ages secondary rows by their own heartbeat.

DB-backed on purpose: the rules ARE which rows get written, and the duplicate
arbitration leans on a partial unique index a mock cannot enforce.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncGenerator
from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import WebSocketDisconnect
from qontinui_schemas.common import utc_now
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.websockets import WebSocketState

from app.api.v1.endpoints import devices as devices_ep
from app.api.v1.endpoints import devices_ws
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud
from app.jobs import connection_cleanup
from app.models.device import Device
from app.models.device_connection import DeviceConnection
from app.models.user import User

pytestmark = pytest.mark.asyncio

_DISCONNECT = object()


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


class _Socket:
    """A scripted device socket: frames are fed through ``inbox``."""

    def __init__(self, info: dict[str, Any]) -> None:
        self.inbox: asyncio.Queue[Any] = asyncio.Queue()
        self.inbox.put_nowait(info)
        self.application_state = WebSocketState.CONNECTED
        self.client_state = WebSocketState.CONNECTED
        self.client = MagicMock(host="127.0.0.1")
        self.headers = {"authorization": "Bearer fake-device-jwt"}
        self.query_params: dict[str, str] = {}
        self.sent: list[dict[str, Any]] = []
        self.closed: tuple[int, str | None] | None = None
        self.acked = asyncio.Event()
        # A live runner answers the backend's liveness probe (an
        # ``http_request`` for a path its relay allowlist refuses) with a
        # ``command_response`` echoing ``request_id``. ``False`` models a
        # half-open socket the runner has abandoned.
        self.answers_probes = True
        # Set while the handler is parked in receive_json — i.e. it has
        # finished processing every frame delivered so far.
        self.idle = asyncio.Event()

    async def accept(self) -> None:
        return None

    async def send_json(self, payload: dict[str, Any]) -> None:
        if self.application_state != WebSocketState.CONNECTED:
            raise WebSocketDisconnect(code=1006)
        self.sent.append(payload)
        if payload.get("type") == "connected":
            self.acked.set()
        if payload.get("type") == "http_request" and self.answers_probes:
            self.inbox.put_nowait(
                {
                    "type": "command_response",
                    "request_id": payload["request_id"],
                    "status": 403,
                }
            )

    async def receive_json(self) -> Any:
        self.idle.set()
        item = await self.inbox.get()
        self.idle.clear()
        if item is _DISCONNECT:
            self.client_state = WebSocketState.DISCONNECTED
            raise WebSocketDisconnect(code=1000)
        return item

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closed = (code, reason)
        self.application_state = WebSocketState.DISCONNECTED
        self.acked.set()  # unblock waiters on a refused handshake


class _Manager:
    """The runner WS manager, modelled as the device-keyed registry it is."""

    def __init__(self) -> None:
        self.sockets: dict[str, Any] = {}
        self.register = AsyncMock(side_effect=self._register)
        self.unregister = AsyncMock(side_effect=self._unregister)
        self.publish_runner_connected = AsyncMock()
        self.publish_runner_disconnected = AsyncMock()
        self.refresh_ttl = AsyncMock(return_value=True)
        self.send_response_to_frontends = AsyncMock()

    async def _register(self, *, runner_id: Any, websocket: Any, **_: Any) -> None:
        self.sockets[str(runner_id)] = websocket

    async def _unregister(self, runner_id: Any, *_: Any) -> None:
        self.sockets.pop(str(runner_id), None)

    async def register_if_unowned(
        self,
        runner_id: Any,
        websocket: Any,
        user_id: Any,
        still_entitled: Any,
        **kwargs: Any,
    ) -> bool:
        # Same refusal rules as the real manager (which applies them under
        # its per-device lock).
        current = self.sockets.get(str(runner_id))
        if current is not None and current is not websocket:
            return False
        if not await still_entitled():
            return False
        await self.register(runner_id=runner_id, websocket=websocket, **kwargs)
        return True

    def send_lock_for(self, runner_id: Any, websocket: Any) -> Any:
        return None

    async def unregister_if_current(
        self, runner_id: Any, websocket: Any, user_id: Any = None
    ) -> bool:
        # Compare at call time, as the real manager does under its lock.
        if self.sockets.get(str(runner_id)) is not websocket:
            return False
        await self.unregister(runner_id, user_id)
        return True

    def get_websocket(self, runner_id: Any) -> Any:
        return self.sockets.get(str(runner_id))


def _info(
    *,
    port: int,
    key: str | None = None,
    role: str | None = None,
    devenv_role: str | None = None,
    name: str = "runner",
) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "type": "runner_info",
        "name": name,
        "hostname": "box",
        "port": port,
        "capabilities": ["gui_automation"],
    }
    if key is not None:
        msg["instanceKey"] = key
    if role is not None:
        msg["instanceRole"] = role
    if devenv_role is not None:
        msg["devenv"] = {"enrolled": False, "instance_role": devenv_role}
    return msg


@pytest_asyncio.fixture
async def env(test_engine) -> AsyncGenerator[SimpleNamespace, None]:
    """A committed user + device row, the patched endpoint externals, teardown."""
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        user = User(
            email=f"inst_{uuid4()}@example.com",
            username=f"inst_{uuid4().hex[:8]}",
            full_name="Runner Instance Test",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    device_id = uuid4()
    manager = _Manager()
    ns = SimpleNamespace(
        maker=maker,
        user_id=user.id,
        device_id=device_id,
        manager=manager,
        tasks=[],
    )
    claims = {
        "device_id": str(device_id),
        "user_id": str(user.id),
        "sub": f"device:{device_id}",
    }
    with contextlib.ExitStack() as stack:
        stack.enter_context(
            patch.object(
                devices_ws.coord_jwks_client,
                "verify_token",
                AsyncMock(return_value=claims),
            )
        )
        stack.enter_context(patch.object(devices_ws, "AsyncSessionLocal", maker))
        stack.enter_context(
            patch.object(devices_ws, "get_redis", AsyncMock(return_value=MagicMock()))
        )
        stack.enter_context(
            patch.object(
                devices_ws,
                "get_runner_websocket_manager",
                AsyncMock(return_value=manager),
            )
        )
        stack.enter_context(
            patch.object(devices_ws.devenv_auto_enroll, "schedule_auto_enroll")
        )
        stack.enter_context(patch.object(devices_ws, "_PROBE_TIMEOUT_S", 0.5))
        try:
            yield ns
        finally:
            for sock, task in ns.tasks:
                if not task.done():
                    sock.inbox.put_nowait(_DISCONNECT)
            for _, task in ns.tasks:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(task, timeout=5)
            devices_ws._LIVE_SOCKETS.clear()
            for t in list(devices_ws._BACKGROUND_CLOSES):
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(t, timeout=5)
            async with maker() as db:
                await db.execute(
                    text("DELETE FROM coord.devices WHERE device_id = :d"),
                    {"d": str(device_id)},
                )
                await db.execute(
                    text("DELETE FROM auth.users WHERE id = :u"), {"u": str(user.id)}
                )
                await db.commit()


async def _connect(env: SimpleNamespace, info: dict[str, Any]) -> _Socket:
    """Start the endpoint for one socket and wait for its ack (or refusal)."""
    sock = _Socket(info)
    task = asyncio.create_task(devices_ws.websocket_device_unified_endpoint(sock))
    env.tasks.append((sock, task))
    waiter = asyncio.create_task(sock.acked.wait())
    done, _ = await asyncio.wait(
        {waiter, task}, timeout=10, return_when="FIRST_COMPLETED"
    )
    waiter.cancel()
    assert done, "handshake neither acked nor finished"
    return sock


async def _send(sock: _Socket, frame: dict[str, Any]) -> None:
    """Deliver one frame and wait until the handler has fully processed it.

    Deterministic rather than timed: the handler is done with a frame when it
    is parked in ``receive_json`` again with nothing queued.
    """
    sock.idle.clear()
    sock.inbox.put_nowait(frame)
    for _ in range(500):
        await asyncio.sleep(0.01)
        if sock.inbox.empty() and sock.idle.is_set():
            return
        if sock.closed is not None:
            return
    raise AssertionError("the handler did not finish processing the frame")


async def _disconnect(env: SimpleNamespace, sock: _Socket) -> None:
    sock.inbox.put_nowait(_DISCONNECT)
    for s, task in env.tasks:
        if s is sock:
            await asyncio.wait_for(task, timeout=5)


async def _device(env: SimpleNamespace) -> Device:
    async with env.maker() as db:
        return (
            await db.execute(select(Device).where(Device.device_id == env.device_id))
        ).scalar_one()


async def _rows(env: SimpleNamespace) -> list[DeviceConnection]:
    async with env.maker() as db:
        return list(
            (
                await db.execute(
                    select(DeviceConnection)
                    .where(DeviceConnection.device_id == env.device_id)
                    .order_by(DeviceConnection.id)
                )
            ).scalars()
        )


def _open(rows: list[DeviceConnection]) -> list[DeviceConnection]:
    return [r for r in rows if r.disconnected_at is None]


# ---------------------------------------------------------------------------
# Registration: primary vs secondary
# ---------------------------------------------------------------------------


async def test_primary_registration_owns_port_pointer_and_relay(env) -> None:
    sock = await _connect(env, _info(port=9876, key="primary", role="primary"))
    assert sock.sent[0]["type"] == "connected"

    (row,) = await _rows(env)
    assert (row.instance_key, row.instance_role, row.port) == (
        "primary",
        "primary",
        9876,
    )
    device = await _device(env)
    assert device.port == 9876
    assert device.ws_session_id == row.id
    assert env.manager.get_websocket(env.device_id) is sock


async def test_secondary_does_not_take_over_port_pointer_or_relay(env) -> None:
    """THE defect: a temp runner connecting after the primary stole all three."""
    primary = await _connect(env, _info(port=9876, key="primary", role="primary"))
    secondary = await _connect(
        env, _info(port=9877, key="runner:test-abc", role="secondary", name="temp")
    )
    assert secondary.closed is None, "a secondary is admitted, not refused"
    assert secondary.sent[0]["type"] == "connected"
    assert secondary.sent[0]["instance_role"] == "secondary"

    rows = await _rows(env)
    primary_row, secondary_row = rows
    assert (
        secondary_row.instance_key,
        secondary_row.instance_role,
        secondary_row.port,
    ) == ("runner:test-abc", "secondary", 9877)

    device = await _device(env)
    assert device.port == 9876, "the secondary's port must not overwrite the device's"
    assert device.ws_session_id == primary_row.id, (
        "the relay pointer must stay on the primary's socket"
    )
    assert device.name == "runner", "a secondary must not rename the device"
    assert env.manager.get_websocket(env.device_id) is primary, (
        "the manager is keyed on device_id alone; registering the secondary "
        "would have replaced the primary's relay socket"
    )
    env.manager.register.assert_awaited_once()
    env.manager.publish_runner_connected.assert_awaited_once()


async def test_secondary_heartbeat_never_displaces_a_live_primary(env) -> None:
    """Device-level heartbeat state and the pointer stay the primary's."""
    await _connect(env, _info(port=9876, key="primary", role="primary"))
    secondary = await _connect(env, _info(port=9877, key="runner:t1", role="secondary"))
    before = await _device(env)
    assert before.ws_session_id is not None

    await _send(
        secondary,
        {
            "type": "heartbeat",
            "status": "errored",
            "derived_status": "errored",
            "ui_error": {"message": "secondary's own problem"},
        },
    )

    after = await _device(env)
    assert after.ws_session_id == before.ws_session_id, (
        "a secondary heartbeat took the relay pointer from a live primary"
    )
    assert after.port == 9876
    assert after.derived_status == before.derived_status
    assert after.ui_error == before.ui_error
    assert after.last_heartbeat == before.last_heartbeat
    secondary_row = (await _rows(env))[1]
    assert secondary_row.last_seen_at is not None, (
        "the secondary's liveness is its own row's stamp"
    )


async def test_primary_heartbeat_still_heals_the_pointer(env) -> None:
    """Control for the test above: the heal itself still works for a primary."""
    primary = await _connect(env, _info(port=9876, key="primary", role="primary"))
    primary_pk = (await _device(env)).ws_session_id
    async with env.maker() as db:
        await db.execute(
            text("UPDATE coord.devices SET ws_session_id = NULL WHERE device_id = :d"),
            {"d": str(env.device_id)},
        )
        await db.commit()
    await _send(primary, {"type": "heartbeat", "status": "healthy"})
    for _ in range(50):  # the heal is three DB round trips; allow a loaded box
        if (await _device(env)).ws_session_id == primary_pk:
            break
        await asyncio.sleep(0.05)
    assert (await _device(env)).ws_session_id == primary_pk


async def test_secondary_disconnect_leaves_the_primary_intact(env) -> None:
    primary = await _connect(env, _info(port=9876, key="primary", role="primary"))
    secondary = await _connect(env, _info(port=9877, key="runner:t2", role="secondary"))
    primary_pk = (await _device(env)).ws_session_id

    await _disconnect(env, secondary)

    rows = await _rows(env)
    assert rows[1].disconnected_at is not None, "the secondary's own row is closed"
    assert rows[0].disconnected_at is None
    assert (await _device(env)).ws_session_id == primary_pk
    assert env.manager.get_websocket(env.device_id) is primary
    env.manager.unregister.assert_not_awaited()
    env.manager.publish_runner_disconnected.assert_not_awaited()


async def test_secondary_ping_is_answered_on_its_own_socket(env) -> None:
    primary = await _connect(env, _info(port=9876, key="primary", role="primary"))
    secondary = await _connect(env, _info(port=9877, key="runner:t3", role="secondary"))
    await _send(secondary, {"type": "ping"})
    assert secondary.sent[-1]["type"] == "pong"
    assert all(p["type"] != "pong" for p in primary.sent)


async def test_a_lone_secondary_gets_the_relay(env) -> None:
    """No primary connected: the secondary must not leave the device relay-less."""
    lone = await _connect(env, _info(port=9877, key="runner:lone", role="secondary"))
    (row,) = await _rows(env)
    device = await _device(env)
    assert device.ws_session_id == row.id
    assert device.port == 9877
    assert env.manager.get_websocket(env.device_id) is lone
    env.manager.publish_runner_connected.assert_awaited_once()
    # It is the device's relay socket now, so relay traffic is routed for it.
    await _send(lone, {"type": "command_response", "request_id": "r-1"})
    env.manager.send_response_to_frontends.assert_awaited_once()


async def test_a_primary_arriving_takes_the_relay_from_a_secondary(env) -> None:
    lone = await _connect(env, _info(port=9877, key="runner:lone", role="secondary"))
    primary = await _connect(env, _info(port=9876, key="primary", role="primary"))
    rows = await _rows(env)
    primary_row = next(r for r in rows if r.instance_role == "primary")
    device = await _device(env)
    assert device.ws_session_id == primary_row.id
    assert device.port == 9876
    assert env.manager.get_websocket(env.device_id) is primary

    # The secondary relinquished cleanly: its heartbeat neither reclaims the
    # pointer nor writes device state, and its relay frames are dropped.
    await _send(lone, {"type": "heartbeat", "status": "errored", "ui_error": {"m": 1}})
    await _send(lone, {"type": "command_response", "request_id": "r-2"})
    device = await _device(env)
    assert device.ws_session_id == primary_row.id
    assert device.ui_error is None
    env.manager.send_response_to_frontends.assert_not_awaited()

    # ...and its disconnect leaves the primary intact.
    await _disconnect(env, lone)
    assert (await _device(env)).ws_session_id == primary_row.id
    assert env.manager.get_websocket(env.device_id) is primary
    env.manager.publish_runner_disconnected.assert_not_awaited()


async def test_a_lone_secondary_reclaims_a_relay_its_owner_left(env) -> None:
    """The heartbeat path: pointer unheld later (owner gone) → secondary claims."""
    primary = await _connect(env, _info(port=9876, key="primary", role="primary"))
    lone = await _connect(env, _info(port=9877, key="runner:l2", role="secondary"))
    await _disconnect(env, primary)
    assert (await _device(env)).ws_session_id is None

    await _send(lone, {"type": "heartbeat", "status": "healthy"})

    sec_row = next(r for r in await _rows(env) if r.instance_role == "secondary")
    device = await _device(env)
    assert device.ws_session_id == sec_row.id
    assert device.port == 9877
    assert env.manager.get_websocket(env.device_id) is lone


async def test_an_owning_secondary_disconnects_like_the_owner_it_is(env) -> None:
    lone = await _connect(env, _info(port=9877, key="runner:l3", role="secondary"))
    await _disconnect(env, lone)
    assert (await _device(env)).ws_session_id is None
    assert env.manager.get_websocket(env.device_id) is None
    env.manager.publish_runner_disconnected.assert_awaited_once()


# ---------------------------------------------------------------------------
# Legacy runners
# ---------------------------------------------------------------------------


async def test_legacy_runner_registers_as_primary_exactly_as_before(env) -> None:
    first = await _connect(env, _info(port=9876))
    (row,) = await _rows(env)
    assert (row.instance_key, row.instance_role, row.port) == (None, "primary", 9876)
    assert (await _device(env)).ws_session_id == row.id

    # Unchanged legacy semantics: a second keyless connection is a reconnect
    # and takes the pointer (keyless rows are outside the duplicate rule).
    second = await _connect(env, _info(port=9876))
    rows = await _rows(env)
    assert (await _device(env)).ws_session_id == rows[-1].id
    assert env.manager.get_websocket(env.device_id) is second
    assert first.closed is None


async def test_legacy_runner_demoted_by_its_devenv_secondary_hint(env) -> None:
    await _connect(env, _info(port=9876, key="primary", role="primary"))
    await _connect(env, _info(port=9878, devenv_role="secondary"))
    rows = await _rows(env)
    assert (rows[1].instance_key, rows[1].instance_role) == (None, "secondary")
    device = await _device(env)
    assert device.port == 9876
    assert device.ws_session_id == rows[0].id


@pytest.mark.parametrize(
    "info",
    [
        {"instanceKey": "primary"},  # key without role
        {"instanceRole": "primary"},  # role without key
        {"instanceKey": "primary", "instanceRole": "tertiary"},
        {"instanceKey": "", "instanceRole": "secondary"},
        {"instanceKey": 7, "instanceRole": "secondary"},
        # Inconsistent: "primary" is reserved for, and required of, a primary.
        {"instanceKey": "runner:x", "instanceRole": "primary"},
        {"instanceKey": "primary", "instanceRole": "secondary"},
    ],
)
async def test_malformed_instance_claim_is_refused(env, info) -> None:
    sock = await _connect(env, {**_info(port=9876), **info})
    assert sock.closed is not None and sock.closed[0] == 4400
    assert "Invalid runner_info" in sock.sent[0]["message"]
    assert await _rows(env) == []


# ---------------------------------------------------------------------------
# Duplicate live key
# ---------------------------------------------------------------------------


async def test_duplicate_key_with_a_live_holder_refuses_the_newcomer(env) -> None:
    holder = await _connect(env, _info(port=9876, key="primary", role="primary"))
    holder_pk = (await _device(env)).ws_session_id

    impostor = await _connect(env, _info(port=9880, key="primary", role="primary"))

    assert impostor.closed is not None and impostor.closed[0] == 4409
    assert "duplicate" in (impostor.closed[1] or "")
    assert "Duplicate runner instance" in impostor.sent[0]["message"]
    rows = await _rows(env)
    assert [r.id for r in _open(rows)] == [holder_pk], "no row for the refused one"
    device = await _device(env)
    assert device.ws_session_id == holder_pk
    assert device.port == 9876, "the refused impostor must not write the port"
    assert env.manager.get_websocket(env.device_id) is holder


async def test_duplicate_secondary_key_is_refused_too(env) -> None:
    await _connect(env, _info(port=9877, key="runner:dup", role="secondary"))
    dup = await _connect(env, _info(port=9878, key="runner:dup", role="secondary"))
    assert dup.closed is not None and dup.closed[0] == 4409
    assert len(_open(await _rows(env))) == 1


async def test_duplicate_key_with_an_orphaned_holder_is_superseded(env) -> None:
    """An open row nobody here holds (a backend restart) must not block."""
    reconnect_first = await _connect(
        env, _info(port=9876, key="primary", role="primary")
    )
    orphan_pk = (await _device(env)).ws_session_id
    # Simulate a restart: the socket is gone from this process, the row and
    # pointer are left behind exactly as an unclean close leaves them.
    devices_ws._LIVE_SOCKETS.pop(orphan_pk, None)
    reconnect_first.application_state = WebSocketState.DISCONNECTED

    newcomer = await _connect(env, _info(port=9876, key="primary", role="primary"))

    assert newcomer.closed is None
    rows = await _rows(env)
    orphan = next(r for r in rows if r.id == orphan_pk)
    assert orphan.disconnected_at is not None, "the orphaned holder's row is closed"
    live = _open(rows)
    assert len(live) == 1 and live[0].id != orphan_pk
    assert (await _device(env)).ws_session_id == live[0].id


async def test_a_held_holder_that_does_not_answer_is_superseded(env) -> None:
    """Half-open: this process still holds the old socket, but nothing answers.

    However recent its last frame, a socket whose runner does not answer the
    liveness probe is the runner's own abandoned connection; refusing its
    reconnect would lock the runner out. The newcomer supersedes it and the
    old socket is closed (in the background).
    """
    old_sock = await _connect(env, _info(port=9876, key="primary", role="primary"))
    old_pk = (await _device(env)).ws_session_id
    assert old_pk is not None
    await _send(old_sock, {"type": "heartbeat", "status": "healthy"})  # fresh
    old_sock.answers_probes = False

    newcomer = await _connect(env, _info(port=9876, key="primary", role="primary"))

    assert newcomer.closed is None
    rows = await _rows(env)
    assert next(r for r in rows if r.id == old_pk).disconnected_at is not None
    live = _open(rows)
    assert len(live) == 1 and live[0].id != old_pk
    assert (await _device(env)).ws_session_id == live[0].id
    assert env.manager.get_websocket(env.device_id) is newcomer
    for _ in range(50):
        if old_sock.closed is not None:
            break
        await asyncio.sleep(0.02)
    assert old_sock.closed is not None, (
        "a superseded socket this process holds must be closed, not left "
        "running under a closed row"
    )


async def test_an_answering_holder_is_refused_however_quiet_it_was(env) -> None:
    """The probe, not frame recency, decides: a quiet but live holder wins."""
    holder = await _connect(env, _info(port=9876, key="primary", role="primary"))
    impostor = await _connect(env, _info(port=9880, key="primary", role="primary"))
    assert impostor.closed is not None and impostor.closed[0] == 4409
    assert any(p.get("type") == "http_request" for p in holder.sent), (
        "the holder was not probed"
    )


async def test_same_key_on_a_closed_socket_is_a_plain_reconnect(env) -> None:
    first = await _connect(env, _info(port=9877, key="runner:r", role="secondary"))
    await _disconnect(env, first)
    again = await _connect(env, _info(port=9877, key="runner:r", role="secondary"))
    assert again.closed is None
    assert len(_open(await _rows(env))) == 1


async def test_the_live_key_index_arbitrates_the_race(env) -> None:
    """Two OPEN rows with one key on one device cannot both be inserted."""
    await _connect(env, _info(port=9877, key="runner:x", role="secondary"))
    async with env.maker() as db:
        with pytest.raises(IntegrityError):
            await device_connection_crud.create_connection_record(
                db,
                device_id=env.device_id,
                user_id=env.user_id,
                instance_key="runner:x",
                instance_role="secondary",
                port=9878,
            )


async def test_the_race_loser_is_refused_not_crashed(env) -> None:
    """The IntegrityError arm: a concurrent winner slipped past the pre-check."""
    await _connect(env, _info(port=9877, key="runner:race", role="secondary"))

    async def _no_holders(*_: Any, **__: Any) -> list[Any]:
        return []  # the pre-check ran before the winner committed

    with patch.object(
        devices_ws.device_connection_crud,
        "get_open_connections_with_key",
        _no_holders,
    ):
        loser = await _connect(
            env, _info(port=9878, key="runner:race", role="secondary")
        )
    assert loser.closed is not None and loser.closed[0] == 4409
    assert len(_open(await _rows(env))) == 1


# ---------------------------------------------------------------------------
# Runner.instances on the wire
# ---------------------------------------------------------------------------


async def _seed_rows(env: SimpleNamespace) -> dict[str, int]:
    """Primary (pointed at), orphan primary, fresh + stale secondaries, legacy."""
    async with env.maker() as db:
        await device_crud.register_device(
            db,
            device_id=env.device_id,
            user_id=env.user_id,
            name="box",
            hostname="box",
            port=9876,
            capabilities=[],
            restate_enabled=False,
            restate_healthy=False,
        )

        async def mk(key: str | None, role: str | None, port: int | None) -> int:
            row = await device_connection_crud.create_connection_record(
                db,
                device_id=env.device_id,
                user_id=env.user_id,
                instance_key=key,
                instance_role=role,
                port=port,
            )
            return row.id

        pks = {
            "orphan": await mk(None, "primary", 9876),
            "primary": await mk("primary", "primary", 9876),
            "sec_9879": await mk("runner:b", "secondary", 9879),
            "sec_9877": await mk("runner:a", "secondary", 9877),
            "stale": await mk("runner:gone", "secondary", 9878),
        }
        await db.execute(
            text("UPDATE coord.devices SET ws_session_id = :p WHERE device_id = :d"),
            {"p": pks["primary"], "d": str(env.device_id)},
        )
        await db.execute(
            text(
                "UPDATE coord.device_connections SET connected_at = :t, "
                "last_seen_at = :t WHERE id = :id"
            ),
            {"t": utc_now() - timedelta(minutes=10), "id": pks["stale"]},
        )
        await db.commit()
    return pks


async def test_wire_lists_live_instances_primary_first_then_by_port(env) -> None:
    pks = await _seed_rows(env)
    async with env.maker() as db:
        device = await device_crud.get_device(db, env.device_id)
        assert device is not None
        (wire,) = await devices_ep.devices_to_wire(db, [device])

    assert [(i.instanceKey, i.instanceRole.value, i.port) for i in wire.instances] == [
        ("primary", "primary", 9876),
        ("runner:a", "secondary", 9877),
        ("runner:b", "secondary", 9879),
    ], (
        "the orphaned primary row (not the pointer) and the stale secondary "
        "must not be listed"
    )
    assert pks  # seeded
    assert wire.port == 9876


async def test_wire_keys_a_keyless_pointer_row_by_its_connection(env) -> None:
    await _seed_rows(env)
    async with env.maker() as db:
        rows = await device_connection_crud.list_live_instance_rows(db, [env.device_id])
    orphan = next(r for r in rows[env.device_id] if r.instance_key is None)
    (inst,) = devices_ep._live_instances([orphan], orphan.id)
    assert inst.instanceKey == f"connection:{orphan.id}"
    assert inst.instanceRole.value == "primary"


async def test_coord_row_wire_path_batches_one_query(env) -> None:
    await _seed_rows(env)
    rows = [
        {"device_id": str(env.device_id), "ws_session_id": None, "name": "box"},
        {"device_id": str(uuid4()), "ws_session_id": None, "name": "other"},
        {"device_id": "not-a-uuid", "name": "legacy"},
    ]
    async with env.maker() as db:
        pointer = (await device_crud.get_device(db, env.device_id)).ws_session_id  # type: ignore[union-attr]
        rows[0]["ws_session_id"] = pointer
        with patch.object(db, "execute", wraps=db.execute) as spy:
            wire = await devices_ep.device_rows_to_wire(db, rows)
    assert spy.await_count == 1, "instances must be batch-loaded, not per device"
    assert [len(w.instances) for w in wire] == [3, 0, 0]


# ---------------------------------------------------------------------------
# connection_cleanup sweep
# ---------------------------------------------------------------------------


async def test_sweep_ages_secondaries_by_their_own_heartbeat(env) -> None:
    pks = await _seed_rows(env)
    manager = MagicMock()
    # The device IS connected (its primary): the pre-change sweep would have
    # kept every row open, including the dead secondary, forever.
    manager.get_all_connected_ids = AsyncMock(return_value=[str(env.device_id)])
    manager.unregister = AsyncMock()
    with (
        patch.object(connection_cleanup, "AsyncSessionLocal", env.maker),
        patch.object(connection_cleanup, "get_redis", AsyncMock()),
        patch.object(
            connection_cleanup,
            "get_runner_websocket_manager",
            AsyncMock(return_value=manager),
        ),
    ):
        await connection_cleanup.cleanup_stale_connections()

    by_id = {r.id: r for r in await _rows(env)}
    assert by_id[pks["stale"]].disconnected_at is not None
    assert by_id[pks["sec_9877"]].disconnected_at is None
    assert by_id[pks["primary"]].disconnected_at is None
    manager.unregister.assert_not_awaited()
    assert (await _device(env)).ws_session_id == pks["primary"]


async def test_sweep_keeps_a_fresh_secondary_when_the_primary_is_away(env) -> None:
    pks = await _seed_rows(env)
    manager = MagicMock()
    manager.get_all_connected_ids = AsyncMock(return_value=[])
    manager.unregister = AsyncMock()
    with (
        patch.object(connection_cleanup, "AsyncSessionLocal", env.maker),
        patch.object(connection_cleanup, "get_redis", AsyncMock()),
        patch.object(
            connection_cleanup,
            "get_runner_websocket_manager",
            AsyncMock(return_value=manager),
        ),
    ):
        await connection_cleanup.cleanup_stale_connections()

    by_id = {r.id: r for r in await _rows(env)}
    assert by_id[pks["sec_9877"]].disconnected_at is None, (
        "a live secondary is not in the manager's registry by design; the "
        "device-keyed check must not close it"
    )
    assert by_id[pks["primary"]].disconnected_at is not None


async def test_a_primary_losing_the_insert_race_writes_nothing(env) -> None:
    """The index refuses it BEFORE it touches the device row's port."""
    await _connect(env, _info(port=9876, key="primary", role="primary"))

    async def _no_holders(*_: Any, **__: Any) -> list[Any]:
        return []  # another replica's pre-check ran before the winner committed

    with patch.object(
        devices_ws.device_connection_crud,
        "get_open_connections_with_key",
        _no_holders,
    ):
        loser = await _connect(env, _info(port=9880, key="primary", role="primary"))
    assert loser.closed is not None and loser.closed[0] == 4409
    device = await _device(env)
    assert device.port == 9876, "a refused duplicate primary overwrote the port"


async def test_a_pending_same_key_handshake_refuses_the_second(env) -> None:
    devices_ws._PENDING_KEYS.add((env.device_id, "runner:p"))
    try:
        sock = await _connect(env, _info(port=9877, key="runner:p", role="secondary"))
    finally:
        devices_ws._PENDING_KEYS.discard((env.device_id, "runner:p"))
    assert sock.closed is not None and sock.closed[0] == 4409
    assert await _rows(env) == []


@pytest.mark.parametrize("port", [70000, -1, "nope"])
async def test_an_out_of_range_port_is_refused_not_called_a_duplicate(
    env, port
) -> None:
    sock = await _connect(
        env, {**_info(port=9876, key="primary", role="primary"), "port": port}
    )
    assert sock.closed is not None and sock.closed[0] == 4400
    assert "port" in sock.sent[0]["message"]
    assert "Duplicate" not in sock.sent[0]["message"]


async def test_a_secondary_whose_row_was_closed_is_told_to_reconnect(env) -> None:
    await _connect(env, _info(port=9876, key="primary", role="primary"))
    secondary = await _connect(
        env, _info(port=9877, key="runner:swept", role="secondary")
    )
    sec_pk = (await _rows(env))[1].id
    async with env.maker() as db:
        await device_connection_crud.close_connection_records(db, [sec_pk])

    await _send(secondary, {"type": "heartbeat", "status": "healthy"})

    assert secondary.closed is not None and secondary.closed[0] == 1012


async def test_sweep_does_not_close_a_secondary_that_heartbeated_after_the_read(
    env,
) -> None:
    """The staleness test lives in the UPDATE, not only in the Python read."""
    pks = await _seed_rows(env)
    manager = MagicMock()
    manager.get_all_connected_ids = AsyncMock(return_value=[str(env.device_id)])
    manager.unregister = AsyncMock()
    # The heartbeat lands between the sweep's read and its UPDATE: stamp the
    # "stale" row fresh just before the first UPDATE statement executes.
    calls: dict[str, bool] = {}

    async def _stamp_fresh() -> None:
        async with env.maker() as db:
            await db.execute(
                text(
                    "UPDATE coord.device_connections SET last_seen_at = now() "
                    "WHERE id = :id"
                ),
                {"id": pks["stale"]},
            )
            await db.commit()

    real_execute = AsyncSession.execute

    async def _execute(self: AsyncSession, stmt: Any, *a: Any, **k: Any) -> Any:
        if getattr(stmt, "is_update", False) and not calls.get("stamped"):
            calls["stamped"] = True
            await _stamp_fresh()
        return await real_execute(self, stmt, *a, **k)

    with (
        patch.object(connection_cleanup, "AsyncSessionLocal", env.maker),
        patch.object(connection_cleanup, "get_redis", AsyncMock()),
        patch.object(
            connection_cleanup,
            "get_runner_websocket_manager",
            AsyncMock(return_value=manager),
        ),
        patch.object(AsyncSession, "execute", _execute),
    ):
        await connection_cleanup.cleanup_stale_connections()

    assert calls.get("stamped"), "the sweep issued no UPDATE for the stale row"
    by_id = {r.id: r for r in await _rows(env)}
    assert by_id[pks["stale"]].disconnected_at is None, (
        "a heartbeat that landed after the sweep's read was overwritten"
    )


async def test_a_primary_whose_row_was_closed_is_told_to_reconnect(env) -> None:
    """L4: the owner path too — no device writes, no heal onto a closed row."""
    primary = await _connect(env, _info(port=9876, key="primary", role="primary"))
    pk = (await _device(env)).ws_session_id
    assert pk is not None
    before = await _device(env)
    async with env.maker() as db:
        await device_connection_crud.close_connection_records(db, [pk])

    await _send(
        primary, {"type": "heartbeat", "status": "errored", "ui_error": {"x": 1}}
    )

    assert primary.closed is not None and primary.closed[0] == 1012
    after = await _device(env)
    assert after.ui_error == before.ui_error
    assert after.last_heartbeat == before.last_heartbeat


async def test_an_old_teardown_cannot_unregister_a_newer_socket(env) -> None:
    """M1: A's teardown is mid-await when B registers; B must survive it."""
    old = await _connect(env, _info(port=9876))  # legacy: keyless reconnects
    newer_holder: dict[str, Any] = {}

    real_release = devices_ws.remote_terminal_relay.release_source

    async def _release_then_newcomer_registers(ws: Any) -> None:
        await real_release(ws)
        if ws is old:
            # B registers while A's teardown is suspended here, after A
            # already knew it was "the registered socket".
            newer = _Socket(_info(port=9876))
            newer_holder["ws"] = newer
            env.manager.sockets[str(env.device_id)] = newer

    with patch.object(
        devices_ws.remote_terminal_relay,
        "release_source",
        _release_then_newcomer_registers,
    ):
        await _disconnect(env, old)

    assert env.manager.get_websocket(env.device_id) is newer_holder["ws"], (
        "the older socket's teardown unregistered the newer socket"
    )
    env.manager.unregister.assert_not_awaited()
    env.manager.publish_runner_disconnected.assert_not_awaited()


async def test_a_secondary_claim_yields_to_a_primary_registered_in_the_gap(env) -> None:
    """M-A: the DB claim succeeded, but a primary took the manager first."""
    squatter = object()  # a primary's socket, registered between the two steps
    real_claim = devices_ws.device_crud.claim_ws_session_if_unheld

    async def _claim_then_primary_registers(*a: Any, **k: Any) -> bool:
        claimed = await real_claim(*a, **k)
        env.manager.sockets[str(env.device_id)] = squatter
        return claimed

    with patch.object(
        devices_ws.device_crud,
        "claim_ws_session_if_unheld",
        _claim_then_primary_registers,
    ):
        lone = await _connect(env, _info(port=9877, key="runner:gap", role="secondary"))

    assert lone.closed is None
    assert env.manager.get_websocket(env.device_id) is squatter, (
        "the secondary overwrote a primary's manager registration"
    )
    sec_pk = (await _rows(env))[0].id
    assert (await _device(env)).ws_session_id != sec_pk, (
        "the secondary kept a DB claim it could not register"
    )
    env.manager.publish_runner_connected.assert_not_awaited()


async def test_a_stalled_probe_send_counts_as_not_alive(env) -> None:
    """M-B: a half-open holder whose send blocks must not block the newcomer."""
    holder = await _connect(env, _info(port=9876, key="primary", role="primary"))
    stalled = asyncio.Event()

    real_send = holder.send_json

    async def _send_blocks_on_probe(payload: dict[str, Any]) -> None:
        if payload.get("type") == "http_request":
            stalled.set()
            await asyncio.Event().wait()  # a full send buffer: never returns
        await real_send(payload)

    holder.send_json = _send_blocks_on_probe  # type: ignore[method-assign]
    started = asyncio.get_running_loop().time()
    newcomer = await _connect(env, _info(port=9876, key="primary", role="primary"))
    elapsed = asyncio.get_running_loop().time() - started

    assert stalled.is_set(), "the holder was not probed"
    assert newcomer.closed is None, "a stalled holder locked the newcomer out"
    assert elapsed < 5, f"the probe was not bounded by its timeout ({elapsed:.1f}s)"


async def test_sweep_skips_the_primary_arm_when_the_presence_scan_fails(env) -> None:
    """L-A: a Redis hiccup is not 'nobody is connected'."""
    pks = await _seed_rows(env)
    manager = MagicMock()
    manager.get_all_connected_ids = AsyncMock(return_value=None)  # scan failed
    manager.unregister = AsyncMock()
    with (
        patch.object(connection_cleanup, "AsyncSessionLocal", env.maker),
        patch.object(connection_cleanup, "get_redis", AsyncMock()),
        patch.object(
            connection_cleanup,
            "get_runner_websocket_manager",
            AsyncMock(return_value=manager),
        ),
    ):
        await connection_cleanup.cleanup_stale_connections()

    by_id = {r.id: r for r in await _rows(env)}
    assert by_id[pks["primary"]].disconnected_at is None, (
        "a failed presence scan closed a live primary's row"
    )
    assert by_id[pks["stale"]].disconnected_at is not None, (
        "the secondary arm needs no scan and must still run"
    )
    manager.unregister.assert_not_awaited()


async def test_state_repository_reports_a_failed_scan_as_none() -> None:
    from app.services.runner.state_repository import RunnerStateRepository

    redis = MagicMock()
    redis.keys = AsyncMock(side_effect=ConnectionError("redis down"))
    assert await RunnerStateRepository(redis).get_all_connected_ids() is None
    redis.keys = AsyncMock(return_value=[])
    assert await RunnerStateRepository(redis).get_all_connected_ids() == []


async def test_a_secondary_claim_waits_for_a_primarys_uncommitted_pointer(env) -> None:
    """L-D: the claim locks the device row, so it sees the primary's write."""
    await _seed_rows(env)
    async with env.maker() as db:
        await db.execute(
            text("UPDATE coord.devices SET ws_session_id = NULL WHERE device_id = :d"),
            {"d": str(env.device_id)},
        )
        await db.commit()
    rows = await _rows(env)
    primary_pk = next(r.id for r in rows if r.instance_key == "primary")
    secondary_pk = next(r.id for r in rows if r.instance_key == "runner:a")

    primary_tx = env.maker()
    try:
        # The primary's registration: pointer written, not yet committed.
        await primary_tx.execute(
            text("UPDATE coord.devices SET ws_session_id = :p WHERE device_id = :d"),
            {"p": primary_pk, "d": str(env.device_id)},
        )

        async def _claim() -> bool:
            async with env.maker() as db:
                return await device_crud.claim_ws_session_if_unheld(
                    db, device_id=env.device_id, connection_pk=secondary_pk
                )

        task = asyncio.create_task(_claim())
        for _ in range(20):
            await asyncio.sleep(0.05)
        assert not task.done(), "the claim did not wait on the device row lock"
        await primary_tx.commit()
        claimed = await asyncio.wait_for(task, timeout=10)
    finally:
        await primary_tx.close()

    assert claimed is False, "the claim displaced a primary that committed first"
    assert (await _device(env)).ws_session_id == primary_pk
