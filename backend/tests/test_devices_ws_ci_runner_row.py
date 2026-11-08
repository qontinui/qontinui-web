"""The device WebSocket refuses a CI-registrar row (plan
``2026-11-07-a-pre-registered-ci-registrar-row-keeps-the-squatters-owner-and-home``,
vet correction V1; coord finding ``3fc1ddb1``).

qontinui-coord's CI-runner registrar mints one ``coord.devices`` row per GitHub
Actions runner, under a device id anyone can compute from the runner's public
name, and marks it ``capabilities @> '["ci_runner"]'``. Only the registrar may
write such a row. Before this change the WS handshake rewrote it from ANY coord
JWT carrying ``device_id`` + ``user_id``: ``device_crud.register_device`` set
``user_id``, ``name``, ``hostname``, ``capabilities`` (dropping the marker) and
``capability_user_paired = true``. So a pairing JWT left over from a squat of
the id could re-own the runner and un-mark it, and an un-marked row is one
coord's renewal doors no longer refuse.

Pinned here, driving the real endpoint against the test Postgres:

* a JWT naming a marked row is closed 1008 ``device_is_ci_runner`` under every
  instance role and NOTHING is written: the device row is byte-identical
  (``to_jsonb(d.*)``), no connection row is opened, the manager is untouched,
  and the refusal precedes the duplicate-key arbitration, which would
  otherwise close an orphaned connection row;
* the same rows WITHOUT the marker still register (the control), and that
  door is shown rewriting exactly the columns the refusal protects;
* a mark that lands after the early read but before a primary's device
  upsert is refused by ``register_device``'s UPDATE, and the connection row
  the handshake had already opened is closed again (a mark landing later, or
  under a secondary's pointer claim, leaves a socket in the position of one
  admitted just before the mark: it writes liveness and pointer columns,
  never an identity column; not pinned here);
* ``register_device`` refuses a marked row on both of its key paths (the
  legacy one is ``runner_crud.register_runner``, the testing WS handler's),
  including a mark committed between its SELECT and its UPDATE, and leaves
  the caller's session usable (it rolls nothing back);
* the marker test is coord's predicate exactly, checked against coord's own
  SQL text over every stored shape that could be mistaken for the marker;
* a client cannot FORGE the marker (coord finding ``cde2133b``): a
  ``ci_runner`` element in ``runner_info.capabilities`` is dropped before any
  web writer stores the list, on a new row under every role and on an
  existing row, exactly as coord's register door drops it at ingest, while
  every other token is kept verbatim and in order;
* a secondary's pointer claim decides "unheld" from the row it locked, not
  the session's cached copy, so a primary that took the pointer meanwhile is
  never displaced (coord finding ``5f52242e``).

DB-backed on purpose: the guard is a statement's interaction with a row other
connections commit, which a mocked session cannot exercise.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from collections.abc import AsyncGenerator, Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import psycopg2
import pytest
import pytest_asyncio
import structlog
from fastapi import WebSocketDisconnect
from qontinui_schemas.common import utc_now
from sqlalchemy import Update, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.websockets import WebSocketState

from app.api.v1.endpoints import devices_ws
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud, runner_crud
from app.models.device import Device
from app.models.user import User

pytestmark = pytest.mark.asyncio

#: qontinui-coord ``NOT_A_CI_RUNNER_DEVICE_SQL``, verbatim: ``origin/main``
#: f9dfa35c6, ``crates/coord/src/ci_runner_registrar.rs:301-302`` (a Rust
#: string whose trailing ``\`` joins its two source lines with one space).
_COORD_NOT_A_CI_RUNNER_DEVICE_SQL = (
    """(d.capabilities IS NULL OR NOT d.capabilities @> '["ci_runner"]'::jsonb)"""
)

_CLOSE_POLICY_VIOLATION = 1008
_REFUSAL_REASON = "device_is_ci_runner"

#: How coord's registrar writes a row it owns (``register_planned``): no owner,
#: never paired, exactly the marker.
_REGISTRAR_ROW = "registrar_row"
#: An id squatted and claimed before the registrar first listed it: coord's
#: register UPSERT COALESCEs the stored owner, so the squatter's owner and
#: pairing flag survive the mark, and the marker sits beside a capability the
#: squat registered.
_CLAIMED_ROW = "claimed_row"
_SHAPES = (_REGISTRAR_ROW, _CLAIMED_ROW)

_ROLE_FIELDS: dict[str, dict[str, str]] = {
    "primary": {"instanceKey": "primary", "instanceRole": "primary"},
    "secondary": {"instanceKey": "runner:temp-1", "instanceRole": "secondary"},
    # A runner predating the fields: registered as the primary.
    "legacy": {},
}
_ROLES = tuple(_ROLE_FIELDS)
#: The roles that write the device row's own fields on connect.
_PRIMARY_FIELD_WRITERS = ("primary", "legacy")

_SEEDED_NAME = "gh-runner-merytshost"
_SEEDED_HOSTNAME = "gh-runner-merytshost@qontinui/qontinui-coord"

_DISCONNECT = object()


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


class _Socket:
    """A scripted device socket: ``runner_info`` first, then ``inbox`` frames."""

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
        # Set on the ``connected`` ack or on a close, whichever comes first.
        self.settled = asyncio.Event()
        # Set while the handler is parked in receive_json, i.e. it has finished
        # every frame delivered so far.
        self.idle = asyncio.Event()

    @property
    def acked(self) -> bool:
        return any(frame.get("type") == "connected" for frame in self.sent)

    async def accept(self) -> None:
        return None

    async def send_json(self, payload: dict[str, Any]) -> None:
        if self.application_state != WebSocketState.CONNECTED:
            raise WebSocketDisconnect(code=1006)
        self.sent.append(payload)
        if payload.get("type") == "connected":
            self.settled.set()

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
        self.settled.set()


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
        if self.sockets.get(str(runner_id)) is not websocket:
            return False
        await self.unregister(runner_id, user_id)
        return True

    def get_websocket(self, runner_id: Any) -> Any:
        return self.sockets.get(str(runner_id))

    @property
    def untouched(self) -> bool:
        return (
            self.register.await_count == 0
            and self.publish_runner_connected.await_count == 0
            and not self.sockets
        )


@pytest_asyncio.fixture
async def env(test_engine) -> AsyncGenerator[SimpleNamespace, None]:
    """The token holder (a committed user), a device id, the patched externals.

    Each test seeds the ``coord.devices`` row itself. Rows are COMMITTED, not
    held in ``async_db_session``'s rolled-back transaction: the endpoint opens
    its own sessions, and the race tests commit the registrar's mark from a
    second connection while the code under test is mid-statement.
    """
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        user = User(
            email=f"cirow_{uuid4()}@example.com",
            username=f"cirow_{uuid4().hex[:8]}",
            full_name="CI Runner Row Test",
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
            async with maker() as db:
                await db.execute(
                    text("DELETE FROM coord.devices WHERE device_id = :d"),
                    {"d": str(device_id)},
                )
                await db.execute(
                    text("DELETE FROM auth.users WHERE id = :u"), {"u": str(user.id)}
                )
                await db.commit()


async def _seed(env: SimpleNamespace, shape: str, *, marked: bool) -> None:
    """Commit the device row the token names, in ``shape``, with or without the marker."""
    claimed = shape == _CLAIMED_ROW
    if claimed:
        capabilities = ["os:linux", "ci_runner"] if marked else ["os:linux"]
    else:
        capabilities = ["ci_runner"] if marked else []
    async with env.maker() as db:
        db.add(
            Device(
                device_id=env.device_id,
                user_id=env.user_id if claimed else None,
                name=_SEEDED_NAME,
                hostname=_SEEDED_HOSTNAME,
                os="linux",
                capabilities=capabilities,
                capability_user_paired=claimed,
                paired_at=utc_now() if claimed else None,
                state="healthy",
                derived_status="offline",
                ci_runner_status="idle",
                ci_runner_labels=["self-hosted", "linux", "x64"],
                last_seen_at=utc_now(),
            )
        )
        await db.commit()


async def _registrar_marks(env: SimpleNamespace) -> None:
    """coord's registrar lists the runner: its UPSERT writes the marker and keeps the
    stored owner (``user_id = COALESCE(coord.devices.user_id, …)``)."""
    async with env.maker() as db:
        await db.execute(
            text(
                "UPDATE coord.devices SET capabilities = CAST(:caps AS jsonb), "
                "last_seen_at = now() WHERE device_id = :d"
            ),
            {"caps": json.dumps(["ci_runner"]), "d": str(env.device_id)},
        )
        await db.commit()


async def _row_image(env: SimpleNamespace) -> str | None:
    """The whole stored row as Postgres renders it: equal text, identical row."""
    async with env.maker() as db:
        return (
            await db.execute(
                text(
                    "SELECT to_jsonb(d.*)::text FROM coord.devices d "
                    "WHERE d.device_id = :d"
                ),
                {"d": str(env.device_id)},
            )
        ).scalar_one_or_none()


async def _identity(env: SimpleNamespace) -> tuple[Any, ...]:
    """The five columns the handshake used to overwrite on a marked row."""
    async with env.maker() as db:
        row = (
            await db.execute(
                text(
                    "SELECT user_id, capabilities, capability_user_paired, "
                    "hostname, name FROM coord.devices WHERE device_id = :d"
                ),
                {"d": str(env.device_id)},
            )
        ).one()
    return tuple(row)


async def _connection_images(env: SimpleNamespace) -> list[str]:
    async with env.maker() as db:
        return list(
            (
                await db.execute(
                    text(
                        "SELECT to_jsonb(c.*)::text FROM coord.device_connections c "
                        "WHERE c.device_id = :d ORDER BY c.id"
                    ),
                    {"d": str(env.device_id)},
                )
            ).scalars()
        )


async def _connection_rows(env: SimpleNamespace) -> list[dict[str, Any]]:
    return [json.loads(image) for image in await _connection_images(env)]


def _info(role: str) -> dict[str, Any]:
    return {
        "type": "runner_info",
        "name": "squatter-box",
        "hostname": "squatter.example",
        "port": 9877 if role == "secondary" else 9876,
        "capabilities": ["gui_automation"],
        **_ROLE_FIELDS[role],
    }


async def _handshake(env: SimpleNamespace, info: dict[str, Any]) -> _Socket:
    """Drive the served endpoint for one socket until it acks or is closed.

    A refused handler is awaited to its return, so every write it might have
    made has been made before the caller looks.
    """
    sock = _Socket(info)
    task = asyncio.create_task(devices_ws.websocket_device_unified_endpoint(sock))
    env.tasks.append((sock, task))
    waiter = asyncio.create_task(sock.settled.wait())
    done, _ = await asyncio.wait(
        {waiter, task}, timeout=10, return_when=asyncio.FIRST_COMPLETED
    )
    waiter.cancel()
    assert done, "the handshake neither acked nor ended"
    if sock.closed is not None:
        await asyncio.wait_for(task, timeout=5)
    return sock


async def _send(sock: _Socket, frame: dict[str, Any]) -> None:
    """Deliver one frame and return once the handler has fully processed it:
    it is parked in ``receive_json`` again with nothing queued."""
    sock.idle.clear()
    sock.inbox.put_nowait(frame)
    for _ in range(500):
        await asyncio.sleep(0.01)
        if (sock.inbox.empty() and sock.idle.is_set()) or sock.closed is not None:
            return
    raise AssertionError("the handler did not finish processing the frame")


async def _disconnect(env: SimpleNamespace, sock: _Socket) -> None:
    """End one socket and wait for its handler, cleanup included, to return."""
    sock.inbox.put_nowait(_DISCONNECT)
    for s, task in env.tasks:
        if s is sock:
            await asyncio.wait_for(task, timeout=5)


def _events(logs: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [entry for entry in logs if entry.get("event") == name]


def _assert_refused(sock: _Socket) -> None:
    assert not sock.acked, f"a marked row was admitted: {sock.sent!r}"
    assert sock.closed == (_CLOSE_POLICY_VIOLATION, _REFUSAL_REASON)
    (frame,) = sock.sent
    assert frame["type"] == "error"
    assert _REFUSAL_REASON in frame["message"]


# ---------------------------------------------------------------------------
# The entry point
# ---------------------------------------------------------------------------


async def test_the_endpoint_driven_here_is_the_served_device_websocket() -> None:
    """Every test below enters through the handler the app mounts here."""
    from app.main import app

    served = [
        getattr(route, "endpoint", None)
        for route in app.routes
        if getattr(route, "path", None) == "/api/v1/devices/ws"
    ]
    assert served == [devices_ws.websocket_device_unified_endpoint]


# ---------------------------------------------------------------------------
# A marked row: refused, and nothing written
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("shape", _SHAPES)
@pytest.mark.parametrize("role", _ROLES)
async def test_a_token_naming_a_ci_runner_row_is_refused_and_writes_nothing(
    env, role: str, shape: str
) -> None:
    await _seed(env, shape, marked=True)
    before = await _row_image(env)
    identity_before = await _identity(env)

    with structlog.testing.capture_logs() as logs:
        sock = await _handshake(env, _info(role))

    _assert_refused(sock)
    assert await _identity(env) == identity_before, (
        "user_id, capabilities, capability_user_paired, hostname or name moved"
    )
    assert await _row_image(env) == before, "the marked row is not byte-identical"
    assert await _connection_images(env) == [], "a connection row was opened"
    assert env.manager.untouched, "the refused socket reached the relay manager"
    assert devices_ws._LIVE_SOCKETS == {}
    assert devices_ws._PENDING_KEYS == set()
    (refusal,) = _events(logs, "devices_ws_ci_runner_row_refused")
    assert refusal["log_level"] == "warning"
    assert refusal["device_id"] == str(env.device_id)
    assert refusal["instance_role"] == (
        "secondary" if role == "secondary" else "primary"
    )
    assert _events(logs, "devices_ws_ci_runner_row_marked_mid_handshake") == []


async def test_the_refusal_precedes_the_duplicate_key_arbitration(env) -> None:
    """The arbitration closes an open row holding the newcomer's key when no live
    socket on this process answers for it. A refused newcomer must not get
    that far: the orphan stays open, byte for byte."""
    await _seed(env, _CLAIMED_ROW, marked=True)
    async with env.maker() as db:
        await device_connection_crud.create_connection_record(
            db,
            device_id=env.device_id,
            user_id=env.user_id,
            instance_key="primary",
            instance_role="primary",
            port=9876,
        )
    connections_before = await _connection_images(env)
    (orphan,) = [json.loads(image) for image in connections_before]
    assert orphan["disconnected_at"] is None
    before = await _row_image(env)

    sock = await _handshake(env, _info("primary"))

    _assert_refused(sock)
    assert await _connection_images(env) == connections_before, (
        "the refused handshake closed (or wrote) a connection row"
    )
    assert await _row_image(env) == before
    assert env.manager.untouched


async def test_a_concurrent_same_key_handshake_does_not_change_the_refusal(
    env,
) -> None:
    """Two handshakes presenting the same instanceKey race on a marked row and
    BOTH are refused ``device_is_ci_runner``. Behind the in-memory pending-key
    check the second would be refused as a duplicate instance instead (4409,
    "stop one of them"), which names the wrong problem."""
    await _seed(env, _CLAIMED_ROW, marked=True)
    before = await _row_image(env)
    real_read = device_crud.carries_ci_runner_marker
    entered = asyncio.Event()
    release = asyncio.Event()

    async def the_first_read_waits(db: Any, device_id: Any) -> bool:
        if not entered.is_set():
            entered.set()
            await release.wait()
        return await real_read(db, device_id)

    with patch.object(device_crud, "carries_ci_runner_marker", the_first_read_waits):
        first = asyncio.create_task(_handshake(env, _info("primary")))
        await asyncio.wait_for(entered.wait(), timeout=5)
        second = await _handshake(env, _info("primary"))
        release.set()
        first_sock = await asyncio.wait_for(first, timeout=15)

    _assert_refused(second)
    _assert_refused(first_sock)
    assert await _row_image(env) == before
    assert await _connection_images(env) == []
    assert env.manager.untouched


# ---------------------------------------------------------------------------
# The control: the same rows without the marker still register
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("shape", _SHAPES)
@pytest.mark.parametrize("role", _ROLES)
async def test_the_same_row_without_the_marker_still_registers(
    env, role: str, shape: str
) -> None:
    await _seed(env, shape, marked=False)
    identity_before = await _identity(env)

    sock = await _handshake(env, _info(role))

    assert sock.closed is None, f"an unmarked row was refused: {sock.closed!r}"
    assert sock.acked
    (row,) = await _connection_rows(env)
    assert row["disconnected_at"] is None
    expected_role = "secondary" if role == "secondary" else "primary"
    assert row["instance_role"] == expected_role
    if role in _PRIMARY_FIELD_WRITERS:
        # Exactly the columns the refusal protects, rewritten from the token
        # and runner_info, marker-free: what a marked row used to suffer.
        assert await _identity(env) == (
            env.user_id,
            ["gui_automation"],
            True,
            "squatter.example",
            "squatter-box",
        )
        assert env.manager.get_websocket(env.device_id) is sock
    else:
        assert await _identity(env) == identity_before, (
            "a secondary never rewrites the device row's own fields"
        )


# ---------------------------------------------------------------------------
# A mark that lands after the early read
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", _ROLES)
async def test_a_mark_landing_mid_handshake_is_refused_by_the_write(
    env, role: str
) -> None:
    """The early read saw an unmarked row, and the registrar marks it while the
    handshake opens its connection row. The device-row write that follows
    must refuse rather than write a row the early read never saw marked. For
    a primary that write is its upsert, which would strip the marker. For a
    secondary it is the pointer claim, which would write ``ws_session_id``,
    ``ws_connected_at`` and ``port``."""
    await _seed(env, _CLAIMED_ROW, marked=False)
    real_create = device_connection_crud.create_connection_record
    marked: list[str | None] = []

    async def create_then_the_registrar_marks(db: Any, **kwargs: Any) -> Any:
        record = await real_create(db, **kwargs)
        await _registrar_marks(env)
        marked.append(await _row_image(env))
        return record

    with (
        patch.object(
            device_connection_crud,
            "create_connection_record",
            create_then_the_registrar_marks,
        ),
        structlog.testing.capture_logs() as logs,
    ):
        sock = await _handshake(env, _info(role))

    assert len(marked) == 1, "the registrar's mark never landed mid-handshake"
    _assert_refused(sock)
    assert await _row_image(env) == marked[0], (
        "the device row is not exactly what the registrar's write left"
    )
    assert (await _identity(env))[1] == ["ci_runner"], "the marker was stripped"
    (row,) = await _connection_rows(env)
    assert row["disconnected_at"] is not None, (
        "the connection row the handshake opened was left open"
    )
    assert env.manager.untouched
    assert devices_ws._LIVE_SOCKETS == {}
    assert len(_events(logs, "devices_ws_ci_runner_row_marked_mid_handshake")) == 1
    assert len(_events(logs, "devices_ws_ci_runner_row_refused")) == 1


@pytest.mark.parametrize("role", _PRIMARY_FIELD_WRITERS)
async def test_a_mark_landing_before_the_primarys_pointer_write_refuses_it(
    env, role: str
) -> None:
    """The mark lands after the primary's upsert succeeded (the row was still
    unmarked then) and before ``take_ws_session``. That write refuses too:
    pointer and port never land on the marked row, and the socket is not
    admitted."""
    await _seed(env, _CLAIMED_ROW, marked=False)
    real_register = device_crud.register_device
    marked: list[str | None] = []

    async def register_then_the_registrar_marks(*args: Any, **kwargs: Any) -> Any:
        record = await real_register(*args, **kwargs)
        await _registrar_marks(env)
        marked.append(await _row_image(env))
        return record

    with (
        patch.object(device_crud, "register_device", register_then_the_registrar_marks),
        structlog.testing.capture_logs() as logs,
    ):
        sock = await _handshake(env, _info(role))

    assert len(marked) == 1, "the mark never landed before take_ws_session"
    _assert_refused(sock)
    image = await _row_image(env)
    assert image == marked[0], "take_ws_session wrote the marked row"
    assert json.loads(image or "{}")["ws_session_id"] is None
    (row,) = await _connection_rows(env)
    assert row["disconnected_at"] is not None, (
        "the connection row the handshake opened was left open"
    )
    assert env.manager.untouched
    assert len(_events(logs, "devices_ws_ci_runner_row_marked_mid_handshake")) == 1


def _registrar_inserts(device_id: UUID, *, marked: bool) -> str:
    """Commit, on a connection of its own, the row the registrar inserts for
    ``device_id`` (``marked=False`` stands for any other first writer), and
    return its image rendered in UTC."""
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO coord.devices (device_id, name, hostname, state, "
                "capabilities, ci_runner_status, ci_runner_labels, last_seen_at) "
                "VALUES (%s, %s, %s, 'healthy', %s::jsonb, 'idle', "
                "ARRAY['self-hosted', 'linux', 'x64'], now())",
                (
                    str(device_id),
                    _SEEDED_NAME,
                    _SEEDED_HOSTNAME,
                    json.dumps(["ci_runner"] if marked else []),
                ),
            )
            cur.execute("SET LOCAL TIME ZONE 'UTC'")
            cur.execute(
                "SELECT to_jsonb(d.*)::text FROM coord.devices d "
                "WHERE d.device_id = %s",
                (str(device_id),),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    assert row is not None
    return str(row[0])


async def _row_image_utc(env: SimpleNamespace) -> str | None:
    """:func:`_row_image` with timestamps rendered in UTC, to compare with an
    image another driver rendered."""
    async with env.maker() as db:
        await db.execute(text("SET LOCAL TIME ZONE 'UTC'"))
        return (
            await db.execute(
                text(
                    "SELECT to_jsonb(d.*)::text FROM coord.devices d "
                    "WHERE d.device_id = :d"
                ),
                {"d": str(env.device_id)},
            )
        ).scalar_one_or_none()


@contextlib.contextmanager
def _registrar_inserts_first(
    env: SimpleNamespace, *, marked: bool
) -> Iterator[list[str]]:
    """Just before web's INSERT of ``env.device_id`` runs, the registrar commits
    its own row for the same id: the first-sight race on a new device. Yields
    the list that receives that row's image."""
    images: list[str] = []

    def before_insert(mapper: Any, connection: Any, target: Device) -> None:
        if target.device_id == env.device_id and not images:
            images.append(_registrar_inserts(env.device_id, marked=marked))

    event.listen(Device, "before_insert", before_insert)
    try:
        yield images
    finally:
        event.remove(Device, "before_insert", before_insert)


