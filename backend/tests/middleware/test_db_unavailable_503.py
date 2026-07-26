"""Keystone regression test for the 2026-07-21 pool-saturation incident.

When the DB pool saturates, QueuePool raises ``sqlalchemy.exc.TimeoutError``.
Unhandled, it reached Starlette's ServerErrorMiddleware — which sits OUTSIDE
CORSMiddleware — so browsers got a bare 500 without
``Access-Control-Allow-Origin`` and reported it as a CORS failure.

The fix is TYPED per-class handlers, which Starlette dispatches in
ExceptionMiddleware INSIDE the middleware stack, so the 503 passes through
CORSMiddleware. This test pins both halves: the honest 503 + Retry-After,
AND the CORS header on the error response. It exists precisely to fail if
anyone replaces the typed handlers with an ``Exception`` catch-all
"simplification" — a catch-all runs in ServerErrorMiddleware, outside CORS,
and silently reintroduces the incident.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

# The allowed test origin, per tests/conftest.py:
#   BACKEND_CORS_ORIGINS='["http://localhost:3000"]'
ALLOWED_ORIGIN = "http://localhost:3000"

_TIMEOUT_PATH = "/_test/db-pool-timeout"
_OPERATIONAL_PATH = "/_test/db-operational-error"
_INTERFACE_PATH = "/_test/db-interface-error"
_CONNECT_REFUSED_PATH = "/_test/db-connection-refused"
_TEST_PATHS = (
    _TIMEOUT_PATH,
    _OPERATIONAL_PATH,
    _INTERFACE_PATH,
    _CONNECT_REFUSED_PATH,
)


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """The REAL app (real handler registrations + middleware stack) with two
    test-only routes that simulate the two DB-unavailable failures.

    No ``with``-block: lifespan (DB init, scheduler, ...) is not needed for
    exception-handler dispatch and must not run here.
    """
    from app.main import app

    async def _raise_pool_timeout() -> None:
        raise SQLAlchemyTimeoutError(
            "QueuePool limit of size 5 overflow 10 reached, "
            "connection timed out, timeout 30.00"
        )

    async def _raise_operational() -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    async def _raise_interface() -> None:
        raise InterfaceError("SELECT 1", {}, Exception("connection is closed"))

    async def _raise_connection_refused() -> None:
        raise ConnectionRefusedError(111, "Connection refused")

    app.add_api_route(_TIMEOUT_PATH, _raise_pool_timeout, methods=["GET"])
    app.add_api_route(_OPERATIONAL_PATH, _raise_operational, methods=["GET"])
    app.add_api_route(_INTERFACE_PATH, _raise_interface, methods=["GET"])
    app.add_api_route(_CONNECT_REFUSED_PATH, _raise_connection_refused, methods=["GET"])
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        # The app object is shared session-wide — drop the test-only routes.
        app.router.routes[:] = [
            r for r in app.router.routes if getattr(r, "path", None) not in _TEST_PATHS
        ]


@pytest.mark.parametrize(
    "path",
    [_TIMEOUT_PATH, _OPERATIONAL_PATH, _INTERFACE_PATH, _CONNECT_REFUSED_PATH],
    ids=[
        "pool_timeout",
        "operational_error",
        "interface_error",
        "connection_refused",
    ],
)
def test_db_unavailable_is_typed_503_with_cors_headers(
    client: TestClient, path: str
) -> None:
    response = client.get(path, headers={"Origin": ALLOWED_ORIGIN})

    assert response.status_code == 503

    # THE load-bearing assertion: the error response was produced inside the
    # middleware stack and passed through CORSMiddleware. A catch-all
    # Exception handler (ServerErrorMiddleware, outside CORS) loses this
    # header and the browser misreports the outage as a CORS failure.
    assert response.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN

    # Honest, retryable failure mode.
    assert response.headers.get("retry-after") == "5"
    body = response.json()
    assert body["error"] == "SERVICE_UNAVAILABLE"
    assert "atabase" in body["message"]  # Database... wording, case-proof
    assert body["path"].endswith(path)


def test_db_unavailable_503_without_origin_header(client: TestClient) -> None:
    """Non-browser clients (no Origin) still get the typed 503."""
    response = client.get(_TIMEOUT_PATH)

    assert response.status_code == 503
    assert response.headers.get("retry-after") == "5"
    assert response.json()["error"] == "SERVICE_UNAVAILABLE"


def test_asyncpg_connect_refusal_raises_builtin_connection_refused() -> None:
    """Pin the DRIVER reality the handler registrations depend on.

    With the DB unreachable, the asyncpg dialect raises builtin
    ``ConnectionRefusedError`` at connect time — NOT ``OperationalError``
    (the asyncpg dialect never translates to it). If this assertion ever
    fails after a SQLAlchemy/asyncpg upgrade, the 503 handler registrations
    in ``app/main.py`` must be re-verified against the new exception classes.
    """
    engine = create_async_engine(
        "postgresql+asyncpg://u:p@127.0.0.1:1/db",
        poolclass=NullPool,
        connect_args={"timeout": 5},
    )

    async def _probe() -> BaseException:
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except BaseException as exc:  # noqa: BLE001 - the class IS the assertion
            return exc
        finally:
            await engine.dispose()
        raise AssertionError("connect to 127.0.0.1:1 unexpectedly succeeded")

    exc = asyncio.run(_probe())
    assert isinstance(exc, ConnectionRefusedError), (
        f"expected builtin ConnectionRefusedError, got {type(exc).__module__}."
        f"{type(exc).__qualname__}: {exc!r}"
    )


def test_metrics_middleware_samples_pool_on_every_request(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pool sampler must run for ANY request path (review HIGH-1).

    MetricsMiddleware's EXCLUDED_PATHS contains "/" matched via startswith,
    which excludes every path from the metrics logic below it — so the
    sampler must sit ABOVE that early-return. This fails if the sampling
    call moves back below the exclusion check.
    """
    import app.middleware.metrics_middleware as mm

    calls: list[bool] = []
    monkeypatch.setattr(mm, "observe_async_engine_pool", lambda: calls.append(True))

    client.get("/api/v1/does-not-exist")  # any path, even a 404

    assert calls, "observe_async_engine_pool did not run for a request"
