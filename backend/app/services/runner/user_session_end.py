"""Pending ``terminal_end`` answers for the user-session terminal path.

A ``terminal_end`` sent over ``runner_terminal_ws`` (the operator's Cognito
user-session socket) is answered by the TARGET's ``terminal_ended`` frame. That
frame arrives on the target's DEVICE socket (``devices_ws``), where
``is_remote_only_target_frame`` would send every ``terminal_ended`` to the
remote relay. This registry records each end's ``request_id`` against the
asking socket so ``devices_ws`` can hand the answer back to it first.

It mirrors ``EndCoordinator.pending_end`` (``remote_relay/end.py``): one entry
per in-flight end, keyed by the wire ``request_id``, armed with the same TTL
(``PENDING_END_TTL_SECONDS``, read at call time so tests can shorten it), and
removed when answered, expired, or when the asking socket goes away. Entries
are also scoped to the target device, so another device's ``terminal_ended``
carrying a guessed ``request_id`` cannot claim the slot.

The map is process-local: an answer landing on a different web replica than
the asking socket falls through to the existing routing, unchanged.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import structlog

from app.services.runner.remote_relay import end as _end_module

logger = structlog.get_logger(__name__)


CODE_END_REPLY_TIMEOUT = "end_reply_timeout"
CODE_END_REQUEST_ID_IN_USE = "end_request_id_in_use"
CODE_TOO_MANY_PENDING_ENDS = "too_many_pending_ends"

# Bounds ``_pending`` per asking socket (the remote relay bounds it by one end
# per grant; a user-session socket has no grants, so it gets a flat cap).
MAX_PENDING_PER_SOCKET = 16


@dataclass
class _Entry:
    websocket: Any
    timer: asyncio.TimerHandle | None = field(default=None, repr=False)


# (target device id as str, request_id) -> entry
_pending: dict[tuple[str, str], _Entry] = {}
# Strong refs to in-flight timeout-answer tasks (the loop holds only weak ones).
_timeout_tasks: set[asyncio.Task[None]] = set()


def register(device_id: Any, request_id: str, websocket: Any) -> str | None:
    """Record ``request_id`` as awaiting a ``terminal_ended`` for ``websocket``.

    Returns ``None`` on success, else the typed code the caller answers with
    (nothing is registered then): a ``(device, request_id)`` already pending —
    from any socket, so one socket cannot shadow or steal another's answer — or
    a socket already at ``MAX_PENDING_PER_SOCKET``.
    """
    key = (str(device_id), request_id)
    if key in _pending:
        return CODE_END_REQUEST_ID_IN_USE
    if sum(1 for e in _pending.values() if e.websocket is websocket) >= (
        MAX_PENDING_PER_SOCKET
    ):
        return CODE_TOO_MANY_PENDING_ENDS
    entry = _Entry(websocket=websocket)
    loop = asyncio.get_running_loop()
    entry.timer = loop.call_later(
        _end_module.PENDING_END_TTL_SECONDS, _expire, key, entry
    )
    _pending[key] = entry
    return None


def _expire(key: tuple[str, str], entry: _Entry) -> None:
    """TTL: answer the asker with a typed error rather than leave it silent."""
    if _pending.get(key) is not entry:
        return
    del _pending[key]
    logger.warning("user_session_end_timed_out", request_id=key[1])
    task = asyncio.get_running_loop().create_task(_send_timeout(key[1], entry))
    _timeout_tasks.add(task)
    task.add_done_callback(_timeout_tasks.discard)


async def _send_timeout(request_id: str, entry: _Entry) -> None:
    try:
        await entry.websocket.send_json(
            {
                "type": "error",
                "code": CODE_END_REPLY_TIMEOUT,
                "request_id": request_id,
                "message": "target did not answer the end request in time; "
                "its outcome is unknown",
            }
        )
    except Exception as exc:  # noqa: BLE001 - a dead asker is not an error here
        logger.debug("user_session_end_timeout_send_failed", error=str(exc))


def claim(device_id: Any, request_id: Any, websocket: Any = None) -> Any | None:
    """Pop and return the asking socket for a ``terminal_ended``, or ``None``.

    With ``websocket`` given, only an entry that socket owns is released: a
    failed send on one socket must not drop another socket's pending end.
    """
    if not isinstance(request_id, str):
        return None
    key = (str(device_id), request_id)
    entry = _pending.get(key)
    if entry is None or (websocket is not None and entry.websocket is not websocket):
        return None
    del _pending[key]
    if entry.timer is not None:
        entry.timer.cancel()
    return entry.websocket


def drop_socket(websocket: Any) -> None:
    """Forget every pending end of a socket that is going away."""
    for key in [k for k, e in _pending.items() if e.websocket is websocket]:
        entry = _pending.pop(key)
        if entry.timer is not None:
            entry.timer.cancel()