@pytest.mark.parametrize("role", _ROLES)
async def test_an_insert_race_with_the_registrar_is_refused_not_failed(
    env, role: str
) -> None:
    """A new device id: the early read and the writer's SELECT both see no row,
    and the registrar inserts it, marked, just before the writer's INSERT (a
    primary's ``register_device``, a secondary's ``ensure_device_for_secondary``).
    The INSERT's collision is a refusal, 1008 ``device_is_ci_runner``, not a
    1011 internal error, and nothing of web's lands."""
    with (
        _registrar_inserts_first(env, marked=True) as inserted,
        structlog.testing.capture_logs() as logs,
    ):
        sock = await _handshake(env, _info(role))

    assert len(inserted) == 1, "the registrar's insert never raced the handshake"
    _assert_refused(sock)
    assert await _row_image_utc(env) == inserted[0], "web wrote the registrar's row"
    assert await _connection_images(env) == [], "a connection row was opened"
    assert env.manager.untouched
    assert len(_events(logs, "devices_ws_ci_runner_row_refused")) == 1


@pytest.mark.parametrize("racer", ["marked", "unmarked"])
@pytest.mark.parametrize("writer", ["register_device", "ensure_device_for_secondary"])
async def test_an_insert_collision_is_refused_only_for_a_marked_row(
    env, writer: str, racer: str
) -> None:
    """The same race at each INSERT, called directly. A collision with a marked
    row is the registrar's and raises ``DeviceIsCiRunnerError``. A collision
    with an unmarked row is not this guard's business and propagates as the
    ``IntegrityError`` it is."""
    fields: dict[str, Any] = {
        "device_id": env.device_id,
        "user_id": env.user_id,
        "name": "web-name",
        "hostname": "squatter.example",
        "capabilities": ["gui_automation"],
    }
    expected: type[Exception] = (
        device_crud.DeviceIsCiRunnerError if racer == "marked" else IntegrityError
    )
    with _registrar_inserts_first(env, marked=racer == "marked") as inserted:
        async with env.maker() as db:
            with pytest.raises(expected):
                if writer == "ensure_device_for_secondary":
                    await device_crud.ensure_device_for_secondary(db, **fields)
                else:
                    await device_crud.register_device(
                        db,
                        port=9876,
                        restate_enabled=False,
                        restate_healthy=False,
                        **fields,
                    )

    assert len(inserted) == 1, "the racing insert never landed"
    assert await _row_image_utc(env) == inserted[0], "web wrote the racing row"


