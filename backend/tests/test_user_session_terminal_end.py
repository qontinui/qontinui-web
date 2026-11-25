"""User-session terminal path: ``terminal_end`` relay (lifecycle-authority Phase 16 (a)).

Pins: the end is forwarded stamped ``origin: user_session`` and answered on
the asking socket; a client-supplied ``origin`` cannot ride; a source-sent
``origin`` is stripped from remote input forwards; a device-socket ``door``
never reaches a target; connect-time rejections carry a typed code in BOTH the
close-frame reason and the error frame.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.api.v1.endpoints import devices_ws, runner_terminal_ws
from app.services.runner import user_session_end
from app.services.runner.remote_relay.protocol import INPUT_FORWARD_RELAY_OWNED_KEYS

FIXTURE = json.loads(
    (
        Path(__file__).parent / "fixtures" / "user_session_terminal_frames.json"
    ).read_text()
)


class _WS:
    """Scripted user-session socket: replays ``incoming`` then disconnects."""

    def __init__(self, incoming: list[dict[str, Any]], cookies: dict | None = None):
        self._incoming = list(incoming)
        self.cookies = cookies or {}
        self.sent: list[dict[str, Any]] = []
        self.closed: tuple[int | None, str | None] | None = None
        self.application_state = WebSocketState.CONNECTED
        self.client_state = WebSocketState.CONNECTED

    async def accept(self) -> None:
        pass

    async def receive_json(self) -> dict[str, Any]:
        if not self._incoming:
            raise WebSocketDisconnect()
        return self._incoming.pop(0)

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)

    async def close(self, code: int | None = None, reason: str | None = None) -> None:
        if self.closed is None:  # the endpoint's finally closes again, bare
            self.closed = (code, reason)


class _Manager:
    def __init__(self) -> None:
        self.forwarded: list[dict[str, Any]] = []

    async def connect_mobile_terminal(self, *a: Any) -> bool:
        return True

    async def disconnect_mobile_terminal(self, *a: Any) -> None:
        pass

    async def send_terminal(self, runner_id: Any, msg: dict[str, Any]) -> bool:
        self.forwarded.append(msg)
        return True


def _patch(
    monkeypatch: pytest.MonkeyPatch, *, owned: bool, auth: str = "ok"
) -> _Manager:
    manager = _Manager()

    async def _user(_tok: str) -> Any:
        if auth == "fail":
            raise ValueError("bad token")
        return SimpleNamespace(id=uuid4())

    class _Session:
        async def __aenter__(self) -> Any:
            return SimpleNamespace(
                execute=AsyncMock(
                    return_value=SimpleNamespace(
                        scalar_one_or_none=lambda: object() if owned else None
                    )
                )
            )

        async def __aexit__(self, *a: Any) -> None:
            return None

    monkeypatch.setattr(runner_terminal_ws, "get_current_user_from_ws", _user)
    monkeypatch.setattr(runner_terminal_ws, "AsyncSessionLocal", lambda: _Session())
    monkeypatch.setattr(runner_terminal_ws, "get_redis", AsyncMock(return_value=None))
    monkeypatch.setattr(
        runner_terminal_ws,
        "get_runner_websocket_manager",
        AsyncMock(return_value=manager),
    )
    return manager


async def _run(ws: _WS, runner_id: Any = None) -> None:
    await runner_terminal_ws.websocket_runner_terminal_endpoint(
        ws, runner_id or uuid4(), token=None if "access_token" in ws.cookies else "tok"
    )


@pytest.mark.asyncio
async def test_end_close_input_are_stamped_and_client_origin_cannot_ride(monkeypatch):
    manager = _patch(monkeypatch, owned=True)
    ws = _WS(
        [
            {
                "type": "terminal_end",
                "session_id": "sess-1",
                "force": True,
                "request_id": "req-1",
                "origin": "operator_single",
            },
            {
                "type": "terminal_close",
                "terminal_id": "t-1",
                "request_id": "req-2",
                "origin": "forged",
            },
            {"type": "terminal_input", "terminal_id": "t-1", "data": "bHMK"},
            {"type": "terminal_list", "request_id": "req-3", "origin": "user_session"},
            {
                "type": "terminal_create",
                "request_id": "req-4",
                "origin": "user_session",
            },
        ]
    )
    await _run(ws)
    end, close, inp, lst, create = manager.forwarded
    for sent in (end, close, inp):
        assert sent["origin"] == FIXTURE["origin"] == "user_session"
    # An unstamped type never carries origin, even a forged one.
    assert "origin" not in lst and "origin" not in create
    assert end["origin"] != "operator_single" and close["origin"] != "forged"
    assert end["session_id"] == "sess-1" and end["force"] is True
    # Fixture: every stamped frame carries exactly the fixture's keys.
    for name, frame in (
        ("terminal_end", end),
        ("terminal_close", close),
        ("terminal_input", inp),
    ):
        want = FIXTURE["forwarded_frames"][name]
        assert {k: v for k, v in frame.items() if k in want} == {
            k: v for k, v in want.items() if k in frame
        }
        assert set(want) <= set(frame)


@pytest.mark.asyncio
async def test_non_literal_true_force_is_graceful(monkeypatch):
    manager = _patch(monkeypatch, owned=True)
    ws = _WS(
        [
            {
                "type": "terminal_end",
                "session_id": "s",
                "force": "true",
                "request_id": "r",
            }
        ]
    )
    await _run(ws)
    assert manager.forwarded[0]["force"] is False


@pytest.mark.asyncio
async def test_terminal_ended_reaches_the_asking_socket_not_the_remote_relay(
    monkeypatch,
):
    manager = _patch(monkeypatch, owned=True)
    device_id = uuid4()
    asker = _WS([{"type": "terminal_end", "session_id": "s", "request_id": "req-9"}])

    async def _answer_mid_flight(*_a: Any) -> None:
        # The target answers on its DEVICE socket while the asker is connected.
        dm = SimpleNamespace(
            send_terminal_response_to_mobiles=AsyncMock(),
            get_websocket=lambda _i: None,
            refresh_ttl=AsyncMock(),
        )
        publish = AsyncMock()
        monkeypatch.setattr(
            devices_ws.remote_terminal_relay, "publish_target_frame", publish
        )
        ended = {"type": "terminal_ended", "request_id": "req-9", "outcome": "ended"}
        await devices_ws._route_device_message(ended, device_id, "u", dm)
        publish.assert_not_awaited()
        # A remote source's end (id in no user-session map) still goes remote.
        other = {"type": "terminal_ended", "request_id": "minted-x"}
        await devices_ws._route_device_message(other, device_id, "u", dm)
        publish.assert_awaited_once_with(device_id, other)

    orig = manager.send_terminal

    async def _send(runner_id: Any, msg: dict[str, Any]) -> bool:
        ok = await orig(runner_id, msg)
        await _answer_mid_flight()
        return ok

    manager.send_terminal = _send  # type: ignore[method-assign]
    await _run(asker, device_id)
    assert {
        "type": "terminal_ended",
        "request_id": "req-9",
        "outcome": "ended",
    } in asker.sent


@pytest.mark.asyncio
async def test_terminal_ended_for_another_device_is_not_claimed():
    user_session_end.register("dev-A", "req-1", object())
    assert user_session_end.claim("dev-B", "req-1") is None
    assert user_session_end.claim("dev-A", "req-1") is not None
    assert user_session_end.claim("dev-A", "req-1") is None


def test_origin_is_relay_owned_on_source_input_forwards():
    assert "origin" in INPUT_FORWARD_RELAY_OWNED_KEYS


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"owned": True, "no_token": True}, "authentication_required"),
        ({"owned": True, "auth": "fail"}, "authentication_failed"),
        ({"owned": False}, "runner_not_owned"),
    ],
)
async def test_connect_rejections_carry_typed_code_in_close_and_error_frame(
    monkeypatch, kwargs, code
):
    assert code in FIXTURE["connect_rejection_codes"]
    no_token = kwargs.pop("no_token", False)
    _patch(monkeypatch, **kwargs)
    ws = _WS([])
    await runner_terminal_ws.websocket_runner_terminal_endpoint(
        ws, uuid4(), token=None if no_token else "tok"
    )
    assert ws.closed is not None
    assert ws.closed[1].startswith(f"{code}: ")
    assert len(ws.closed[1].encode()) <= 123
    assert ws.sent[0]["code"] == code


@pytest.fixture(autouse=True)
def _clean_pending():
    user_session_end._pending.clear()
    yield
    user_session_end._pending.clear()


@pytest.mark.asyncio
async def test_terminal_end_without_request_id_is_refused_and_not_forwarded(
    monkeypatch,
):
    manager = _patch(monkeypatch, owned=True)
    ws = _WS([{"type": "terminal_end", "session_id": "s"}])
    await _run(ws)
    assert manager.forwarded == []
    assert ws.sent[-1]["code"] == "request_id_required"


@pytest.mark.asyncio
async def test_failed_send_releases_only_the_callers_entry():
    a, b = object(), object()
    assert user_session_end.register("d", "r", a) is None
    assert user_session_end.claim("d", "r", b) is None  # not b's: kept
    assert user_session_end.claim("d", "r", a) is a


@pytest.mark.asyncio
async def test_failed_send_releases_the_entry_end_to_end(monkeypatch):
    manager = _patch(monkeypatch, owned=True)

    async def _fail(_rid: Any, _msg: dict[str, Any]) -> bool:
        return False

    manager.send_terminal = _fail  # type: ignore[method-assign]
    ws = _WS([{"type": "terminal_end", "session_id": "s", "request_id": "r"}])
    await _run(ws)
    assert user_session_end._pending == {}
    assert ws.sent[-1]["message"] == "Runner is not connected."


@pytest.mark.asyncio
async def test_duplicate_request_id_from_another_socket_is_refused():
    a, b = object(), object()
    assert user_session_end.register("d", "r", a) is None
    assert user_session_end.register("d", "r", b) == "end_request_id_in_use"
    assert user_session_end.claim("d", "r") is a  # a's entry untouched


@pytest.mark.asyncio
async def test_pending_ends_are_capped_per_socket():
    a, b = object(), object()
    cap = user_session_end.MAX_PENDING_PER_SOCKET
    for i in range(cap):
        assert user_session_end.register("d", f"r{i}", a) is None
    assert user_session_end.register("d", "over", a) == "too_many_pending_ends"
    assert user_session_end.register("d", "other", b) is None


@pytest.mark.asyncio
async def test_drop_socket_forgets_its_entries_only():
    a, b = object(), object()
    user_session_end.register("d", "ra", a)
    user_session_end.register("d", "rb", b)
    user_session_end.drop_socket(a)
    assert user_session_end.claim("d", "ra") is None
    assert user_session_end.claim("d", "rb") is b


@pytest.mark.asyncio
async def test_ttl_expiry_answers_the_asker_with_a_typed_error(monkeypatch):
    import asyncio

    from app.services.runner.remote_relay import end as end_module

    monkeypatch.setattr(end_module, "PENDING_END_TTL_SECONDS", 0.01)
    ws = _WS([])
    user_session_end.register("d", "r-ttl", ws)
    await asyncio.sleep(0.1)
    assert user_session_end._pending == {}
    assert ws.sent == [
        {
            "type": "error",
            "code": "end_reply_timeout",
            "request_id": "r-ttl",
            "message": "target did not answer the end request in time; "
            "its outcome is unknown",
        }
    ]


@pytest.mark.asyncio
async def test_dead_asker_does_not_break_the_device_router():
    class _Dead:
        async def send_json(self, _p: Any) -> None:
            raise RuntimeError("boom")

    user_session_end.register("dev", "r", _Dead())
    dm = SimpleNamespace(refresh_ttl=AsyncMock(), get_websocket=lambda _i: None)
    # Must return normally (and not fall through to the remote relay).
    await devices_ws._route_device_message(
        {"type": "terminal_ended", "request_id": "r"}, "dev", "u", dm
    )
    assert user_session_end._pending == {}


@pytest.mark.asyncio
async def test_duplicate_terminal_end_is_refused_with_typed_error_and_not_forwarded(
    monkeypatch,
):
    manager = _patch(monkeypatch, owned=True)
    device_id = uuid4()
    other = object()
    user_session_end.register(device_id, "dup", other)  # another socket's end
    ws = _WS([{"type": "terminal_end", "session_id": "s", "request_id": "dup"}])
    await _run(ws, device_id)
    assert manager.forwarded == []
    err = ws.sent[-1]
    assert err["code"] == "end_request_id_in_use" and err["request_id"] == "dup"
    assert user_session_end.claim(device_id, "dup") is other  # untouched


@pytest.mark.asyncio
async def test_over_cap_terminal_end_is_refused_with_typed_error_and_not_forwarded(
    monkeypatch,
):
    manager = _patch(monkeypatch, owned=True)
    cap = user_session_end.MAX_PENDING_PER_SOCKET
    ws = _WS(
        [
            {"type": "terminal_end", "session_id": "s", "request_id": f"r{i}"}
            for i in range(cap + 1)
        ]
    )
    await _run(ws)
    assert len(manager.forwarded) == cap
    assert f"r{cap}" not in [f["request_id"] for f in manager.forwarded]
    assert ws.sent[-1]["code"] == "too_many_pending_ends"
    assert ws.sent[-1]["request_id"] == f"r{cap}"
