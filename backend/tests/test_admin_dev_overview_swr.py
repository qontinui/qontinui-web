"""Stale-while-revalidate tests for the admin dev-overview proxy.

Plan ``2026-06-29-coord-dashboard-deploy-resilience`` Phase 1: a coord ECS
rolling deploy causes a seconds-long leader failover during which a coord
read can time out. Because the gate/rollout reads are NOT leader-gated (any
caught-up replica serves them from Postgres), the data we just showed is
still valid — so on a coord-down error the proxy serves the last-known-good
envelope annotated ``coord_reconnecting`` instead of blanking the page with a
hard "unavailable" banner. The hard banner is reserved for a true cold start
(no last-known-good yet).

Mirrors the testing pattern in ``test_operations_gates_proxy.py``: a minimal
FastAPI app mounting the admin-dev router, with the member-auth gate
(``get_current_active_user_async`` — any authenticated tenant member) and the
best-effort bearer dependency overridden, and ``_proxy_coord_get`` patched so
no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


def _build_test_app() -> FastAPI:
    """Minimal app mounting the admin-dev router with auth deps overridden."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.admin_dev import _capture_bearer_best_effort
    from app.api.v1.endpoints.admin_dev import router as admin_dev_router

    app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    # Pin the resolved effective tenant to a stable key so a single cache
    # key is exercised across calls. (``None`` — identity unknown — now
    # BYPASSES the shared cache entirely, so SWR must be tested under a
    # validated tenant key; see test_identity_unknown_never_caches.)
    app.dependency_overrides[_capture_bearer_best_effort] = lambda: (
        "11111111-1111-1111-1111-111111111111"
    )
    app.include_router(admin_dev_router, prefix="/api/v1")
    return app


def _build_identity_unknown_app() -> FastAPI:
    """Same app but with identity resolution failed (tenant key ``None``)."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.admin_dev import _capture_bearer_best_effort
    from app.api.v1.endpoints.admin_dev import router as admin_dev_router

    app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    app.dependency_overrides[_capture_bearer_best_effort] = lambda: None
    app.include_router(admin_dev_router, prefix="/api/v1")
    return app


def _good_envelope() -> dict:
    """A successful coord dev-overview envelope (one gate, non-empty)."""
    return {
        "generated_at": "2026-06-29T12:00:00+00:00",
        "gates": [{"gate_id": "g1", "title": "demo gate"}],
        "counts": {
            "total": 1,
            "open": 1,
            "cleared": 0,
            "cleared_today": 0,
            "failed": 0,
            "stale": 0,
            "muted": 0,
            "snoozed": 0,
            "archived": 0,
            "would_reap": 0,
        },
        "rollouts": {
            "auto_merge": {"live": [], "shadow": [], "dry_run": []},
            "features": [],
        },
    }


@pytest.fixture(autouse=True)
def _clear_caches():
    """Reset the module-level caches so tests don't contaminate each other."""
    from app.api.v1.endpoints import admin_dev

    admin_dev._overview_cache.clear()
    admin_dev._last_good_cache.clear()
    yield
    admin_dev._overview_cache.clear()
    admin_dev._last_good_cache.clear()


def test_coord_down_serves_last_known_good_as_reconnecting():
    """After a successful read, a coord-down read serves stale data + markers."""
    client = TestClient(_build_test_app())
    good = _good_envelope()

    with patch(
        "app.api.v1.endpoints.admin_dev._proxy_coord_get",
        new=AsyncMock(return_value=good),
    ):
        r1 = client.get("/api/v1/admin-dev/overview")
    assert r1.status_code == 200
    assert "coord_error" not in r1.json()
    assert "coord_reconnecting" not in r1.json()

    # Now coord is down. refresh=1 bypasses the fresh cache so the proxy is
    # actually called (and raises), exercising the last-known-good path.
    with patch(
        "app.api.v1.endpoints.admin_dev._proxy_coord_get",
        new=AsyncMock(side_effect=HTTPException(504, "timeout waiting for coord")),
    ):
        r2 = client.get("/api/v1/admin-dev/overview?refresh=1")

    assert r2.status_code == 200
    body = r2.json()
    # Last-known-good data is carried through, NOT an empty envelope.
    assert body["gates"] == good["gates"]
    assert body["counts"]["total"] == 1
    # Staleness markers are set so the page shows the subtle reconnecting hint.
    assert body["coord_reconnecting"] is True
    assert body["coord_error"] == "timeout waiting for coord"
    assert body["last_good_generated_at"] == good["generated_at"]
    assert "stale_since" in body


def test_cold_start_coord_down_returns_hard_unavailable_envelope():
    """With no last-known-good, a coord-down read returns the empty banner shape."""
    client = TestClient(_build_test_app())

    with patch(
        "app.api.v1.endpoints.admin_dev._proxy_coord_get",
        new=AsyncMock(side_effect=HTTPException(504, "timeout waiting for coord")),
    ):
        r = client.get("/api/v1/admin-dev/overview?refresh=1")

    assert r.status_code == 200
    body = r.json()
    # Hard "unavailable" path: empty gates, coord_error set, NOT reconnecting.
    assert body["gates"] == []
    assert body["coord_error"] == "timeout waiting for coord"
    assert "coord_reconnecting" not in body


def test_successful_read_does_not_set_reconnecting_markers():
    """A healthy fetch never carries staleness markers."""
    client = TestClient(_build_test_app())
    with patch(
        "app.api.v1.endpoints.admin_dev._proxy_coord_get",
        new=AsyncMock(return_value=_good_envelope()),
    ):
        r = client.get("/api/v1/admin-dev/overview")
    body = r.json()
    assert "coord_reconnecting" not in body
    assert "stale_since" not in body
    assert "coord_error" not in body


def test_identity_unknown_never_caches():
    """Tenant key ``None`` (identity resolution failed) must bypass the shared
    cache entirely — no read, no write, no last-known-good. A raw or unknown
    key sharing cache entries across operators is the cross-tenant cache
    poisoning this closes."""
    from app.api.v1.endpoints import admin_dev

    client = TestClient(_build_identity_unknown_app())

    # A successful read must NOT populate the shared caches.
    with patch(
        "app.api.v1.endpoints.admin_dev._proxy_coord_get",
        new=AsyncMock(return_value=_good_envelope()),
    ):
        r1 = client.get("/api/v1/admin-dev/overview")
    assert r1.status_code == 200
    assert admin_dev._overview_cache == {}
    assert admin_dev._last_good_cache == {}

    # A coord-down read must not serve anyone's last-known-good either —
    # it degrades straight to the hard "unavailable" envelope.
    with patch(
        "app.api.v1.endpoints.admin_dev._proxy_coord_get",
        new=AsyncMock(side_effect=HTTPException(504, "timeout waiting for coord")),
    ):
        r2 = client.get("/api/v1/admin-dev/overview")
    body = r2.json()
    assert body["gates"] == []
    assert body["coord_error"] == "timeout waiting for coord"
    assert "coord_reconnecting" not in body