async def test_a_non_owner_heartbeat_never_claims_a_marked_rows_pointer(env) -> None:
    """A secondary admitted BEFORE the mark (the documented residual) keeps its
    socket. Its heartbeat's pointer claim declines the marked row quietly: no
    claim, no error, the socket left open."""
    await _seed(env, _CLAIMED_ROW, marked=False)
    primary = await _handshake(env, _info("primary"))
    secondary = await _handshake(env, _info("secondary"))
    assert primary.acked and secondary.acked
    assert env.manager.get_websocket(env.device_id) is primary
    await _registrar_marks(env)
    await _disconnect(env, primary)  # its cleanup clears the pointer
    assert json.loads(await _row_image(env) or "{}")["ws_session_id"] is None

    with structlog.testing.capture_logs() as logs:
        await _send(secondary, {"type": "heartbeat", "status": "healthy"})

    assert secondary.closed is None, "the residual socket was closed"
    image = json.loads(await _row_image(env) or "{}")
    assert image["ws_session_id"] is None, "the secondary claimed the pointer"
    assert image["capabilities"] == ["ci_runner"]
    assert env.manager.get_websocket(env.device_id) is None
    assert _events(logs, "devices_ws_secondary_claim_failed") == []
    assert _events(logs, "devices_ws_secondary_claimed_unheld_pointer") == []


