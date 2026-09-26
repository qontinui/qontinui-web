"""Request-body size caps for named routes, enforced before anything parses.

FastAPI parses a multipart form before it resolves a route's dependencies, and
Starlette's multipart parser spools each file part to a temporary file with no
size limit. A route's own size check therefore runs only after the whole body
has reached the disk, and before the caller is authenticated. This middleware
caps the body at the ASGI boundary instead:

* a declared ``Content-Length`` over the cap is refused before a byte is read;
* otherwise the bytes are counted as they arrive, and the request is refused
  the moment the count passes the cap (a chunked body declares no length).

Either refusal is a ``413`` shaped like the route's own refusals
(``{"detail": {"error": ..., "message": ...}}``).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

import structlog
from fastapi import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class BodyLimit:
    max_bytes: int
    error: str
    message: str

    def detail(self) -> dict[str, str]:
        return {"error": self.error, "message": self.message}


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
                    # Refused outside the logging and metrics middleware, so
                    # recorded here.
                    logger.warning(
                        "request_body_too_large",
                        path=scope["path"],
                        declared_bytes=int(value),
                        max_bytes=limit.max_bytes,
                    )
                    await _refuse(send, limit)
                    return
                break

        received = 0
        started = False

        async def counted_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit.max_bytes:
                    # FastAPI re-raises an HTTPException from body parsing as
                    # is, so this reaches the client as the 413 it names.
                    raise HTTPException(status_code=413, detail=limit.detail())
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except HTTPException as exc:
            # Raised outside FastAPI's handling (a non-FastAPI consumer of the
            # body): answer it here if nothing has been sent yet.
            if exc.status_code != 413 or started:
                raise
            await _refuse(send, limit)


async def _refuse(send: Send, limit: BodyLimit) -> None:
    body = json.dumps({"detail": limit.detail()}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
