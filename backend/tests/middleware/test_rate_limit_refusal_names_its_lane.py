"""Every 429 this backend answers names the lane it was refused on.

Plan ``2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429``,
Phase 2. An exec-mode pass on qontinui.io drew a load-time 429 that no
instrument could attribute: the refusal body said ``RATE_LIMIT_EXCEEDED`` and
nothing else, so a reader could not tell WHICH limiter refused, or what kind of
key that limiter's bucket was keyed on (a bearer, a peer address, a user id, or
a proxy address every caller shares).

``rate_limit_exceeded_handler`` therefore stamps two headers on every refusal,
and logs one ``rate_limit_refused`` line carrying the same fields:

* ``X-RateLimit-Lane`` — ``<limiter>:<scope or route template>``: WHICH module
  limiter refused (``user``, ``default``, ``auth``, ``api``, ``refresh``; else
  ``unknown``), then the limit's scope when it has one, else the ROUTE
  TEMPLATE (``user:/api/v1/users/me``, ``user:/probe/{item_id}``) — never the
  concrete path, which can carry an id.
* ``X-RateLimit-Key-Kind`` — ``user`` | ``bearer`` | ``peer`` | ``ip``, the kind
  of key the refusing bucket is keyed on. Never the key itself: a key is a
  bearer digest, an address or a user id, and none of those belongs in a header
  a browser can read or a log line an operator ships.

The tests assert on the fixture's LITERAL token, addresses and user id, so a
handler that leaked any of them fails here whatever shape the leak takes.
"""

from __future__ import annotations

import ast
import hashlib
import logging
import pathlib
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from structlog.testing import capture_logs

from app.middleware.rate_limit import (
    get_authorization_identifier,
    get_peer_ip_identifier,
    get_user_identifier,
    rate_limit_exceeded_handler,
    user_limiter,
)

API_PREFIX = "/api/v1"

#: Fixture literals. Each one must appear in NO header and NO log line.
BEARER = "fixture-bearer-7d1e0c-never-echo"
BEARER_DIGEST = hashlib.sha256(BEARER.encode("utf-8")).hexdigest()[:32]
CLIENT_HOST = "203.0.113.77"
FORWARDED_LEFT = "198.51.100.23"
FORWARDED_RIGHT = "192.0.2.41"
USER_ID = "5b0c7a7e-9a4f-4c55-8d3e-0e1f2a3b4c5d"

SECRETS = (BEARER, BEARER_DIGEST, CLIENT_HOST, FORWARDED_LEFT, FORWARDED_RIGHT, USER_ID)


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    """Empty counters, and the probe routes this file registers on
    ``user_limiter`` removed again: slowapi keeps a route's limits on the
    limiter for its lifetime, so they would otherwise outlive the test."""
    route_limits = {k: list(v) for k, v in user_limiter._route_limits.items()}
    dynamic = {k: list(v) for k, v in user_limiter._dynamic_route_limits.items()}
    user_limiter.reset()
    yield
    user_limiter.reset()
    user_limiter._route_limits.clear()
    user_limiter._route_limits.update(route_limits)
    user_limiter._dynamic_route_limits.clear()
    user_limiter._dynamic_route_limits.update(dynamic)


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {BEARER}",
        "X-Forwarded-For": f"{FORWARDED_LEFT}, {FORWARDED_RIGHT}",
    }


def _assert_leaks_nothing(texts: list[str]) -> None:
    for text in texts:
        for secret in SECRETS:
            assert secret not in text, f"{secret!r} leaked into {text!r}"


# --------------------------------------------------------------------------
# (c) GET /api/v1/users/me — the real route, the real limiter
# --------------------------------------------------------------------------


def _users_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.users import router as users_router

    app = FastAPI()
    # A read-schema-valid user, so the 200 calls under the limit answer 200
    # rather than a response-validation 500.
    now = datetime.now(UTC)
    user = SimpleNamespace(
        id=UUID(USER_ID),
        email="fixture@example.com",
        username="fixture",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        subscription_tier="free",
        created_at=now,
        updated_at=now,
    )
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(users_router, prefix=f"{API_PREFIX}/users")
    return app