# ---------------------------------------------------------------------------
# The pointer decision reads the locked row, not the session cache
# (coord finding 5f52242e)
# ---------------------------------------------------------------------------


async def _a_primary_takes_the_pointer(
    env: SimpleNamespace, create: Any = device_connection_crud.create_connection_record
) -> int:
    """On a session of its own, a primary opens its connection row and takes the
    device's pointer. Returns that connection's pk."""
    async with env.maker() as other:
        conn = await create(
            other,
            device_id=env.device_id,
            user_id=env.user_id,
            instance_key="primary",
            instance_role="primary",
            port=9876,
        )
        await device_crud.take_ws_session(
            other,
            device_id=env.device_id,
            connection_pk=conn.id,
            connected_at=conn.connected_at,
            port=9876,
        )
        return int(conn.id)


async def test_a_pointer_claim_reads_the_locked_row_not_the_session_cache(
    env,
) -> None:
    """This session loads the device while the pointer is unheld, as the
    handshake's ``get_device`` does. A primary then takes the pointer on another
    session. The secondary's claim, made on the first session, must see that
    pointer under its lock and decline, not displace it."""
    await _seed(env, _CLAIMED_ROW, marked=False)
    async with env.maker() as db:
        loaded = await device_crud.get_device(db, env.device_id)
        assert loaded is not None and loaded.ws_session_id is None
        secondary = await device_connection_crud.create_connection_record(
            db,
            device_id=env.device_id,
            user_id=env.user_id,
            instance_key="runner:temp-1",
            instance_role="secondary",
            port=9877,
        )
        secondary_pk = secondary.id
        primary_pk = await _a_primary_takes_the_pointer(env)
        claimed = await device_crud.claim_ws_session_if_unheld(
            db, device_id=env.device_id, connection_pk=secondary_pk
        )

    assert claimed is False, "the claim displaced a live primary"
    image = json.loads(await _row_image(env) or "{}")
    assert image["ws_session_id"] == primary_pk
    assert image["port"] == 9876


