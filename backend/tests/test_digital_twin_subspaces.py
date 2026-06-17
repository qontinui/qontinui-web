"""Tests for the Digital Twin Explorer matrix endpoint + classification.

Two layers:
  - Pure `_classify` unit tests: the envelope → cell-status rubric (the goal
    #3/#4 surface — how a DriftVerdict becomes implemented / partial / blind).
  - An integration test over `GET /api/v1/digital-twin/subspaces` with a mocked
    coord: per-sub-space probe → cell, with honest blind/error degradation.

Mirrors the proxy-test pattern in ``test_operations_gates_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient`` so no live coord/runner is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints.digital_twin import _classify

API_PREFIX = "/api/v1/digital-twin"


# ---------------------------------------------------------------------------
# _classify — pure rubric
# ---------------------------------------------------------------------------


class TestClassify:
    def test_full_coverage_live_is_implemented(self):
        assert (
            _classify({"coverage": 1.0, "provenance": "live_aws", "drift_class": "ok"})
            == "implemented"
        )

    def test_partial_coverage_is_partial(self):
        # infra-style: healthy but narrow — coverage < 1, NOT blind.
        assert (
            _classify({"coverage": 0.4, "provenance": "live_aws", "drift_class": "ok"})
            == "partial"
        )

    def test_unconfigured_provenance_is_blind(self):
        assert (
            _classify(
                {
                    "coverage": 0.0,
                    "provenance": "config:unconfigured",
                    "drift_class": "ok",
                }
            )
            == "blind"
        )

    def test_unknown_drift_class_is_blind(self):
        # Even with coverage, an unknown drift_class means the observer couldn't
        # read it for this tenant.
        assert (
            _classify(
                {"coverage": 0.9, "provenance": "live_rds", "drift_class": "unknown"}
            )
            == "blind"
        )

    def test_zero_coverage_is_blind(self):
        assert (
            _classify({"coverage": 0.0, "provenance": "live_aws", "drift_class": "ok"})
            == "blind"
        )

    def test_missing_coverage_falls_back_to_partial(self):
        # Answered but ungradeable — never silently "implemented".
        assert _classify({"provenance": "live_aws", "drift_class": "ok"}) == "partial"


# ---------------------------------------------------------------------------
# GET /digital-twin/subspaces — integration
# ---------------------------------------------------------------------------


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.digital_twin import router as dt_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    # NOTE: the endpoint resolves the tenant by calling get_coord_identity()
    # directly (not via a Depends), so tests that need a resolved tenant patch
    # `digital_twin.get_coord_identity` rather than overriding a dependency.
    test_app.include_router(dt_router, prefix="/api/v1/digital-twin")
    return test_app


def _resolved_identity(tenant_id=None):
    """An AsyncMock standing in for get_coord_identity → a resolved home tenant
    (fresh per call so the per-tenant TTL cache never bleeds between tests)."""
    return AsyncMock(return_value=MagicMock(home_tenant_id=tenant_id or uuid4()))


def _verdict_response(coverage, provenance, drift_class="ok") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {
        "subspace": "x",
        "tool": "coord_query_x",
        "verdict": {
            "coverage": coverage,
            "credibility": 0.9,
            "provenance": provenance,
            "drift_class": drift_class,
        },
    }
    return resp


def _status_response(status_code: int) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = {"error": "nope"}
    resp.text = "nope"
    return resp


class TestSubspacesEndpoint:
    def test_probes_all_and_classifies_per_subspace(self):
        client = TestClient(_build_test_app())

        # Route the mocked coord response by the sub-space id in the URL so the
        # concurrent fan-out is deterministic regardless of completion order.
        def fake_get(url, **kwargs):
            if "/twin/release/" in url:
                return _verdict_response(1.0, "live_aws")  # implemented
            if "/twin/infra/" in url:
                return _verdict_response(0.4, "live_aws")  # partial
            if "/twin/config/" in url:
                return _verdict_response(0.0, "config:unconfigured")  # blind
            if "/twin/worktree/" in url:
                return _status_response(404)  # no_snapshot_tool classification
            if "/twin/health/" in url:
                return _status_response(502)  # error
            return _verdict_response(1.0, "live_rds")  # default implemented

        with (
            patch(
                "app.api.v1.endpoints.digital_twin.get_coord_identity",
                new=_resolved_identity(),
            ),
            patch("app.api.v1.endpoints.digital_twin.httpx.AsyncClient") as MockClient,
        ):
            instance = AsyncMock()
            instance.get.side_effect = fake_get
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = client.get(f"{API_PREFIX}/subspaces")

        assert resp.status_code == 200
        body = resp.json()
        by_id = {s["id"]: s for s in body["subspaces"]}
        assert body["probed"] == len(body["subspaces"])
        assert by_id["release"]["status"] == "implemented"
        assert by_id["infra"]["status"] == "partial"
        assert by_id["config"]["status"] == "blind"
        assert by_id["worktree"]["status"] == "no_snapshot_tool"
        assert by_id["health"]["status"] == "error"
        # `auth` is intentionally NOT probed (sensitive — Cognito wiring), so it
        # never appears in the matrix response.
        assert "auth" not in by_id
        # Envelope metrics ride along for the responding cells.
        assert by_id["release"]["metrics"]["provenance"] == "live_aws"

    def test_coord_unreachable_marks_error_not_500(self):
        client = TestClient(_build_test_app())
        with patch("app.api.v1.endpoints.digital_twin.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = client.get(f"{API_PREFIX}/subspaces")

        # Honest degradation: the matrix endpoint itself stays 200; every cell
        # is "error" — never a 500 that blanks the whole page.
        assert resp.status_code == 200
        statuses = {s["status"] for s in resp.json()["subspaces"]}
        assert statuses == {"error"}

    def test_tenant_gate_403_surfaces_restricted(self):
        # coord's twin tenant gate 403s every route for a non-allowed operator;
        # the matrix surfaces a top-level `restricted` flag + per-cell
        # "restricted" (an access decision, distinct from a 502 tool failure).
        client = TestClient(_build_test_app())
        with (
            patch(
                "app.api.v1.endpoints.digital_twin.get_coord_identity",
                new=_resolved_identity(),
            ),
            patch("app.api.v1.endpoints.digital_twin.httpx.AsyncClient") as MockClient,
        ):
            instance = AsyncMock()
            instance.get.side_effect = lambda url, **kw: _status_response(403)
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = client.get(f"{API_PREFIX}/subspaces")

        assert resp.status_code == 200
        body = resp.json()
        assert body["restricted"] is True
        assert {s["status"] for s in body["subspaces"]} == {"restricted"}


# ---------------------------------------------------------------------------
# GET /digital-twin/delivery/verdict — parameterized delivery read (Phase 5)
# ---------------------------------------------------------------------------


def _build_delivery_app() -> FastAPI:
    """Like ``_build_test_app`` but also overrides ``get_tenant_id`` — the
    delivery route resolves the tenant via that Depends (to forward the bearer),
    not via ``get_coord_identity``."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.digital_twin import router as dt_router
    from app.api.v1.endpoints.operations import get_tenant_id

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: uuid4()
    test_app.include_router(dt_router, prefix="/api/v1/digital-twin")
    return test_app