def test_a_users_me_refusal_names_its_lane_and_key_kind() -> None:
    """``GET /api/v1/users/me`` is ``user_limiter.limit("200 per minute")``.
    The 201st call in one window is refused, and the refusal says where."""
    client = TestClient(_users_app(), client=(CLIENT_HOST, 50000))
    for n in range(200):
        resp = client.get(f"{API_PREFIX}/users/me", headers=_headers())
        assert resp.status_code == 200, (n, resp.status_code, resp.text)
    refused = client.get(f"{API_PREFIX}/users/me", headers=_headers())
    assert refused.status_code == 429
    assert refused.json()["error"] == "RATE_LIMIT_EXCEEDED"
    assert refused.headers["X-RateLimit-Lane"] == f"user:{API_PREFIX}/users/me"
    # `get_user_identifier` keys on `request.state.user`, which nothing sets
    # before the limiter runs: the bucket this refusal drew on is the socket
    # address. The header says so rather than what the function is named for.
    assert refused.headers["X-RateLimit-Key-Kind"] == "ip"
    _assert_leaks_nothing([f"{k}: {v}" for k, v in refused.headers.items()])


# --------------------------------------------------------------------------
# (d) every key function: the kind is named, the key never is
# --------------------------------------------------------------------------


class _AttachUser(BaseHTTPMiddleware):
    """Sets ``request.state.user`` so ``get_user_identifier`` takes its
    ``user:<id>`` arm — the arm that would put a user id in a key."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        request.state.user = SimpleNamespace(id=USER_ID)
        return await call_next(request)


def _probe_app(
    key_func: Any,
    *,
    attach_user: bool = False,
    limit: str = "1 per minute",
    shared_scope: str | None = None,
    request_id_middleware: bool = False,
) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]
    if attach_user:
        app.add_middleware(_AttachUser)
    if request_id_middleware:
        from app.middleware.request_id import RequestIDMiddleware

        app.add_middleware(RequestIDMiddleware)

    async def probe(request: Request, item_id: str) -> dict[str, str]:
        return {"ok": item_id}

    # slowapi registers a route's limits under `<module>.<function name>` and
    # EXTENDS that list on every decoration, so each probe gets its own name
    # rather than inheriting the previous parametrization's limit.
    probe.__name__ = f"probe_{uuid4().hex}"
    decorator = (
        user_limiter.limit(limit, key_func=key_func)
        if shared_scope is None
        else user_limiter.shared_limit(limit, scope=shared_scope, key_func=key_func)
    )
    limited = decorator(probe)
    app.get("/probe/{item_id}")(limited)
    return app


@pytest.mark.parametrize(
    ("key_func", "attach_user", "kind"),
    [
        (get_authorization_identifier, False, "bearer"),
        (get_peer_ip_identifier, False, "peer"),
        (get_remote_address, False, "ip"),
        (get_user_identifier, False, "ip"),
        (get_user_identifier, True, "user"),
    ],
    ids=["bearer", "peer", "remote-address", "user-fn-no-user", "user-fn-with-user"],
)
def test_the_refusal_names_the_key_kind_and_never_the_key(
    key_func: Any, attach_user: bool, kind: str
) -> None:
    client = TestClient(
        _probe_app(key_func, attach_user=attach_user), client=(CLIENT_HOST, 50000)
    )
    item = str(uuid4())
    with capture_logs() as logs:
        assert client.get(f"/probe/{item}", headers=_headers()).status_code == 200
        refused = client.get(f"/probe/{item}", headers=_headers())
    assert refused.status_code == 429
    assert refused.headers["X-RateLimit-Key-Kind"] == kind
    # The route TEMPLATE: the concrete path carries the item id.
    assert refused.headers["X-RateLimit-Lane"] == "user:/probe/{item_id}"
    body = refused.json()
    assert body["lane"] == "user:/probe/{item_id}"
    assert body["key_kind"] == kind

    lines = [entry for entry in logs if entry.get("event") == "rate_limit_refused"]
    assert len(lines) == 1, logs
    assert lines[0]["lane"] == "user:/probe/{item_id}"
    assert lines[0]["bucket_kind"] == kind

    _assert_leaks_nothing(
        [f"{k}: {v}" for k, v in refused.headers.items()]
        + [repr(entry) for entry in logs]
        + [refused.text]
    )
    assert item not in refused.headers["X-RateLimit-Lane"]


# --------------------------------------------------------------------------
# The handler is registered whatever RATE_LIMIT_ENABLED says
# --------------------------------------------------------------------------


def test_main_registers_the_429_handler_unconditionally() -> None:
    """``user_limiter`` has no ``enabled=`` and limits whatever
    ``RATE_LIMIT_ENABLED`` says, so its 429 must carry the lane whatever that
    setting says too. Asserted on the module's AST: the registration is a
    top-level statement of ``app/main.py``, not nested under an ``if``."""
    main_py = pathlib.Path(__file__).resolve().parents[2] / "app" / "main.py"
    tree = ast.parse(main_py.read_text(encoding="utf-8"))

    def registers_handler(node: ast.stmt) -> bool:
        return (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Attribute)
            and node.value.func.attr == "add_exception_handler"
            and len(node.value.args) == 2
            and isinstance(node.value.args[0], ast.Name)
            and node.value.args[0].id == "RateLimitExceeded"
        )

    assert any(registers_handler(node) for node in tree.body), (
        "app.add_exception_handler(RateLimitExceeded, ...) must be a top-level "
        "statement of app/main.py"
    )

    from app.main import app

    assert app.exception_handlers.get(RateLimitExceeded) is rate_limit_exceeded_handler


def test_both_headers_are_cors_published() -> None:
    from app.main import CORS_EXPOSE_HEADERS

    assert "X-RateLimit-Lane" in CORS_EXPOSE_HEADERS
    assert "X-RateLimit-Key-Kind" in CORS_EXPOSE_HEADERS


# --------------------------------------------------------------------------
# Lane from a shared limit's scope; Retry-After from the bucket's reset
# --------------------------------------------------------------------------


def test_a_shared_limit_scope_is_the_lane() -> None:
    client = TestClient(
        _probe_app(get_peer_ip_identifier, shared_scope="fixture-shared-lane"),
        client=(CLIENT_HOST, 50000),
    )
    item = str(uuid4())
    assert client.get(f"/probe/{item}").status_code == 200
    refused = client.get(f"/probe/{item}")
    assert refused.status_code == 429
    assert refused.headers["X-RateLimit-Lane"] == "user:fixture-shared-lane"
    assert refused.json()["lane"] == "user:fixture-shared-lane"


@pytest.mark.parametrize(
    ("limit", "window_seconds"),
    [("1 per hour", 3600), ("1 per minute", 60), ("1 per day", 86400)],
)
def test_retry_after_is_bounded_by_the_limits_window_not_an_invented_60(
    limit: str, window_seconds: int
) -> None:
    """Refused straight after the first hit, the wait is (almost) the whole
    window — whatever its length, never a fixed 60."""
    client = TestClient(
        _probe_app(get_peer_ip_identifier, limit=limit), client=(CLIENT_HOST, 50000)
    )
    item = str(uuid4())
    with capture_logs() as logs:
        assert client.get(f"/probe/{item}").status_code == 200
        refused = client.get(f"/probe/{item}")
    assert refused.status_code == 429
    retry_after = int(refused.headers["Retry-After"])
    assert window_seconds - 5 <= retry_after <= window_seconds
    lines = [entry for entry in logs if entry.get("event") == "rate_limit_refused"]
    assert [line["retry_after"] for line in lines] == [str(retry_after)]


def test_retry_after_is_the_time_until_this_keys_window_resets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ten minutes into a ``1 per hour`` window, the caller waits the 50
    minutes left — read from the limiter's own (memory) storage — not the
    window's full hour."""
    import time as time_module

    client = TestClient(
        _probe_app(get_peer_ip_identifier, limit="1 per hour"),
        client=(CLIENT_HOST, 50000),
    )
    item = str(uuid4())
    started = time_module.time()
    assert client.get(f"/probe/{item}").status_code == 200
    monkeypatch.setattr(time_module, "time", lambda: started + 600)
    refused = client.get(f"/probe/{item}")
    assert refused.status_code == 429
    # ceil() of the 50 minutes left, measured from the first hit.
    assert 2995 <= int(refused.headers["Retry-After"]) <= 3001