async def test_a_secondary_does_not_displace_a_primary_that_took_the_pointer_meanwhile(
    env,
) -> None:
    """The same race through the served endpoint: a primary takes the pointer
    while the secondary's handshake opens its connection row. The secondary is
    admitted as a non-owner and never becomes the relay socket."""
    await _seed(env, _CLAIMED_ROW, marked=False)
    real_create = device_connection_crud.create_connection_record
    primary_pks: list[int] = []

    async def create_then_a_primary_takes_the_pointer(db: Any, **kwargs: Any) -> Any:
        record = await real_create(db, **kwargs)
        primary_pks.append(await _a_primary_takes_the_pointer(env, create=real_create))
        return record

    with patch.object(
        device_connection_crud,
        "create_connection_record",
        create_then_a_primary_takes_the_pointer,
    ):
        sock = await _handshake(env, _info("secondary"))

    assert len(primary_pks) == 1, "the primary never took the pointer mid-handshake"
    assert sock.closed is None and sock.acked
    image = json.loads(await _row_image(env) or "{}")
    assert image["ws_session_id"] == primary_pks[0], "the secondary displaced it"
    assert image["port"] == 9876
    assert env.manager.get_websocket(env.device_id) is None


# ---------------------------------------------------------------------------
# register_device: the statement is the guard
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("when", ["before_the_call", "between_select_and_update"])
@pytest.mark.parametrize("key", ["device_id", "user_id_and_name"])
async def test_register_device_refuses_a_ci_runner_row(
    env, key: str, when: str
) -> None:
    """Both key paths, including the legacy one the testing WS handler reaches
    through ``runner_crud.register_runner``; and a mark committed between the
    SELECT that finds the row and the UPDATE that would rewrite it. The
    refusal rolls nothing back, so an object the caller's session already
    holds stays usable: the testing handler carries on after catching it."""
    await _seed(env, _CLAIMED_ROW, marked=when == "before_the_call")
    expected: list[str | None] = [await _row_image(env)]

    async with env.maker() as db:
        held = await db.get(User, env.user_id)
        assert held is not None
        real_execute = db.execute

        async def execute(statement: Any, *args: Any, **kwargs: Any) -> Any:
            if (
                when == "between_select_and_update"
                and isinstance(statement, Update)
                and len(expected) == 1
            ):
                await _registrar_marks(env)
                expected.append(await _row_image(env))
            return await real_execute(statement, *args, **kwargs)

        fields: dict[str, Any] = {
            "user_id": env.user_id,
            "name": _SEEDED_NAME,
            "hostname": "squatter.example",
            "port": 9876,
            "capabilities": ["gui_automation"],
            "restate_enabled": False,
            "restate_healthy": False,
        }
        with (
            patch.object(db, "execute", execute),
            pytest.raises(device_crud.DeviceIsCiRunnerError) as refused,
        ):
            if key == "device_id":
                await device_crud.register_device(db, device_id=env.device_id, **fields)
            else:
                await runner_crud.register_runner(db, **fields)

        # Expired by a rollback, this attribute would need a lazy load, which
        # an AsyncSession refuses (MissingGreenlet).
        assert held.email.startswith("cirow_"), "the refusal expired the session"

    assert refused.value.device_id == env.device_id
    if when == "between_select_and_update":
        assert len(expected) == 2, "the registrar's mark never landed mid-call"
        marker_left = ["ci_runner"]  # what ``_registrar_marks`` writes
    else:
        marker_left = ["os:linux", "ci_runner"]  # the seeded claimed row
    assert await _row_image(env) == expected[-1], "the row is not byte-identical"
    assert (await _identity(env))[1] == marker_left, "the marker was stripped"