def _delivery_verdict_response() -> MagicMock:
    """A coord delivery-route body: instance="delivery" DriftVerdict envelope."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {
        "plan_slug": "2026-06-13-approach-d-conductor-engine",
        "tool": "coord_query_delivery",
        "verdict": {
            "instance": "delivery",
            "drift_class": "none",
            "drift_subclass": None,
            "coverage": 1.0,
            "credibility": 0.9,
            "staleness_seconds": 0,
            "provenance": "join:live",
            "components": {
                "status": "shipped",
                "all_merged": True,
                "registered": True,
                "prs": [{"repo": "qontinui-runner", "pr": 583, "merged": True}],
                "unmerged_prs": [],
                "deployed_envs": [],
            },
        },
    }
    return resp


class TestDeliveryEndpoint:
    def test_proxies_coord_and_returns_verdict(self):
        client = TestClient(_build_delivery_app())
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _delivery_verdict_response()
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = client.get(
                f"{API_PREFIX}/delivery/verdict",
                params={"plan_slug": "2026-06-13-approach-d-conductor-engine"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["tool"] == "coord_query_delivery"
        assert body["verdict"]["instance"] == "delivery"
        assert body["verdict"]["components"]["all_merged"] is True
        # The slug rode the coord query string (coord scopes the lookup on it).
        called_url, called_kwargs = (
            instance.get.call_args.args,
            instance.get.call_args.kwargs,
        )
        assert called_url[0].endswith("/coord/twin/delivery/verdict")
        assert (
            called_kwargs["params"]["plan_slug"]
            == "2026-06-13-approach-d-conductor-engine"
        )

    def test_missing_param_is_400_without_calling_coord(self):
        client = TestClient(_build_delivery_app())
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            resp = client.get(f"{API_PREFIX}/delivery/verdict")
            # Validated locally — coord is never dialed for an empty param set.
            MockClient.assert_not_called()
        assert resp.status_code == 400

    def test_coord_tool_failure_surfaces_status(self):
        client = TestClient(_build_delivery_app())
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _status_response(502)
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = client.get(
                f"{API_PREFIX}/delivery/verdict",
                params={"plan_slug": "some-plan"},
            )
        # _proxy_coord_get re-raises coord's >=400 status as an HTTPException.
        assert resp.status_code == 502