def test_retry_after_falls_back_to_the_window_when_storage_cannot_say(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unreadable(*args: Any, **kwargs: Any) -> Any:
        raise ConnectionError("storage unreachable")

    monkeypatch.setattr(user_limiter.limiter, "get_window_stats", unreadable)
    client = TestClient(
        _probe_app(get_peer_ip_identifier, limit="1 per hour"),
        client=(CLIENT_HOST, 50000),
    )
    item = str(uuid4())
    assert client.get(f"/probe/{item}").status_code == 200
    refused = client.get(f"/probe/{item}")
    assert refused.status_code == 429
    assert refused.headers["Retry-After"] == "3600"


# --------------------------------------------------------------------------
# Key kinds the probe cannot reach, and the UNKNOWN arms
# --------------------------------------------------------------------------


def _bare_request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/probe/x",
            "headers": [],
            "query_string": b"",
            "client": (CLIENT_HOST, 50000),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )


def test_a_refresh_token_subject_key_reads_as_user() -> None:
    """``_get_refresh_token_subject`` keys ``refresh-user:<sub>``."""
    from app.middleware.rate_limit import _refusal_key_kind

    assert (
        _refusal_key_kind(_bare_request(), lambda request: f"refresh-user:{USER_ID}")
        == "user"
    )