# ---------------------------------------------------------------------------
# The marker test is coord's predicate, exactly
# ---------------------------------------------------------------------------


_STORED_SHAPES: dict[str, tuple[Any, bool]] = {
    "the_registrar_list": (["ci_runner"], True),
    "marker_among_others": (["os:linux", "ci_runner"], True),
    "empty_list": ([], False),
    "another_capability": (["gui_automation"], False),
    "longer_element": (["ci_runner_v2"], False),
    "other_case": (["CI_RUNNER"], False),
    "nested_array": ([["ci_runner"]], False),
    "object_key": ({"ci_runner": True}, False),
    "bare_string": ("ci_runner", False),
}


@pytest.mark.parametrize(
    ("stored", "is_marked"),
    list(_STORED_SHAPES.values()),
    ids=list(_STORED_SHAPES),
)
async def test_the_marker_is_coords_predicate_exactly(
    env, stored: Any, is_marked: bool
) -> None:
    async with env.maker() as db:
        assert await device_crud.carries_ci_runner_marker(db, env.device_id) is False, (
            "no row is not a marked row"
        )
        await db.execute(
            text(
                "INSERT INTO coord.devices "
                "(device_id, user_id, name, hostname, state, capabilities) "
                "VALUES (:d, :u, 'n', 'h', 'healthy', CAST(:caps AS jsonb))"
            ),
            {
                "d": str(env.device_id),
                "u": str(env.user_id),
                "caps": json.dumps(stored),
            },
        )
        await db.commit()
        coords = (
            await db.execute(
                text(
                    f"SELECT NOT {_COORD_NOT_A_CI_RUNNER_DEVICE_SQL} "
                    "FROM coord.devices d WHERE d.device_id = :d"
                ),
                {"d": str(env.device_id)},
            )
        ).scalar_one()
        ours = await device_crud.carries_ci_runner_marker(db, env.device_id)
    assert coords is is_marked, "the expectation disagrees with coord's own SQL"
    assert ours is is_marked

    # The write guard reads the same predicate.
    async with env.maker() as db:
        call = device_crud.register_device(
            db,
            device_id=env.device_id,
            user_id=env.user_id,
            name="n",
            hostname="h",
            port=9876,
            capabilities=["gui_automation"],
            restate_enabled=False,
            restate_healthy=False,
        )
        if is_marked:
            with pytest.raises(device_crud.DeviceIsCiRunnerError):
                await call
        else:
            record = await call
            assert record.capabilities == ["gui_automation"]


