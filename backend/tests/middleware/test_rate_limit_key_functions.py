"""What every backend rate-limit bucket is keyed on.

Plan ``2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429``
Phase 4. Behind the ALB ``request.client.host`` is an ALB node address (uvicorn
trusts ``X-Forwarded-For`` from loopback only unless ``FORWARDED_ALLOW_IPS``
says otherwise), so a key function that falls back to it puts every caller
reaching that node into ONE bucket. ``user_limiter`` used to do exactly that:
it read ``request.state.user``, which nothing sets, and so always returned
``ip:{client.host}``.

The contract pinned here:

* a bearer identifies the caller — two bearers on one host never share a
  bucket, and one bearer from two peers always does;
* with no bearer the key is the RIGHTMOST ``X-Forwarded-For`` entry (the
  address the ALB appended), so a forged leftmost entry buys no fresh bucket;
* no key function reachable from ``backend/app`` keys on ``client.host`` alone
  when ``X-Forwarded-For`` is present. That last test is enumerated — every
  ``key_func=`` in ``backend/app`` and every ``Limiter`` in ``rate_limit.py`` —
  not a sample.
"""

from __future__ import annotations

import ast
import hashlib
import importlib
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request

from app.middleware import rate_limit
from app.middleware.rate_limit import (
    get_authorization_identifier,
    get_user_identifier,
    rate_limit_exceeded_handler,
    user_limiter,
)

APP_DIR = Path(__file__).resolve().parents[2] / "app"

# An ALB node's private address: what ``request.client.host`` reads behind the
# load balancer. A key that contains it has collapsed onto the node.
ALB_NODE = "10.0.1.17"
CALLER_PEER = "203.0.113.9"

_USERS_ME_LIMIT = 200  # ``@user_limiter.limit("200 per minute")`` on GET /users/me


def _request(
    *,
    host: str = ALB_NODE,
    xff: str | None = None,
    bearer: str | None = None,
    authorization: str | None = None,
    access_token_cookie: str | None = None,
) -> Request:
    """A real Starlette request, as slowapi hands it to a key function.

    ``bearer`` sends ``Authorization: Bearer <bearer>``; ``authorization``
    sends a raw header value instead, for the scheme-parsing edge cases.
    """
    headers: list[tuple[bytes, bytes]] = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    if bearer is not None:
        headers.append((b"authorization", f"Bearer {bearer}".encode()))
    if authorization is not None:
        headers.append((b"authorization", authorization.encode()))
    if access_token_cookie is not None:
        headers.append((b"cookie", f"access_token={access_token_cookie}".encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "query_string": b"",
            "headers": headers,
            "client": (host, 40000),
        }
    )


# ---------------------------------------------------------------------------
# (a) two bearers on one host get independent buckets
# ---------------------------------------------------------------------------


