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
  SQL text over every stored shape that could be mistaken for the marker.

DB-backed on purpose: the guard is a statement's interaction with a row other
connections commit, which a mocked session cannot exercise.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
import structlog
from fastapi import WebSocketDisconnect
from qontinui_schemas.common import utc_now
from sqlalchemy import Update, text
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
        item = await self.inbox.get()
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


@pytest.mark.parametrize("role", _PRIMARY_FIELD_WRITERS)
async def test_a_mark_landing_mid_handshake_is_refused_by_the_write(
    env, role: str
) -> None:
    """The early read saw an unmarked row; the registrar marks it while the
    handshake opens its connection row; the device upsert that follows must
    refuse rather than strip the marker the early read never saw."""
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