# ---------------------------------------------------------------------------
# A client cannot forge the marker (coord finding cde2133b)
# ---------------------------------------------------------------------------

#: A runner_info list carrying the marker twice among ordinary tokens.
_FORGED = ["gui_automation", "ci_runner", "os:linux", "ci_runner"]
#: What coord's register door stores from it, and what web must store.
_FORGED_KEPT = ["gui_automation", "os:linux"]
#: No marker, but each way a lazy drop could over-reach: lookalikes, another
#: case, a duplicate and a governed token, all kept byte-for-byte and in order.
_VERBATIM = [
    "gui_automation",
    "ci_runner_v2",
    "CI_RUNNER",
    "os:linux",
    "gui_automation",
    "cred:gh",
]

_DROPPED = "device_capabilities_ci_runner_dropped"


def _info_with(role: str, capabilities: list[Any]) -> dict[str, Any]:
    return {**_info(role), "capabilities": list(capabilities)}


async def _stored_capabilities(env: SimpleNamespace) -> Any:
    return (await _identity(env))[1]


async def _is_marked(env: SimpleNamespace) -> bool:
    async with env.maker() as db:
        return await device_crud.carries_ci_runner_marker(db, env.device_id)


@pytest.mark.parametrize("role", _ROLES)
async def test_a_forged_marker_never_reaches_a_new_row(env, role: str) -> None:
    """No row yet. A primary's upsert, or a secondary's
    ``ensure_device_for_secondary``, creates it from a list carrying the
    marker, and creates it unmarked: the socket registers like any other
    device instead of minting a row coord would take for the registrar's."""
    with structlog.testing.capture_logs() as logs:
        sock = await _handshake(env, _info_with(role, _FORGED))

    assert sock.closed is None, f"the handshake was refused: {sock.closed!r}"
    assert sock.acked
    assert await _stored_capabilities(env) == _FORGED_KEPT
    assert await _is_marked(env) is False
    # Once per handshake, however many writers ran: a new primary calls
    # register_device twice, and only the handshake's own drop finds anything.
    (drop,) = _events(logs, _DROPPED)
    assert drop["device_id"] == str(env.device_id)
    assert drop["log_level"] == "warning"
    assert drop["dropped"] == 2