def test_a_key_function_that_raises_reads_as_unknown() -> None:
    from app.middleware.rate_limit import _refusal_key_kind

    def broken(request: Request) -> str:
        raise RuntimeError(BEARER)

    assert _refusal_key_kind(_bare_request(), broken) == "unknown"


@pytest.mark.asyncio
async def test_a_refusal_with_no_limit_reads_as_unknown() -> None:
    from limits import parse
    from slowapi.wrappers import Limit

    exc = RateLimitExceeded(
        Limit(
            parse("1 per minute"),
            get_remote_address,
            None,
            False,
            None,
            None,
            None,
            1,
            False,
        )
    )
    exc.limit = None  # type: ignore[assignment]
    response = await rate_limit_exceeded_handler(_bare_request(), exc)
    assert response.status_code == 429
    assert response.headers["X-RateLimit-Key-Kind"] == "unknown"
    assert response.headers["X-RateLimit-Lane"] == "unknown:unknown"
    assert response.headers["Retry-After"] == "60"


# --------------------------------------------------------------------------
# The refusal line carries only its own fields, through the REAL log chain
# --------------------------------------------------------------------------


def test_the_refused_line_carries_no_request_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``RequestIDMiddleware`` binds ``client_host`` and the concrete ``path``
    into structlog's context, and the app's ``configure_logging`` chain merges
    that context into every line. The refusal line must not inherit them.

    Run through ``configure_logging``'s own processor chain and its own
    console formatter, not ``capture_logs`` (which replaces the chain and so
    never merges context). Only the formatter's output stream is ours: a
    private buffer, so no global handler is left pointing at a test's stream.
    Logger caching is switched off for the test's duration, and the two
    module loggers the request path logs through are fresh proxies, so no
    logger built on the production chain is cached anywhere: restoring the
    previous handlers and structlog configuration afterwards restores the
    logging state the test found.
    """
    import io
    import json
    import logging

    import structlog

    import app.middleware.rate_limit as rate_limit_module
    import app.middleware.request_id as request_id_module
    from app.config.logging_config import configure_logging

    root = logging.getLogger()
    previous_handlers = list(root.handlers)
    previous_level = root.level
    previous_config = structlog.get_config()
    buffer = io.StringIO()
    try:
        configure_logging("production")
        structlog.configure(cache_logger_on_first_use=False)
        capture = logging.StreamHandler(buffer)
        capture.setFormatter(root.handlers[0].formatter)
        root.handlers = [capture]
        # The module's proxy may have cached a logger built under an earlier
        # configuration; a fresh proxy binds to this one.
        monkeypatch.setattr(
            rate_limit_module,
            "logger",
            structlog.get_logger(rate_limit_module.__name__),
        )
        monkeypatch.setattr(
            request_id_module,
            "logger",
            structlog.get_logger(request_id_module.__name__),
        )
        client = TestClient(
            _probe_app(get_peer_ip_identifier, request_id_middleware=True),
            client=(CLIENT_HOST, 50000),
        )
        item = str(uuid4())
        request_id = f"req-{uuid4().hex}"
        assert client.get(f"/probe/{item}").status_code == 200
        assert (
            client.get(
                f"/probe/{item}", headers={"X-Request-ID": request_id}
            ).status_code
            == 429
        )
    finally:
        root.handlers = previous_handlers
        root.setLevel(previous_level)
        structlog.configure(**previous_config)
        structlog.contextvars.clear_contextvars()
    out = buffer.getvalue()

    records = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    refused = [r for r in records if r.get("event") == "rate_limit_refused"]
    assert len(refused) == 1, out
    line = refused[0]
    assert line["lane"] == "user:/probe/{item_id}"
    # `bucket_kind`, not `key_kind`: the sanitizer redacts any `*key*` field.
    assert line["bucket_kind"] == "peer"
    raw = json.dumps(line)
    assert CLIENT_HOST not in raw
    assert item not in raw
    assert "client_host" not in line
    assert "path" not in line
    # The request id identifies the request, not the caller: it stays, so the
    # refusal joins the request's own started/completed lines.
    assert line["request_id"] == request_id
    # Positive control: this request's request_started line carries
    # client_host, so the context WAS bound when the refusal logged — its
    # absence above is the set-aside, not a context that was never there.
    started = [
        r
        for r in records
        if r.get("event") == "request_started" and r.get("request_id") == request_id
    ]
    assert [r.get("client_host") for r in started] == [CLIENT_HOST], out
    # And the refusal joins the request's completion line by request_id.
    assert any(
        r.get("event") == "request_completed" and r.get("request_id") == request_id
        for r in records
    ), out
    # slowapi's own refusal warning names the bucket KEY and the concrete path
    # ("ratelimit 1 per 1 minute (peer:<addr>) exceeded at endpoint: /probe/<id>").
    # The refusal line above replaces it; it must not be emitted.
    assert not [r for r in records if r.get("logger") == "slowapi"], out


def test_the_handler_restores_the_request_context_it_set_aside() -> None:
    import structlog

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(client_host=CLIENT_HOST, path="/probe/x")
    try:
        from app.middleware.rate_limit import _log_refusal

        _log_refusal(
            lane="/probe/{item_id}",
            bucket_kind="peer",
            limit="1 per 1 minute",
            method="GET",
            retry_after="60",
        )
        assert structlog.contextvars.get_contextvars() == {
            "client_host": CLIENT_HOST,
            "path": "/probe/x",
        }
    finally:
        structlog.contextvars.clear_contextvars()


def test_the_handler_restores_the_context_when_the_log_call_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import structlog

    import app.middleware.rate_limit as rate_limit_module

    class _Raising:
        def warning(self, *args: Any, **kwargs: Any) -> None:
            raise RuntimeError("log sink failed")

    monkeypatch.setattr(rate_limit_module, "logger", _Raising())
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id="req-1", client_host=CLIENT_HOST, path="/probe/x"
    )
    try:
        with pytest.raises(RuntimeError, match="log sink failed"):
            rate_limit_module._log_refusal(lane="/probe/{item_id}")
        assert structlog.contextvars.get_contextvars() == {
            "request_id": "req-1",
            "client_host": CLIENT_HOST,
            "path": "/probe/x",
        }
    finally:
        structlog.contextvars.clear_contextvars()


# --------------------------------------------------------------------------
# Which limiter refused: every module Limiter is enumerated and named
# --------------------------------------------------------------------------


def test_every_limiter_in_the_module_is_enumerated_and_named() -> None:
    """The module's ``Limiter(...)`` assignments, read from its SOURCE, are
    exactly the limiters the handler enumerates, each with a lane name. A new
    limiter that is not enumerated, or has no name, fails here."""
    import ast
    import inspect

    import app.middleware.rate_limit as rate_limit_module

    tree = ast.parse(inspect.getsource(rate_limit_module))
    declared = {
        target.id
        for node in tree.body
        if isinstance(node, ast.Assign)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "Limiter"
        for target in node.targets
        if isinstance(target, ast.Name)
    }
    assert declared, "no Limiter(...) assignment found"
    enumerated = rate_limit_module._module_limiters()
    assert {variable for variable, _name, _obj in enumerated} == declared
    names = [name for _variable, name, _obj in enumerated]
    assert len(set(names)) == len(names), names
    assert all(name and name != "unknown" for name in names), names
    assert {v: n for v, n, _ in enumerated} == {
        "limiter": "default",
        "user_limiter": "user",
        "auth_limiter": "auth",
        "api_limiter": "api",
        "refresh_limiter": "refresh",
    }


def test_a_dynamic_limit_still_names_its_limiter() -> None:
    """A callable limit string is held in ``_dynamic_route_limits``, and
    slowapi builds a fresh ``Limit`` from it per request."""
    app = FastAPI()
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]

    async def probe(request: Request, item_id: str) -> dict[str, str]:
        return {"ok": item_id}

    probe.__name__ = f"probe_{uuid4().hex}"
    limited = user_limiter.limit(
        lambda: "1 per minute", key_func=get_peer_ip_identifier
    )(probe)
    app.get("/probe/{item_id}")(limited)
    client = TestClient(app, client=(CLIENT_HOST, 50000))
    item = str(uuid4())
    assert client.get(f"/probe/{item}").status_code == 200
    refused = client.get(f"/probe/{item}")
    assert refused.status_code == 429
    assert refused.headers["X-RateLimit-Lane"] == "user:/probe/{item_id}"


def test_a_limit_no_module_limiter_holds_reads_as_unknown_limiter() -> None:
    from slowapi import Limiter

    stray = Limiter(key_func=get_peer_ip_identifier, storage_uri="memory://")
    app = FastAPI()
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]

    async def probe(request: Request, item_id: str) -> dict[str, str]:
        return {"ok": item_id}

    probe.__name__ = f"probe_{uuid4().hex}"
    app.get("/probe/{item_id}")(stray.limit("1 per minute")(probe))
    client = TestClient(app, client=(CLIENT_HOST, 50000))
    item = str(uuid4())
    assert client.get(f"/probe/{item}").status_code == 200
    refused = client.get(f"/probe/{item}")
    assert refused.status_code == 429
    assert refused.headers["X-RateLimit-Lane"] == "unknown:/probe/{item_id}"


# --------------------------------------------------------------------------
# Key functions are called the way slowapi calls them
# --------------------------------------------------------------------------


def test_a_key_function_without_a_request_parameter_is_called_without_one() -> None:
    """slowapi calls a key function with the request only when it declares a
    parameter named ``request``; otherwise with no arguments."""
    from app.middleware.rate_limit import _refusal_key_kind

    def no_request() -> str:
        return "bearer:fixture"

    assert _refusal_key_kind(_bare_request(), no_request) == "bearer"


# --------------------------------------------------------------------------
# slowapi's own refusal line is dropped; its other warnings are not
# --------------------------------------------------------------------------


class _Collect(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


def test_slowapis_refusal_line_is_dropped_and_its_storage_warnings_kept() -> None:
    import app.middleware.rate_limit  # noqa: F401  (installs the filter)

    slowapi_logger = logging.getLogger("slowapi")
    collect = _Collect()
    slowapi_logger.addHandler(collect)
    try:
        slowapi_logger.warning(
            "ratelimit %s (%s) exceeded at endpoint: %s",
            "1 per 1 minute",
            f"peer:{CLIENT_HOST}",
            "/probe/x",
        )
        slowapi_logger.warning(
            "Rate limit storage unreachable - falling back to in-memory storage"
        )
        slowapi_logger.warning("Rate limit storage recovered")
        slowapi_logger.error(
            "Skipping limit: %s. Empty value found in parameters.", "x"
        )
    finally:
        slowapi_logger.removeHandler(collect)
    assert [r.getMessage() for r in collect.records] == [
        "Rate limit storage unreachable - falling back to in-memory storage",
        "Rate limit storage recovered",
        "Skipping limit: x. Empty value found in parameters.",
    ]
