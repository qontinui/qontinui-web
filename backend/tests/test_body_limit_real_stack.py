"""``BodyLimitMiddleware`` through the REAL app's middleware stack.

The middleware's unit tests (``tests/test_overview_documents.py``
``TestBodyLimit``) mount it on a bare app, where a mid-stream overflow reaches
FastAPI as the ``HTTPException(413)`` it raised. In ``app.main.app`` it does
not: the ``BaseHTTPMiddleware`` layers inside it wrap that exception in
``ExceptionGroup``s, which FastAPI's body parsing reported as ``400 There was
an error parsing the body`` — so every capped route answered a chunked
oversized upload with a refusal naming the wrong cause. Found by plan
``2026-10-13-image-generation-and-visual-judgment`` Phase 13, whose image
upload is one of those routes.

These tests read the limits the real app actually configured and drive each
one through the whole stack, so a limit added later is covered without an
edit here.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi import FastAPI

from app.middleware.body_limit import BodyLimit, BodyLimitMiddleware

pytestmark = pytest.mark.asyncio


def _real_app() -> FastAPI:
    from app.main import app

    return app


def _configured_limits() -> dict[tuple[str, str], BodyLimit]:
    for middleware in _real_app().user_middleware:
        if middleware.cls is BodyLimitMiddleware:
            return dict(middleware.kwargs["limits"])
    raise AssertionError("app.main.app does not install BodyLimitMiddleware")


_LIMITS = sorted(_configured_limits().items())
_IDS = [f"{method} {path}" for (method, path), _limit in _LIMITS]


def test_the_real_app_caps_the_known_upload_routes() -> None:
    """Not vacuous: the population below is the routes it must cover."""
    assert ("POST", "/api/v1/overview/files") in dict(_LIMITS)
    assert ("POST", "/api/v1/image-assets") in dict(_LIMITS)


async def _send(
    method: str, path: str, headers: list[tuple[bytes, bytes]], chunks: list[bytes]
) -> tuple[int, bytes]:
    """One raw HTTP request through ``app.main.app``'s full stack."""
    queue = [
        {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
        for i, chunk in enumerate(chunks)
    ]
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"test"), *headers],
        "client": ("127.0.0.1", 50000),
        "server": ("test", 80),
    }
    await _real_app()(scope, receive, send)
    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert len(starts) == 1, f"expected exactly one response, got {len(starts)}"
    body = b"".join(
        m.get("body", b"") for m in sent if m["type"] == "http.response.body"
    )
    return starts[0]["status"], body


_BOUNDARY = b"cap"
_FILE_PART_HEAD = (
    b"--" + _BOUNDARY + b"\r\n"
    b'Content-Disposition: form-data; name="file"; filename="big.bin"\r\n'
    b"Content-Type: application/octet-stream\r\n\r\n"
)
_MULTIPART = (b"content-type", b"multipart/form-data; boundary=" + _BOUNDARY)


@pytest.mark.parametrize(("route", "limit"), _LIMITS, ids=_IDS)
async def test_a_chunked_body_past_the_cap_is_a_413_naming_the_cap(
    route: tuple[str, str], limit: BodyLimit
) -> None:
    method, path = route
    mib = b"\x00" * (1024 * 1024)
    chunks = [_FILE_PART_HEAD] + [mib] * (limit.max_bytes // len(mib) + 2)
    status, body = await _send(
        method, path, [_MULTIPART, (b"transfer-encoding", b"chunked")], chunks
    )
    assert status == 413, body[:300]
    assert json.loads(body)["detail"] == limit.detail()


@pytest.mark.parametrize(("route", "limit"), _LIMITS, ids=_IDS)
async def test_a_declared_length_past_the_cap_is_refused_unread(
    route: tuple[str, str], limit: BodyLimit
) -> None:
    method, path = route
    status, body = await _send(
        method,
        path,
        [_MULTIPART, (b"content-length", str(limit.max_bytes + 1).encode())],
        [_FILE_PART_HEAD],
    )
    assert status == 413
    assert json.loads(body)["detail"] == limit.detail()


@pytest.mark.parametrize(("route", "limit"), _LIMITS, ids=_IDS)
async def test_a_body_under_the_cap_reaches_the_route(
    route: tuple[str, str], limit: BodyLimit
) -> None:
    """The cap refuses only what is over it: a small body goes on to the
    route, which refuses it for its own reasons (no credential here)."""
    method, path = route
    small = _FILE_PART_HEAD + b"x" * 10 + b"\r\n--" + _BOUNDARY + b"--\r\n"
    status, _body = await _send(
        method,
        path,
        [_MULTIPART, (b"content-length", str(len(small)).encode())],
        [small],
    )
    assert status != 413