@pytest.mark.parametrize("role", _PRIMARY_FIELD_WRITERS)
async def test_a_forged_marker_never_reaches_an_existing_row(env, role: str) -> None:
    """An existing unmarked row: the primary's UPDATE writes the client's list
    without the marker, so the row stays one this door may write."""
    await _seed(env, _CLAIMED_ROW, marked=False)

    with structlog.testing.capture_logs() as logs:
        sock = await _handshake(env, _info_with(role, _FORGED))

    assert sock.closed is None, f"the handshake was refused: {sock.closed!r}"
    assert sock.acked
    assert await _stored_capabilities(env) == _FORGED_KEPT
    assert await _is_marked(env) is False
    (drop,) = _events(logs, _DROPPED)
    assert drop["device_id"] == str(env.device_id)


@pytest.mark.parametrize("role", _ROLES)
async def test_other_capabilities_are_kept_verbatim(env, role: str) -> None:
    """The control: a list without the marker reaches the new row byte-for-byte,
    order and duplicates included, and no drop is logged."""
    with structlog.testing.capture_logs() as logs:
        sock = await _handshake(env, _info_with(role, _VERBATIM))

    assert sock.closed is None, f"the handshake was refused: {sock.closed!r}"
    assert sock.acked
    assert await _stored_capabilities(env) == _VERBATIM
    assert _events(logs, _DROPPED) == []


@pytest.mark.parametrize(
    "writer",
    [
        "register_device_insert",
        "register_device_update",
        "register_runner_legacy_update",
        "ensure_device_for_secondary_insert",
    ],
)
async def test_no_device_crud_writer_stores_a_wire_supplied_marker(
    env, writer: str
) -> None:
    """Every web writer of ``coord.devices.capabilities``, called directly: both
    arms of ``register_device`` and the secondary's insert (the WS handshake's
    writers), and the legacy ``(user_id, name)`` path the testing WS handler
    reaches through ``runner_crud.register_runner``."""
    if writer.endswith("_update"):
        await _seed(env, _CLAIMED_ROW, marked=False)
    fields: dict[str, Any] = {
        "user_id": env.user_id,
        "name": _SEEDED_NAME,
        "hostname": "squatter.example",
        "capabilities": list(_FORGED),
    }
    async with env.maker() as db:
        if writer == "ensure_device_for_secondary_insert":
            await device_crud.ensure_device_for_secondary(
                db, device_id=env.device_id, **fields
            )
        else:
            fields.update(port=9876, restate_enabled=False, restate_healthy=False)
            if writer == "register_runner_legacy_update":
                await runner_crud.register_runner(db, **fields)
            else:
                await device_crud.register_device(db, device_id=env.device_id, **fields)

    assert await _stored_capabilities(env) == _FORGED_KEPT
    assert await _is_marked(env) is False


_DROP_CASES: dict[str, tuple[list[Any], list[Any]]] = {
    # coord's own cases (routes_phase3.rs register_column_drops_the_ci_runner_marker)
    "marker_among_others": (
        ["os:linux", "ci_runner", "gpu:NVIDIA:24GB"],
        ["os:linux", "gpu:NVIDIA:24GB"],
    ),
    "only_the_marker_becomes_empty": (["ci_runner"], []),
    "lookalike_is_ordinary": (["ci_runner_x"], ["ci_runner_x"]),
    # every copy goes, and nothing that merely resembles it does
    "every_copy_dropped": (["ci_runner", "a", "ci_runner"], ["a"]),
    "empty_stays_empty": ([], []),
    "near_misses_kept": (
        ["CI_RUNNER", " ci_runner", "ci_runner "],
        ["CI_RUNNER", " ci_runner", "ci_runner "],
    ),
    "non_strings_kept": (
        [["ci_runner"], {"ci_runner": True}, 1],
        [["ci_runner"], {"ci_runner": True}, 1],
    ),
}


@pytest.mark.parametrize(
    ("given", "kept"), list(_DROP_CASES.values()), ids=list(_DROP_CASES)
)
async def test_the_drop_is_coords_exact_match(
    given: list[Any], kept: list[Any]
) -> None:
    assert device_crud.drop_ci_runner_capability(list(given), device_id=None) == kept
