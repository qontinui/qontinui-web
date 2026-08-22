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
import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
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
    proxy_payload: Any = None,
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
        return _response(200, json_data=[] if proxy_payload is None else proxy_payload)

    client = MagicMock()
    client.get = AsyncMock(side_effect=_handle)
    client.post = AsyncMock(side_effect=_handle)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return patch("httpx.AsyncClient", return_value=client), client


# ---------------------------------------------------------------------------
# Attributing pool checkouts to the REQUEST, not to whatever else the process
# happens to be doing.
#
# The zero-checkout guards below listen on the app's SHARED
# `app.db.session.async_engine`. That engine is shared with the in-process
# scheduler (`app/core/scheduler.py`), which the session-scoped `test_client`
# fixture starts via the app lifespan and which then ticks for the REST of the
# pytest session. Every tick takes a pooled connection for its
# `pg_try_advisory_lock(hashtext('sched:'||name))`, and the memory tasks
# (`memory_reindex` / `memory_consolidate` / `memory_bridge_sync`) are
# deliberately left ENABLED in `tests/conftest.py` because
# `test_memory_api_db.py` depends on them having run.
#
# An unscoped listener records those ticks as if the gated request had caused
# them, so `assert checkouts == []` failed intermittently — on a DIFFERENT test
# each time, whichever one happened to overlap a tick. Observed reds: a
# `SELECT DISTINCT tenant_id FROM coord.memory_records` sweep and the
# `('memory_reindex',)` advisory lock.
#
# The fix attributes checkouts instead of silencing the guard. An ASGI
# middleware sets `_IN_REQUEST` for the duration of the request, so everything
# the request itself causes — dependencies, the endpoint body, tasks it spawns,
# threadpool calls it makes, and SQLAlchemy's own `greenlet_spawn` (which
# copies `gr_context`) — runs in a contextvars Context descended from it. A
# scheduler tick lives in a Context created long before, on the lifespan
# portal's event loop, so it is not.
#
# Be honest about the direction this fails in. The marker is two-state, so an
# UNMARKED context is ignored — a checkout is not required to prove it belongs
# to somebody else, only to fail to prove it belongs to the request. That makes
# the guard fail OPEN if the marker ever stops arriving: no middleware on the
# app under test, a scope the middleware passes through, or a dependency change
# that breaks contextvars propagation, and every assertion below goes vacuously
# green. (A tri-state — background contexts positively marked False — would
# fail closed, but nothing here can reach into the scheduler's Context to mark
# it.) `TestRequestScopedCheckoutAttribution` below is the positive control
# that keeps this honest: it fails if the marker stops reaching the listener.
#
# One known escape hatch: bare `loop.run_in_executor(None, ...)` does NOT copy
# the Context (unlike `asyncio.to_thread` and anyio's `to_thread.run_sync`,
# both of which do). Nothing on the `get_tenant_id` path uses it today.
# ---------------------------------------------------------------------------

_IN_REQUEST: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "operations_tenant_gate_in_request", default=False
)


