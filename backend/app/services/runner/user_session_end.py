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


@dataclass
class _Entry:
    websocket: Any
    timer: asyncio.TimerHandle | None = field(default=None, repr=False)


# (target device id as str, request_id) -> entry
_pending: dict[tuple[str, str], _Entry] = {}


def register(device_id: Any, request_id: str, websocket: Any) -> None:
    """Record ``request_id`` as awaiting a ``terminal_ended`` for ``websocket``."""
    key = (str(device_id), request_id)
    old = _pending.pop(key, None)
    if old is not None and old.timer is not None:
        old.timer.cancel()
    entry = _Entry(websocket=websocket)
    loop = asyncio.get_running_loop()
    entry.timer = loop.call_later(
        _end_module.PENDING_END_TTL_SECONDS, _expire, key, entry
    )
    _pending[key] = entry


def _expire(key: tuple[str, str], entry: _Entry) -> None:
    if _pending.get(key) is entry:
        del _pending[key]
        logger.warning("user_session_end_timed_out", request_id=key[1])


def claim(device_id: Any, request_id: Any) -> Any | None:
    """Pop and return the asking socket for a ``terminal_ended``, or ``None``."""
    if not isinstance(request_id, str):
        return None
    entry = _pending.pop((str(device_id), request_id), None)
    if entry is None:
        return None
    if entry.timer is not None:
        entry.timer.cancel()
    return entry.websocket


def drop_socket(websocket: Any) -> None:
    """Forget every pending end of a socket that is going away."""
    for key in [k for k, e in _pending.items() if e.websocket is websocket]:
        entry = _pending.pop(key)
        if entry.timer is not None:
            entry.timer.cancel()
