"""The narrow interface the relay's collaborators call back into.

``RemoteTerminalRelay`` (``app.services.runner.remote_terminal_relay``) is the
core: it owns the socket table, the background-task set and the Redis client,
and it builds its collaborators in one explicit, acyclic constructor graph
(plan ``2026-10-04-web-remote-terminal-relay-is-one-class-of-four-protocols``,
D2). A collaborator is handed its SIBLINGS as constructor arguments and the core
as a ``RelayCore`` — so everything it may reach on the core is listed here, and
reaching for anything else is a mypy error rather than a hidden coupling.

This module must not import the relay module: the relay imports the
collaborators, and they import this.
"""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any, Protocol

from redis import asyncio as aioredis

from app.services.runner.remote_relay.state import _Attachment, _SourceSession


class RelayCore(Protocol):
    """What a collaborator may call on the relay core. Nothing else."""

    async def _get_redis(self) -> aioredis.Redis: ...

    def spawn_background(
        self, coro: Coroutine[Any, Any, None]
    ) -> asyncio.Task[None]: ...

    async def _send_to_source(
        self, session: _SourceSession, payload: dict[str, Any]
    ) -> None: ...

    async def _refuse(
        self,
        session: _SourceSession,
        code: str,
        message: str,
        *,
        request_id: Any = None,
        grant_jti: str | None = None,
        terminal_id: Any = None,
    ) -> None: ...

    async def _detach_target(
        self, session: _SourceSession, att: _Attachment, terminal_id: str | None
    ) -> None: ...

    async def _drop_attachment(
        self, session: _SourceSession, att: _Attachment
    ) -> None: ...

    async def _maybe_stop_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> None: ...

    async def _evict(
        self, session: _SourceSession, att: _Attachment, *, code: str, message: str
    ) -> None: ...

    def _ensure_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> Coroutine[Any, Any, None]: ...

    async def route_target_frame(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool: ...
