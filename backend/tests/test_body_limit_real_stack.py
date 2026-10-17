"""``BodyLimitMiddleware`` through the REAL app's middleware stack.

The middleware's unit tests (``tests/test_overview_documents.py``
``TestBodyLimit``) mount it on a bare app. In ``app.main.app`` it sits among
``BaseHTTPMiddleware`` layers, and three things went wrong there that a bare
app cannot show:

* a chunked oversized upload was answered ``400 There was an error parsing the
  body`` — the inner layers wrapped the overflow in ``ExceptionGroup``s;
* the logging and metrics layers recorded that 400, while the client got the
  413, and neither the 413 nor its log line carried the request id;
* its 413 was ``{"detail": {...}}`` while a route's own 413 was the flat
  ``{"error", "message", "max_bytes", "timestamp", "path"}`` body.

Found by plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 13,
whose image upload is one of the capped routes. These tests read the limits
the real app actually configured and drive each one through the whole stack,
so a limit added later is covered without an edit here.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from app.middleware.body_limit import BodyLimit, BodyLimitMiddleware

pytestmark = pytest.mark.asyncio

#: The one 413 body: ``http_exception_handler``'s keys.
REFUSAL_KEYS = {"error", "message", "max_bytes", "timestamp", "path"}


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


async def test_the_real_app_caps_the_known_upload_routes() -> None:
    """Not vacuous: the population below is the routes it must cover."""
    assert ("POST", "/api/v1/overview/files") in dict(_LIMITS)
    assert ("POST", "/api/v1/image-assets") in dict(_LIMITS)


async def test_the_cap_is_the_innermost_user_middleware() -> None:
    """Every observability layer must WRAP the cap, or it records something
    other than what the client receives (Starlette builds ``user_middleware``
    outermost-first)."""
    names = [m.cls.__name__ for m in _real_app().user_middleware]
    assert names[-1] == "BodyLimitMiddleware", names
    for wrapper in ("RequestIDMiddleware", "LoggingMiddleware", "MetricsMiddleware"):
        assert names.index(wrapper) < names.index("BodyLimitMiddleware"), names


async def _send(
    method: str, path: str, headers: list[tuple[bytes, bytes]], chunks: list[bytes]
) -> tuple[int, dict[bytes, bytes], bytes]:
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
    return starts[0]["status"], dict(starts[0]["headers"]), body


_BOUNDARY = b"cap"
_FILE_PART_HEAD = (
    b"--" + _BOUNDARY + b"\r\n"
    b'Content-Disposition: form-data; name="file"; filename="big.bin"\r\n'
    b"Content-Type: application/octet-stream\r\n\r\n"
)
_MULTIPART = (b"content-type", b"multipart/form-data; boundary=" + _BOUNDARY)


def _assert_the_one_refusal(body: bytes, limit: BodyLimit, path: str) -> None:
    refusal = json.loads(body)
    assert set(refusal) == REFUSAL_KEYS, refusal
    assert refusal["error"] == limit.error
    assert refusal["message"] == limit.message
    assert refusal["max_bytes"] == (
        limit.max_file_bytes if limit.max_file_bytes is not None else limit.max_bytes
    )
    assert refusal["path"].endswith(path)


def _events(caplog: pytest.LogCaptureFixture, event: str) -> list[dict[str, Any]]:
    found = []
    for record in caplog.records:
        payload = record.msg
        if isinstance(payload, dict) and payload.get("event") == event:
            found.append(payload)
    return found


@pytest.mark.parametrize(("route", "limit"), _LIMITS, ids=_IDS)
async def test_a_chunked_body_past_the_cap_is_a_413_naming_the_cap(
    route: tuple[str, str], limit: BodyLimit, caplog: pytest.LogCaptureFixture
) -> None:
    method, path = route
    request_id = f"cap-{uuid4()}"
    mib = b"\x00" * (1024 * 1024)
    chunks = [_FILE_PART_HEAD] + [mib] * (limit.max_bytes // len(mib) + 2)
    with caplog.at_level(logging.INFO):
        status, headers, body = await _send(
            method,
            path,
            [
                _MULTIPART,
                (b"transfer-encoding", b"chunked"),
                (b"x-request-id", request_id.encode()),
            ],
            chunks,
        )
    assert status == 413, body[:300]
    _assert_the_one_refusal(body, limit, path)
    assert headers.get(b"x-request-id") == request_id.encode()
    # What the logging layers RECORD is the 413 the client received — and the
    # cap's own line names the request.
    completed = [
        e
        for e in _events(caplog, "request_completed")
        if e.get("request_id") == request_id
    ]
    assert [e["status_code"] for e in completed] == [413], completed
    refused = [
        e
        for e in _events(caplog, "request_body_too_large")
        if e.get("request_id") == request_id
    ]
    assert len(refused) == 1 and refused[0]["received_bytes"] > limit.max_bytes


@pytest.mark.parametrize(("route", "limit"), _LIMITS, ids=_IDS)
async def test_a_declared_length_past_the_cap_is_refused_unread(
    route: tuple[str, str], limit: BodyLimit, caplog: pytest.LogCaptureFixture
) -> None:
    method, path = route
    request_id = f"cap-{uuid4()}"
    with caplog.at_level(logging.INFO):
        status, headers, body = await _send(
            method,
            path,
            [
                _MULTIPART,
                (b"content-length", str(limit.max_bytes + 1).encode()),
                (b"x-request-id", request_id.encode()),
            ],
            [_FILE_PART_HEAD],
        )
    assert status == 413
    _assert_the_one_refusal(body, limit, path)
    assert headers.get(b"x-request-id") == request_id.encode()
    refused = [
        e
        for e in _events(caplog, "request_body_too_large")
        if e.get("request_id") == request_id
    ]
    assert len(refused) == 1 and refused[0]["declared_bytes"] == limit.max_bytes + 1


@pytest.mark.parametrize(("route", "limit"), _LIMITS, ids=_IDS)
async def test_a_body_under_the_cap_reaches_the_route(
    route: tuple[str, str], limit: BodyLimit
) -> None:
    """The cap refuses only what is over it: a small body goes on to the
    route, which refuses it for its own reasons (no credential here)."""
    method, path = route
    small = _FILE_PART_HEAD + b"x" * 10 + b"\r\n--" + _BOUNDARY + b"--\r\n"
    status, _headers, _body = await _send(
        method,
        path,
        [_MULTIPART, (b"content-length", str(len(small)).encode())],
        [small],
    )
    assert status != 413


@pytest.fixture()
def image_upload_as_a_device(monkeypatch: pytest.MonkeyPatch) -> Iterator[FastAPI]:
    """The real app with only the image route's tenant resolved (the route's
    own 413 comes before any database or storage work)."""
    from app.api.v1.endpoints import image_assets as endpoints
    from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant

    app = _real_app()
    monkeypatch.setattr(endpoints, "MAX_IMAGE_BYTES", 10)
    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_memory_tenant] = lambda: MemoryPrincipal(
        tenant_id=uuid4(), device_id=None, actor="device"
    )
    try:
        yield app
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)


@pytest.mark.parametrize("refusal", ["_too_large", "_storage_full"])
async def test_the_overview_uploads_own_413s_have_the_same_shape(refusal: str) -> None:
    """The overview upload also refuses on its own — a file past the per-file
    cap, a project past its storage — and the app's handler renders those
    413s in the one shape, ``max_bytes`` included."""
    from starlette.requests import Request

    from app.middleware.error_handler import http_exception_handler
    from app.overview import files

    exc = getattr(files, refusal)()
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "server": ("test", 80),
            "path": "/api/v1/overview/files",
            "root_path": "",
            "query_string": b"",
            "headers": [],
        }
    )
    response = await http_exception_handler(request, exc)
    assert response.status_code == 413
    assert set(json.loads(bytes(response.body))) == REFUSAL_KEYS


async def test_the_routes_own_413_has_the_same_shape(
    image_upload_as_a_device: FastAPI,
) -> None:
    """Under the body cap but over the image cap: the ROUTE refuses, through
    the app's HTTPException handler — and the client meets the same keys the
    middleware's refusal carries."""
    transport = httpx.ASGITransport(app=image_upload_as_a_device)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/image-assets",
            data={"kind": "candidate"},
            files={"file": ("x.bin", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/png")},
        )
    assert resp.status_code == 413
    assert set(resp.json()) == REFUSAL_KEYS
    assert resp.json()["error"] == "image_too_large"
    assert resp.json()["max_bytes"] == 10
    assert "x-request-id" in resp.headers
