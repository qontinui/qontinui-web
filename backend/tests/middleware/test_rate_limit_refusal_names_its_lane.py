"""Every 429 this backend answers names the lane it was refused on.

Plan ``2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429``,
Phase 2. An exec-mode pass on qontinui.io drew a load-time 429 that no
instrument could attribute: the refusal body said ``RATE_LIMIT_EXCEEDED`` and
nothing else, so a reader could not tell WHICH limiter refused, or what kind of
key that limiter's bucket was keyed on (a bearer, a peer address, a user id, or
a proxy address every caller shares).

``rate_limit_exceeded_handler`` therefore stamps two headers on every refusal,
and logs one ``rate_limit_refused`` line carrying the same fields:

* ``X-RateLimit-Lane`` — the limit's scope when it has one, else the ROUTE
  TEMPLATE (``/api/v1/users/me``, ``/probe/{item_id}``), never the concrete
  path, which can carry an id.
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
    user_limiter.reset()
    yield
    user_limiter.reset()


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
    assert refused.headers["X-RateLimit-Lane"] == f"{API_PREFIX}/users/me"
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


def _probe_app(key_func: Any, *, attach_user: bool = False) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]
    if attach_user:
        app.add_middleware(_AttachUser)

    async def probe(request: Request, item_id: str) -> dict[str, str]:
        return {"ok": item_id}

    # slowapi registers a route's limits under `<module>.<function name>` and
    # EXTENDS that list on every decoration, so each probe gets its own name
    # rather than inheriting the previous parametrization's limit.
    probe.__name__ = f"probe_{uuid4().hex}"
    limited = user_limiter.limit("1 per minute", key_func=key_func)(probe)
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
    assert refused.headers["X-RateLimit-Lane"] == "/probe/{item_id}"

    lines = [entry for entry in logs if entry.get("event") == "rate_limit_refused"]
    assert len(lines) == 1, logs
    assert lines[0]["lane"] == "/probe/{item_id}"
    assert lines[0]["key_kind"] == kind

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
