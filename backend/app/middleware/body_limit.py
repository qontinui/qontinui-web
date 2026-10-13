"""Request-body size caps for named routes, enforced before anything parses.

FastAPI parses a multipart form before it resolves a route's dependencies, and
Starlette's multipart parser spools each file part to a temporary file with no
size limit. A route's own size check therefore runs only after the whole body
has reached the disk, and before the caller is authenticated. This middleware
caps the body at the ASGI boundary instead:

* a declared ``Content-Length`` over the cap is refused before a byte is read;
* otherwise the bytes are counted as they arrive, and the request is refused
  the moment the count passes the cap (a chunked body declares no length).

Either refusal is a ``413`` that this middleware sends ITSELF, in the same
flat body the app's ``HTTPException`` handler
(``app.middleware.error_handler.http_exception_handler``) renders for a route's
own refusal — ``error``, ``message``, ``max_bytes`` (the per-file maximum the
message names), ``timestamp`` and ``path`` — so a client meets one 413 shape
whichever of the two refused it. It carries ``X-Request-ID`` when the request
has one, and its log line names the request id.

Once the count passes the cap, whatever the inner app answers is discarded:
the cap was the cause, so the cap answers — a ``BaseHTTPMiddleware`` layer
between this one and the app would otherwise turn the overflow into
``ExceptionGroup``s that FastAPI reports as ``400 There was an error parsing
the body``. ``app.main`` installs this middleware INNERMOST: no layer outside
it reads the body, so the cap still runs before anything parses it, and the
request-id, metrics and logging layers all wrap it — they record the 413 the
client receives, not a 400 the client never sees.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import structlog
from fastapi import HTTPException
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class BodyLimit:
    #: The cap on the whole request body, framing included.
    max_bytes: int
    error: str
    message: str
    #: The per-file maximum ``message`` names, reported to the client as
    #: ``max_bytes`` — the same number the route's own refusal reports.
    #: Defaults to the body cap.
    max_file_bytes: int | None = None

    def detail(self) -> dict[str, Any]:
        return {
            "error": self.error,
            "message": self.message,
            "max_bytes": (
                self.max_file_bytes
                if self.max_file_bytes is not None
                else self.max_bytes
            ),
        }


def _request_id(scope: Scope) -> str | None:
    """The id ``RequestIDMiddleware`` put in the request state, if it ran."""
    state = scope.get("state")
    if isinstance(state, Mapping):
        value = state.get("request_id")
        if isinstance(value, str):
            return value
    return None


class BodyLimitMiddleware:
    """Caps the request body of each ``(METHOD, path)`` in ``limits``."""

    def __init__(self, app: ASGIApp, limits: Mapping[tuple[str, str], BodyLimit]):
        self.app = app
        self.limits = dict(limits)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.limits.get((scope["method"], scope["path"].rstrip("/")))
        if limit is None:
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                if value.isdigit() and int(value) > limit.max_bytes:
                    logger.warning(
                        "request_body_too_large",
                        path=scope["path"],
                        request_id=_request_id(scope),
                        declared_bytes=int(value),
                        max_bytes=limit.max_bytes,
                    )
                    await _refuse(scope, send, limit)
                    return
                break

        received = 0
        started = False
        overflowed = False

        async def counted_receive() -> Message:
            nonlocal received, overflowed
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit.max_bytes:
                    # Stops the reader. How the inner layers report this
                    # exception does not matter: from here on the 413 below is
                    # the answer (see the module docstring).
                    overflowed = True
                    raise HTTPException(status_code=413, detail=limit.detail())
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if overflowed and not started:
                # The inner app's answer to a body this middleware cut off.
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except Exception:
            # Raised past every inner handler (a non-FastAPI consumer of the
            # body, or a BaseHTTPMiddleware's ExceptionGroup): the overflow is
            # answered below; anything else is not this middleware's.
            if not overflowed or started:
                raise
        if overflowed and not started:
            logger.warning(
                "request_body_too_large",
                path=scope["path"],
                request_id=_request_id(scope),
                received_bytes=received,
                max_bytes=limit.max_bytes,
            )
            await _refuse(scope, send, limit)


async def _refuse(scope: Scope, send: Send, limit: BodyLimit) -> None:
    """The 413, in ``http_exception_handler``'s flat shape."""
    body = json.dumps(
        {
            **limit.detail(),
            "timestamp": time.time(),
            "path": str(Request(scope).url),
        }
    ).encode()
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
        (b"connection", b"close"),
    ]
    request_id = _request_id(scope)
    if request_id is not None:
        headers.append((b"x-request-id", request_id.encode("latin-1", "replace")))
    await send({"type": "http.response.start", "status": 413, "headers": headers})
    await send({"type": "http.response.body", "body": body})
