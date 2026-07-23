"""Tenant-gate tests for the ``/operations`` coord-proxy routes.

Phase 1 of plan ``2026-07-21-web-operations-proxy-db-session-lifetime``:
``get_tenant_id`` no longer depends on ``get_current_active_user_async``,
so a request to a tenant-gated proxy route must NOT check out a Postgres
connection while it waits on the coord round-trip (the 2026-07-21 prod
pool exhaustion). Auth on these routes is enforced solely by the coord
identity boundary (``get_coord_identity`` -> coord ``GET /admin/coord/me``),
which fails closed: no/invalid bearer -> coord 4xx surfaced; non-member ->
403 ``tenant_not_resolved``; coord unreachable -> 502; timeout -> 504.

Follows the minimal-app pattern of ``test_operations_merge_proxy.py`` but
deliberately does NOT override ``get_tenant_id`` — the real dependency
chain is under test. The coord HTTP boundary is stubbed at the
``httpx.AsyncClient`` level (same posture as ``test_coord_identity.py``);
no live coord and no live Postgres are needed.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"

_HOME = UUID("11111111-1111-1111-1111-111111111111")


def _me_payload(*, home_roles: tuple[str, ...] = ("admin", "member")) -> dict[str, Any]:
    """A coord ``GET /admin/coord/me`` payload for a home-tenant member."""
    return {
        "operator_id": str(uuid4()),
        "home_tenant_id": str(_HOME),
        "tenant_id": str(_HOME),  # back-compat alias
        "email": "op@qontinui.io",
        "roles": list(home_roles),
        "tenants": [
            {"tenant_id": str(_HOME), "slug": "home-slug", "roles": list(home_roles)}
        ],
        "is_admin": "admin" in home_roles,
    }


def _response(status_code: int = 200, json_data: Any = None, text: str = "") -> Any:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text
    return resp


def _patch_transport(
    *,
    me_status: int = 200,
    me_payload: dict[str, Any] | None = None,
    me_exc: Exception | None = None,
    me_delay: float = 0.0,
):
    """Patch ``httpx.AsyncClient`` with a URL-dispatching coord stub.

    Both ``coord_identity._fetch_identity`` (the ``/admin/coord/me`` call)
    and ``operations._proxy_coord_get/_post`` (the proxied read) resolve
    ``httpx.AsyncClient`` at call time, so one module-level patch covers
    the whole request path. ``/admin/coord/me`` behavior is configurable;
    every other coord path returns ``200 []`` (the merge-queue shape).

    A ``/me`` call carrying NO ``Authorization`` header returns 401
    regardless of configuration — mirroring coord's fail-closed posture
    for an unauthenticated caller.
    """

    async def _handle(url: str, *args: Any, **kwargs: Any) -> Any:
        if url.endswith("/admin/coord/me"):
            if me_delay:
                await asyncio.sleep(me_delay)
            if me_exc is not None:
                raise me_exc
            headers = kwargs.get("headers") or {}
            if not headers.get("Authorization"):
                return _response(401, text="missing bearer")
            if me_status != 200:
                return _response(me_status, text="forbidden")
            payload = me_payload if me_payload is not None else _me_payload()
            return _response(200, json_data=payload)
        return _response(200, json_data=[])

    client = MagicMock()
    client.get = AsyncMock(side_effect=_handle)
    client.post = AsyncMock(side_effect=_handle)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return patch("httpx.AsyncClient", return_value=client), client


def _build_app(*, user_override: Any = None) -> FastAPI:
    """Operations router on a minimal app — ``get_tenant_id`` NOT overridden.

    ``user_override`` (when given) replaces ``get_current_active_user_async``
    for routes where it is still load-bearing (``require_coord_tenant_admin``).
    """
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if user_override is not None:
        test_app.dependency_overrides[get_current_active_user_async] = (
            lambda: user_override
        )
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


# ---------------------------------------------------------------------------
# The coord identity boundary is the (sole, fail-closed) gate on
# get_tenant_id routes — exercised via GET /operations/merge/queue.
# ---------------------------------------------------------------------------


class TestTenantGateFailClosed:
    def test_no_bearer_is_rejected(self) -> None:
        """A request with no bearer must NOT get a 200 after the dep deletion."""
        cm, stub = _patch_transport()
        with cm:
            client = TestClient(_build_app())
            resp = client.get(f"{API_PREFIX}/merge/queue")

        assert resp.status_code != 200
        assert resp.status_code == 401
        # The gate actually consulted coord's /me (the route is gated, not open).
        assert any(
            call.args[0].endswith("/admin/coord/me") for call in stub.get.call_args_list
        )

    def test_non_member_gets_403_tenant_not_resolved(self) -> None:
        cm, _ = _patch_transport(me_status=403)
        with cm:
            client = TestClient(_build_app())
            resp = client.get(
                f"{API_PREFIX}/merge/queue",
                headers={"Authorization": "Bearer tok"},
            )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"

    def test_coord_unreachable_returns_502(self) -> None:
        cm, _ = _patch_transport(me_exc=httpx.ConnectError("refused"))
        with cm:
            client = TestClient(_build_app())
            resp = client.get(
                f"{API_PREFIX}/merge/queue",
                headers={"Authorization": "Bearer tok"},
            )

        assert resp.status_code == 502

    def test_coord_timeout_returns_504(self) -> None:
        cm, _ = _patch_transport(me_exc=httpx.TimeoutException("slow"))
        with cm:
            client = TestClient(_build_app())
            resp = client.get(
                f"{API_PREFIX}/merge/queue",
                headers={"Authorization": "Bearer tok"},
            )

        assert resp.status_code == 504

    def test_member_bearer_passes_and_proxies(self) -> None:
        """Happy path: coord resolves the tenant and the proxy read succeeds."""
        cm, _ = _patch_transport(me_payload=_me_payload(home_roles=("member",)))
        with cm:
            client = TestClient(_build_app())
            resp = client.get(
                f"{API_PREFIX}/merge/queue",
                headers={"Authorization": "Bearer tok"},
            )

        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# require_coord_tenant_admin is deliberately NOT touched by this change —
# its current_user (is_superuser) parameter is load-bearing. Regression-guard
# the admin gate via POST /operations/agents/allocate.
# ---------------------------------------------------------------------------


class TestAdminGateStillEnforced:
    def test_non_admin_non_superuser_gets_403(self) -> None:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "member@example.com"
        mock_user.is_active = True
        mock_user.is_superuser = False

        cm, _ = _patch_transport(me_payload=_me_payload(home_roles=("member",)))
        with cm:
            client = TestClient(_build_app(user_override=mock_user))
            resp = client.post(
                f"{API_PREFIX}/agents/allocate",
                json={"machine_id": str(uuid4()), "repos": []},
                headers={"Authorization": "Bearer tok"},
            )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "not_coord_tenant_admin"


# ---------------------------------------------------------------------------
# The acceptance property (the one that failed in prod on 2026-07-21):
# a get_tenant_id-gated request holds ZERO pooled DB connections across the
# coord round-trip.
# ---------------------------------------------------------------------------


class TestNoDbCheckoutDuringTenantGate:
    def test_request_checks_out_zero_pool_connections(self) -> None:
        """Regression guard against re-adding a DB-touching dependency.

        Attaches a SQLAlchemy pool ``checkout`` listener to the app's shared
        ``async_engine`` for the duration of a gated request (with the coord
        round-trip artificially delayed, the window in which prod held its
        pooled connections). If anyone re-adds a dependency to
        ``get_tenant_id`` that touches the DB (e.g. the fastapi-users
        ``get_current_active_user_async`` chain), this test fails — either
        via a recorded checkout (live PG) or via a non-200 connect failure
        (no PG available to the suite).
        """
        from sqlalchemy import event
        from sqlalchemy.pool import QueuePool

        from app.db.session import async_engine

        checkouts: list[Any] = []

        def _on_checkout(dbapi_conn: Any, conn_record: Any, conn_proxy: Any) -> None:
            checkouts.append(conn_record)

        event.listen(async_engine.sync_engine, "checkout", _on_checkout)
        try:
            cm, stub = _patch_transport(me_delay=0.05)
            with cm:
                client = TestClient(_build_app())
                resp = client.get(
                    f"{API_PREFIX}/merge/queue",
                    headers={"Authorization": "Bearer tok"},
                )
        finally:
            event.remove(async_engine.sync_engine, "checkout", _on_checkout)

        assert resp.status_code == 200
        # The gate ran (coord /me consulted) ...
        assert any(
            call.args[0].endswith("/admin/coord/me") for call in stub.get.call_args_list
        )
        # ... and NO pooled DB connection was checked out during the request.
        assert checkouts == []
        # Belt-and-braces: nothing is still checked out afterwards either.
        # (AsyncAdaptedQueuePool subclasses QueuePool; the isinstance check
        # narrows the type for mypy, which types ``engine.pool`` as ``Pool``.)
        assert isinstance(async_engine.pool, QueuePool)
        assert async_engine.pool.checkedout() == 0