class _MarkRequestContext:
    """Pure-ASGI middleware that marks the request's contextvars Context.

    Pure ASGI (not ``BaseHTTPMiddleware``) so the marker is set in the SAME
    task that runs the dependency chain and the endpoint — no task hop, no
    context copy that could drop it.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        # `lifespan` is passed through DELIBERATELY and must stay that way: the
        # lifespan is where `scheduler.start()` creates its background tasks,
        # and a task created under a marked Context would inherit the marker —
        # turning every scheduler tick into a "request" checkout, which is the
        # bug this whole block exists to fix.
        if scope.get("type") not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        token = _IN_REQUEST.set(True)
        try:
            await self.app(scope, receive, send)
        finally:
            _IN_REQUEST.reset(token)


class _RequestPoolCheckouts:
    """Pool checkouts attributed to the request under test."""

    def __init__(self) -> None:
        self.checkouts: list[Any] = []
        # Keyed by `id(conn_record)` — so the mapping that does the bookkeeping
        # is also the one holding the strong reference that makes those ids
        # non-recyclable. (Keying off `checkouts` staying alive would be an
        # invariant one refactor away from an address-reuse miscount.)
        self._outstanding: dict[int, Any] = {}

    @property
    def outstanding(self) -> int:
        """Request-caused connections not yet returned to the pool."""
        return len(self._outstanding)


@contextmanager
def _record_request_pool_checkouts(engine: Any) -> Iterator[_RequestPoolCheckouts]:
    """Record only those ``engine`` pool checkouts the request itself caused."""
    from sqlalchemy import event
    from sqlalchemy.exc import InvalidRequestError

    recorder = _RequestPoolCheckouts()

    def _on_checkout(dbapi_conn: Any, conn_record: Any, conn_proxy: Any) -> None:
        if not _IN_REQUEST.get():
            # Positively somebody else's — a scheduler tick, a fixture, another
            # thread. Not the request's DB work, so not this guard's business.
            return
        recorder.checkouts.append(conn_record)
        recorder._outstanding[id(conn_record)] = conn_record

    def _on_checkin(dbapi_conn: Any, conn_record: Any) -> None:
        # NOT filtered on `_IN_REQUEST`: a connection can be returned outside
        # the request's context (e.g. by a GC'd session), and we only ever
        # discard ids this recorder itself put in.
        recorder._outstanding.pop(id(conn_record), None)

    try:
        event.listen(engine.sync_engine, "checkout", _on_checkout)
        event.listen(engine.sync_engine, "checkin", _on_checkin)
        yield recorder
    finally:
        # `event.remove` on a listener that was never attached raises, so both
        # removals are guarded — the point is that neither can be left behind
        # on the SHARED engine for the rest of the session.
        for name, fn in (("checkout", _on_checkout), ("checkin", _on_checkin)):
            try:
                event.remove(engine.sync_engine, name, fn)
            except InvalidRequestError:
                pass


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
    # Inert unless `_record_request_pool_checkouts` is active; installed on
    # every app so the zero-checkout guards need no special build.
    test_app.add_middleware(_MarkRequestContext)
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
        # No-bearer requests 401 locally WITHOUT an outbound coord call —
        # otherwise unauthenticated scanners could drive load against
        # coord's /admin/coord/me (amplification, review finding Low-1).
        assert not any(
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
# Follow-up sweep: three more get_tenant_id-gated routes had a vestigial
# direct ``current_user`` parameter (never referenced in the body) removed,
# so they too stop pinning a DB connection across the coord round-trip. Each
# must still be fail-closed via the SAME coord gate — this guards against the
# routes reading as "public" (their OpenAPI security[] declaration is stripped
# with the fastapi-users dep) actually meaning unauthenticated at runtime.
# ---------------------------------------------------------------------------

_VESTIGIAL_SWEEP_ROUTES = [
    "/agent-status",
    "/sessions",
    "/coord/next-step-settings",
]


class TestVestigialSweepRoutesStillGated:
    @pytest.mark.parametrize("route", _VESTIGIAL_SWEEP_ROUTES)
    def test_no_bearer_is_rejected_without_coord_call(self, route: str) -> None:
        """No bearer -> local 401, and NO outbound coord /me call.

        The route is NOT open after its ``current_user`` param was deleted —
        ``get_tenant_id`` short-circuits a no-bearer request to 401 before the
        coord round-trip (same amplification guard as the merge/queue gate).
        """
        cm, stub = _patch_transport()
        with cm:
            client = TestClient(_build_app())
            resp = client.get(f"{API_PREFIX}{route}")

        assert resp.status_code == 401
        assert not any(
            call.args[0].endswith("/admin/coord/me") for call in stub.get.call_args_list
        )

    @pytest.mark.parametrize("route", _VESTIGIAL_SWEEP_ROUTES)
    def test_non_member_gets_403(self, route: str) -> None:
        """A valid bearer whose operator is not a tenant member -> 403."""
        cm, _ = _patch_transport(me_status=403)
        with cm:
            client = TestClient(_build_app())
            resp = client.get(
                f"{API_PREFIX}{route}", headers={"Authorization": "Bearer tok"}
            )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"

    @pytest.mark.parametrize("route", _VESTIGIAL_SWEEP_ROUTES)
    def test_coord_unreachable_returns_502(self, route: str) -> None:
        cm, _ = _patch_transport(me_exc=httpx.ConnectError("refused"))
        with cm:
            client = TestClient(_build_app())
            resp = client.get(
                f"{API_PREFIX}{route}", headers={"Authorization": "Bearer tok"}
            )

        assert resp.status_code == 502

    def test_member_bearer_happy_path_body_still_functions(self) -> None:
        """A member bearer reaches each body post-param-removal.

        Proves the removal did not break the handler body (each route's
        coord re-fetch / response synthesis still runs). ``/agent-status``
        and ``/sessions`` return the coord payload directly; the
        ``/coord/next-step-settings`` body indexes the coord dict to add
        ``can_edit`` (``is_admin`` from the cached ``/me``), so it is stubbed
        with a dict payload.
        """
        for route, payload in (
            ("/agent-status", []),
            ("/sessions", []),
            ("/coord/next-step-settings", {"master_enabled": True, "domains": []}),
        ):
            cm, _ = _patch_transport(proxy_payload=payload)
            with cm:
                client = TestClient(_build_app())
                resp = client.get(
                    f"{API_PREFIX}{route}", headers={"Authorization": "Bearer tok"}
                )
            assert resp.status_code == 200, route
            if route == "/coord/next-step-settings":
                # can_edit synthesised from the member's is_admin (default
                # _me_payload includes "admin").
                assert resp.json()["can_edit"] is True

    @pytest.mark.parametrize("route", _VESTIGIAL_SWEEP_ROUTES)
    def test_request_checks_out_zero_pool_connections(self, route: str) -> None:
        """Each swept route holds ZERO pooled DB connections across the
        coord round-trip — the same regression guard applied to
        ``/merge/queue``, now covering the routes whose direct
        ``current_user`` (the only DB-touching dependency they had) was
        deleted."""
        from sqlalchemy.pool import QueuePool

        from app.db.session import async_engine

        payload: Any = (
            {"master_enabled": True, "domains": []}
            if route == "/coord/next-step-settings"
            else []
        )

        with _record_request_pool_checkouts(async_engine) as recorder:
            cm, _ = _patch_transport(me_delay=0.05, proxy_payload=payload)
            with cm:
                client = TestClient(_build_app())
                resp = client.get(
                    f"{API_PREFIX}{route}", headers={"Authorization": "Bearer tok"}
                )

        assert resp.status_code == 200
        assert recorder.checkouts == []
        assert isinstance(async_engine.pool, QueuePool)


# ---------------------------------------------------------------------------
# The attribution primitive the two zero-checkout guards above stand on.
#
# Pinned separately, and DETERMINISTICALLY: those guards can only observe
# attribution when a background tick happens to overlap their 50ms window, so
# a regression in `_record_request_pool_checkouts` (say, a filter that ignores
# everything) would show up there as a permanent green — the exact false-green
# this whole change exists to avoid. These tests race nothing: a throwaway
# SQLite engine stands in for the shared async engine, and the two contexts are
# produced by hand.
# ---------------------------------------------------------------------------


class TestRequestScopedCheckoutAttribution:
    @staticmethod
    def _engine_shim() -> Any:
        """An object shaped like ``AsyncEngine`` for the recorder's purposes."""
        from types import SimpleNamespace

        from sqlalchemy import create_engine

        # `check_same_thread=False`: FastAPI runs a `def` endpoint in an anyio
        # worker thread, so the test thread has to be able to clean up after it.
        return SimpleNamespace(
            sync_engine=create_engine(
                "sqlite://", connect_args={"check_same_thread": False}
            )
        )

    def test_checkout_caused_by_the_request_is_recorded(self) -> None:
        """The guard must still SEE a request's own DB work.

        The endpoint is deliberately ``def``, not ``async def``: FastAPI runs
        it in an anyio worker thread, so this also pins that the marker
        survives the threadpool hop (anyio copies the Context into the worker).
        A regression there would let a sync DB-touching dependency slip past.
        """
        from sqlalchemy import text

        shim = self._engine_shim()
        app = FastAPI()

        @app.get("/touch")
        def _touch() -> dict[str, bool]:  # noqa: ANN202 - test-local endpoint
            with shim.sync_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"ok": True}

        app.add_middleware(_MarkRequestContext)

        with _record_request_pool_checkouts(shim) as recorder:
            assert TestClient(app).get("/touch").status_code == 200

        assert len(recorder.checkouts) == 1
        assert recorder.outstanding == 0

    def test_request_that_leaks_a_connection_is_reported_outstanding(self) -> None:
        """``outstanding`` replaced the engine-wide ``pool.checkedout()``; it
        must still catch a connection the request never gives back."""
        from sqlalchemy import text

        shim = self._engine_shim()
        app = FastAPI()
        leaked: list[Any] = []

        @app.get("/leak")
        def _leak() -> dict[str, bool]:  # noqa: ANN202 - test-local endpoint
            conn = shim.sync_engine.connect()
            conn.execute(text("SELECT 1"))
            leaked.append(conn)  # never closed
            return {"ok": True}

        app.add_middleware(_MarkRequestContext)

        try:
            with _record_request_pool_checkouts(shim) as recorder:
                assert TestClient(app).get("/leak").status_code == 200
            assert len(recorder.checkouts) == 1
            assert recorder.outstanding == 1
        finally:
            for conn in leaked:
                conn.close()

    def test_checkout_from_a_background_thread_is_ignored(self) -> None:
        """A tick that merely overlaps the window is NOT the request's DB work.

        Stands in for the in-process scheduler, whose tasks run on the lifespan
        portal's event loop in their own Context.
        """
        import threading

        from sqlalchemy import text

        shim = self._engine_shim()

        def _background_tick() -> None:
            with shim.sync_engine.connect() as conn:
                conn.execute(text("SELECT 1"))

        with _record_request_pool_checkouts(shim) as recorder:
            worker = threading.Thread(target=_background_tick)
            worker.start()
            worker.join(timeout=30)

        assert recorder.checkouts == []
        assert recorder.outstanding == 0

    def test_the_real_app_marks_the_context_through_greenlet_spawn(self) -> None:
        """The positive control for the two guards above, on the REAL app.

        Those guards assert `== []`, so every way the marker can stop arriving
        reads there as green. This asserts the marker ARRIVES, on the app
        `_build_app()` actually returns, at the exact dispatch point a pool
        listener fires from: inside ``greenlet_spawn``, which is how SQLAlchemy
        runs sync pool code (and its event listeners) from async callers.

        It therefore fails — loudly, and with no Postgres — if the middleware
        stops being installed, or if a dependency upgrade breaks contextvars
        propagation across the greenlet hop.
        """
        from sqlalchemy.util import greenlet_spawn

        app = _build_app()

        @app.get("/__marker_probe")
        async def _probe() -> dict[str, Any]:  # noqa: ANN202 - test-local
            return {
                "in_task": _IN_REQUEST.get(),
                "in_greenlet": await greenlet_spawn(_IN_REQUEST.get),
            }

        body = TestClient(app).get("/__marker_probe").json()
        assert body == {"in_task": True, "in_greenlet": True}

    def test_marker_does_not_leak_past_the_request(self) -> None:
        """``_IN_REQUEST`` is reset, so a later foreign checkout stays ignored."""
        assert _IN_REQUEST.get() is False

        app = FastAPI()

        @app.get("/noop")
        async def _noop() -> dict[str, bool]:  # noqa: ANN202 - test-local
            assert _IN_REQUEST.get() is True
            return {"ok": True}

        app.add_middleware(_MarkRequestContext)
        assert TestClient(app).get("/noop").status_code == 200
        assert _IN_REQUEST.get() is False


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

        Checkouts are attributed to the request's own contextvars Context (see
        ``_record_request_pool_checkouts``), so a background scheduler tick on
        the shared engine is not mistaken for the request's DB work.
        """
        from sqlalchemy.pool import QueuePool

        from app.db.session import async_engine

        with _record_request_pool_checkouts(async_engine) as recorder:
            cm, stub = _patch_transport(me_delay=0.05)
            with cm:
                client = TestClient(_build_app())
                resp = client.get(
                    f"{API_PREFIX}/merge/queue",
                    headers={"Authorization": "Bearer tok"},
                )

        assert resp.status_code == 200
        # The gate ran (coord /me consulted) ...
        assert any(
            call.args[0].endswith("/admin/coord/me") for call in stub.get.call_args_list
        )
        # ... and NO pooled DB connection was checked out BY THE REQUEST.
        assert recorder.checkouts == []
        # (Zero checkouts already implies nothing of the request's is still
        # held, so there is no separate outstanding-count assertion here. The
        # engine-wide `pool.checkedout() == 0` this replaced could genuinely
        # catch a leak, but not without also counting a concurrent scheduler
        # tick; `recorder.outstanding` carries that weight in
        # `TestRequestScopedCheckoutAttribution`, where a leak is provoked.)
        #
        # (AsyncAdaptedQueuePool subclasses QueuePool; the isinstance check
        # narrows the type for mypy, which types ``engine.pool`` as ``Pool``.)
        assert isinstance(async_engine.pool, QueuePool)