@pytest.fixture
def users_me_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The real ``users.py`` router, limited by the real ``user_limiter``.

    The limiter's storage is swapped for a fresh in-memory one for this test
    only, so the budget starts full and no other test's traffic counts.
    Only the auth dependency is stubbed: it returns one user whatever the
    bearer, which is the point — the bucket must follow the bearer, not the
    user row and not the host.
    """
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.users import router as users_router

    storage = MemoryStorage()
    monkeypatch.setattr(user_limiter, "_storage", storage)
    monkeypatch.setattr(user_limiter, "_limiter", FixedWindowRateLimiter(storage))

    caller = SimpleNamespace(
        id=uuid4(),
        email="caller@example.com",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        username="caller",
        subscription_tier="free",
        created_at="2026-11-23T00:00:00Z",
        updated_at="2026-11-23T00:00:00Z",
    )

    app = FastAPI()
    app.state.limiter = user_limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_current_active_user_async] = lambda: caller
    app.include_router(users_router, prefix="/api/v1/users")
    return TestClient(app)


def test_two_bearers_on_one_host_get_distinct_keys() -> None:
    # Key level: same socket peer (the ALB node), different bearers.
    key_a = get_user_identifier(_request(bearer="token-a"))
    key_b = get_user_identifier(_request(bearer="token-b"))
    assert key_a != key_b
    assert key_a.startswith("bearer:") and key_b.startswith("bearer:")
    assert "token-a" not in key_a  # hashed, never embedded


def test_two_bearers_on_one_host_get_independent_buckets(
    users_me_client: TestClient,
) -> None:
    # Endpoint level, entered only through GET /api/v1/users/me: bearer A
    # spends its whole budget ...
    auth_a = {"Authorization": "Bearer token-a"}
    auth_b = {"Authorization": "Bearer token-b"}
    codes_a = [
        users_me_client.get("/api/v1/users/me", headers=auth_a).status_code
        for _ in range(_USERS_ME_LIMIT)
    ]
    assert codes_a == [200] * _USERS_ME_LIMIT
    assert users_me_client.get("/api/v1/users/me", headers=auth_a).status_code == 429

    # ... and bearer B, on the very same host, still has all of its own.
    assert users_me_client.get("/api/v1/users/me", headers=auth_b).status_code == 200


# ---------------------------------------------------------------------------
# (b) one bearer from two peers shares one bucket
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key_func", [get_user_identifier, get_authorization_identifier]
)
def test_the_same_bearer_from_two_peers_shares_one_bucket(
    key_func: Callable[[Request], str],
) -> None:
    from_home = key_func(
        _request(host="10.0.1.17", xff="198.51.100.4", bearer="token-a")
    )
    from_office = key_func(
        _request(host="10.0.2.33", xff="192.0.2.80", bearer="token-a")
    )
    assert from_home == from_office
    assert from_home.startswith("bearer:")


# ---------------------------------------------------------------------------
# (c) no bearer: rightmost X-Forwarded-For, a forged leftmost entry is ignored
# ---------------------------------------------------------------------------


def _no_bearer_key_funcs() -> list[Callable[[Request], str]]:
    return [
        get_user_identifier,
        get_authorization_identifier,
        rate_limit.limiter._key_func,
        rate_limit.auth_limiter._key_func,
        rate_limit.api_limiter._key_func,
        rate_limit.refresh_limiter._key_func,
    ]


@pytest.mark.parametrize(
    "key_func", _no_bearer_key_funcs(), ids=lambda f: getattr(f, "__name__", "?")
)
def test_no_bearer_keys_on_the_rightmost_forwarded_entry(
    key_func: Callable[[Request], str],
) -> None:
    honest = key_func(_request(xff=f"198.51.100.4, {CALLER_PEER}"))
    forged = key_func(_request(xff=f"6.6.6.6, {CALLER_PEER}"))
    forged_again = key_func(_request(xff=f"7.7.7.7, 8.8.8.8, {CALLER_PEER}"))

    assert honest == f"peer:{CALLER_PEER}"
    assert forged == honest
    assert forged_again == honest


def test_no_forwarded_header_keys_on_the_socket_peer() -> None:
    """A request that reached the task directly (dev, a health probe) has no
    ``X-Forwarded-For``; the socket peer is then the honest answer."""
    assert get_user_identifier(_request(host="192.0.2.5")) == "peer:192.0.2.5"


def test_get_user_identifier_does_not_read_request_state_user() -> None:
    """Nothing in ``backend/app`` assigns ``request.state.user``. A key that
    honoured it would be a second, unverified identity source."""
    request = _request(xff=CALLER_PEER)
    request.state.user = SimpleNamespace(id="forged-user")
    assert get_user_identifier(request) == f"peer:{CALLER_PEER}"


# ---------------------------------------------------------------------------
# (d) enumerated: no key function keys on client.host alone when XFF is present
# ---------------------------------------------------------------------------


def _module_name(path: Path) -> str:
    rel = path.relative_to(APP_DIR.parent).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _key_func_references() -> list[tuple[str, int, ast.expr]]:
    """Every ``key_func=<expr>`` keyword argument anywhere under ``backend/app``."""
    found: list[tuple[str, int, ast.expr]] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        source = path.read_text(encoding="utf-8")
        if "key_func" not in source:
            continue
        tree = ast.parse(source, filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for kw in node.keywords:
                if kw.arg == "key_func":
                    found.append((_module_name(path), node.lineno, kw.value))
    return found


def _resolve(module_name: str, expr: ast.expr) -> Callable[..., str]:
    """The callable a ``key_func=`` expression names, read off the imported
    module. A lambda or any other inline expression is refused: it cannot be
    enumerated, so it must be a named function this test can exercise."""
    module = importlib.import_module(module_name)
    if isinstance(expr, ast.Name):
        return getattr(module, expr.id)
    if isinstance(expr, ast.Attribute) and isinstance(expr.value, ast.Name):
        return getattr(getattr(module, expr.value.id), expr.attr)
    raise AssertionError(
        f"{module_name}: key_func={ast.unparse(expr)} is not a named function"
    )


def _enumerated_key_funcs() -> list[tuple[str, Callable[..., str]]]:
    funcs: list[tuple[str, Callable[..., str]]] = []
    for module_name, lineno, expr in _key_func_references():
        funcs.append(
            (f"{module_name}:{lineno}:{ast.unparse(expr)}", _resolve(module_name, expr))
        )
    for name, value in sorted(vars(rate_limit).items()):
        if isinstance(value, Limiter):
            funcs.append((f"rate_limit.{name}._key_func", value._key_func))
    return funcs


@pytest.fixture(scope="module")
def enumerated_key_funcs() -> list[tuple[str, Callable[..., str]]]:
    """Built lazily, so an import or resolution failure fails the named
    tests that need it instead of breaking collection of the whole file."""
    return _enumerated_key_funcs()


def test_the_enumeration_covers_every_limiter(
    enumerated_key_funcs: list[tuple[str, Callable[..., str]]],
) -> None:
    """Guards the enumeration itself: the five module Limiters, plus the
    per-route ``key_func=`` overrides in public.py and operations."""
    limiter_names = {
        label for label, _ in enumerated_key_funcs if label.startswith("rate_limit.")
    }
    assert limiter_names == {
        "rate_limit.limiter._key_func",
        "rate_limit.user_limiter._key_func",
        "rate_limit.auth_limiter._key_func",
        "rate_limit.api_limiter._key_func",
        "rate_limit.refresh_limiter._key_func",
    }
    route_overrides = [
        label
        for label, _ in enumerated_key_funcs
        if not label.startswith("rate_limit.")
    ]
    assert any(
        label.startswith("app.api.v1.endpoints.public:") for label in route_overrides
    )
    assert any(
        label.startswith("app.api.v1.endpoints.operations:")
        for label in route_overrides
    )


def test_no_key_function_collapses_onto_the_socket_peer(
    enumerated_key_funcs: list[tuple[str, Callable[..., str]]],
) -> None:
    request = _request(host=ALB_NODE, xff=f"198.51.100.4, {CALLER_PEER}")
    collapsed = {
        label: key
        for label, key_func in enumerated_key_funcs
        if ALB_NODE in (key := key_func(request))
    }
    assert collapsed == {}, (
        "these key functions keyed on request.client.host although "
        "X-Forwarded-For was present, so every caller behind one ALB node "
        f"would share their bucket: {collapsed}"
    )


# ---------------------------------------------------------------------------
# The key follows the credential auth actually USES: the access_token cookie
# first, then the Authorization bearer (CookieOrBearerScheme's order).
# ---------------------------------------------------------------------------

_CREDENTIAL_CASES: list[dict[str, str]] = [
    {"access_token_cookie": "cookie-tok"},
    {"authorization": "Bearer header-tok"},
    {"access_token_cookie": "cookie-tok", "authorization": "Bearer junk-1"},
    {"access_token_cookie": "cookie-tok", "authorization": "Bearer junk-2"},
    {"access_token_cookie": "", "authorization": "Bearer header-tok"},
    {"authorization": "bearer lower-scheme"},
    {"authorization": "BEARER upper-scheme"},
    {"authorization": "Basic dXNlcjpwdw=="},
    {"authorization": "Bearer"},
    {"authorization": "Bearer "},
    {"authorization": "Bearer  two-spaces"},
    {"authorization": "Bearer tok with spaces"},
    {"authorization": ""},
    {},
]


@pytest.mark.parametrize("case", _CREDENTIAL_CASES, ids=repr)
@pytest.mark.parametrize(
    "key_func", [get_user_identifier, get_authorization_identifier]
)
def test_the_key_is_the_token_the_auth_scheme_extracts(
    case: dict[str, str], key_func: Callable[[Request], str]
) -> None:
    """Pins the key to the real ``CookieOrBearerScheme`` rather than to a
    restatement of it: whatever token the scheme hands fastapi-users is what
    the bucket is keyed on, and no token means the peer."""
    import asyncio

    from app.auth.config import cookie_or_bearer_transport

    request = _request(xff=CALLER_PEER, **case)
    token = asyncio.run(cookie_or_bearer_transport.scheme(request))
    expected = (
        "bearer:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
        if token
        else f"peer:{CALLER_PEER}"
    )
    assert key_func(request) == expected


@pytest.mark.parametrize(
    "key_func", [get_user_identifier, get_authorization_identifier]
)
def test_a_cookie_caller_cannot_buy_a_fresh_bucket_with_a_junk_bearer(
    key_func: Callable[[Request], str],
) -> None:
    keys = {
        key_func(_request(access_token_cookie="cookie-tok", bearer=f"junk-{i}"))
        for i in range(5)
    }
    assert len(keys) == 1


@pytest.fixture
def users_me_real_auth_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """GET /users/me through the REAL fastapi-users dependency.

    ``CookieOrBearerTransport`` -> ``CognitoJWTStrategy.read_token`` run
    unmodified, so which credential is used (cookie or header) is the
    production choice. Only the lowest layer is replaced: the Cognito
    verify-and-resolve call (``token -> User``), which needs JWKS and a
    database. It accepts exactly one token. The DB session dependency yields
    an unconnected ``AsyncSession`` so ``read_token``'s
    ``SQLAlchemyUserDatabase`` check holds without a database.
    """
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.v1.endpoints.users import router as users_router
    from app.auth import cognito_user
    from app.db.session import get_async_db

    storage = MemoryStorage()
    monkeypatch.setattr(user_limiter, "_storage", storage)
    monkeypatch.setattr(user_limiter, "_limiter", FixedWindowRateLimiter(storage))

    caller = SimpleNamespace(
        id=uuid4(),
        email="caller@example.com",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        username="caller",
        subscription_tier="free",
        created_at="2026-11-23T00:00:00Z",
        updated_at="2026-11-23T00:00:00Z",
    )

    async def _resolve(token: str, _session: object) -> SimpleNamespace:
        if token != "valid-cookie-token":
            raise cognito_user.CognitoAuthError("not the test token")
        return caller

    monkeypatch.setattr(cognito_user, "verify_cognito_token_and_resolve_user", _resolve)

    async def _unconnected_session():
        yield AsyncSession()

    app = FastAPI()
    app.state.limiter = user_limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_async_db] = _unconnected_session
    app.include_router(users_router, prefix="/api/v1/users")
    return TestClient(app)


def test_a_cookie_authed_caller_rotating_junk_bearers_still_hits_its_budget(
    users_me_real_auth_client: TestClient,
) -> None:
    client = users_me_real_auth_client
    client.cookies.set("access_token", "valid-cookie-token")
    codes = [
        client.get(
            "/api/v1/users/me", headers={"Authorization": f"Bearer junk-{i}"}
        ).status_code
        for i in range(_USERS_ME_LIMIT + 1)
    ]
    # Auth used the cookie every time (no 401 for the junk bearers) ...
    assert codes[:_USERS_ME_LIMIT] == [200] * _USERS_ME_LIMIT
    # ... so the bucket is the cookie's, and it runs out.
    assert codes[_USERS_ME_LIMIT] == 429


# ---------------------------------------------------------------------------
# The dev loopback exemption reads the same peer as the key
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "host,xff,exempt",
    [
        ("127.0.0.1", None, True),
        ("::1", None, True),
        ("127.0.0.1", "203.0.113.9", False),
        ("127.0.0.1", "127.0.0.1, 203.0.113.9", False),
        ("203.0.113.9", None, False),
    ],
)
def test_the_dev_loopback_exemption_reads_the_peer_the_key_reads(
    monkeypatch: pytest.MonkeyPatch, host: str, xff: str | None, exempt: bool
) -> None:
    monkeypatch.setattr(rate_limit.settings, "ENVIRONMENT", "development")
    request = _request(host=host, xff=xff)
    assert rate_limit._is_loopback_dev(request) is exempt
    peer = rate_limit.get_peer_ip_identifier(request).removeprefix("peer:")
    assert (peer in rate_limit._LOOPBACK_HOSTS) is exempt
