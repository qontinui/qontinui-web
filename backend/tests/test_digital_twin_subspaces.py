"""Tests for the Digital Twin Explorer matrix endpoint + classification.

Two layers:
  - Pure `_classify` unit tests: the envelope → cell-status rubric (the goal
    #3/#4 surface — how a DriftVerdict becomes implemented / partial / blind).
  - An integration test over `GET /api/v1/digital-twin/subspaces` with a mocked
    coord: per-sub-space probe → cell, with honest blind/error degradation.

Mirrors the proxy-test pattern in ``test_operations_gates_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient`` so no live coord/runner is needed.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
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


def _identity(home_tenant_id=None, also_member_of=()):
    """A REAL ``CoordIdentity`` for the mocked ``get_coord_identity``.

    Deliberately not a ``MagicMock``: the endpoint now calls
    ``_effective_tenant_id(identity, active_tenant)``, which iterates
    ``identity.tenants`` to decide whether the operator is a member of the
    tenant they switched to. A ``MagicMock`` attribute is not iterable, so a
    mock identity would send that call down the endpoint's degrade path and
    quietly turn every test here into a test of the coord-unavailable branch.
    """
    from app.services.coord_identity import CoordIdentity, CoordTenant

    home = home_tenant_id or uuid4()
    members = [home, *also_member_of]
    return CoordIdentity(
        operator_id=uuid4(),
        home_tenant_id=home,
        email="operator@example.com",
        roles=("developer",),
        tenants=tuple(
            CoordTenant(tenant_id=t, slug=f"tenant-{i}", roles=("developer",))
            for i, t in enumerate(members)
        ),
        is_admin=False,
    )


def _resolved_identity(tenant_id=None, also_member_of=()):
    """An AsyncMock standing in for get_coord_identity → a resolved home tenant
    (fresh per call so the per-tenant TTL cache never bleeds between tests)."""
    return AsyncMock(return_value=_identity(tenant_id, also_member_of=also_member_of))


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
# The tenant-switcher selection reaches coord, and the cache respects it
#
# Plan `2026-08-28-tenant-creation-followup-defects-from-the-preemptive-sweep`
# Phase 3. This route captures the caller's context INLINE (it cannot use
# `Depends(get_tenant_id)` — it must degrade rather than 403 when coord is
# down) and used to set only `_caller_bearer`. `_tenant_headers` therefore read
# `_caller_active_tenant` at its `None` default and dropped
# `X-Qontinui-Active-Tenant`, so a tenant-switched operator was silently served
# their HOME tenant's completeness matrix.
#
# The two halves are indivisible: forwarding the header while the fan-out cache
# stayed keyed on the home tenant would file tenant B's matrix under tenant A
# and serve it back to a request that selected A — a cached cross-tenant read.
# ---------------------------------------------------------------------------

_TENANT_A = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
_TENANT_B = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
_TENANT_C = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")  # NOT a membership

ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"


@contextmanager
def _mock_coord(identity_mock, coverage_by_tenant=None):
    """Patch identity + the probe client; yield the recorded probe calls.

    ``coverage_by_tenant`` maps a forwarded ``X-Qontinui-Active-Tenant`` value
    (or ``None`` for "header absent") to the coverage every sub-space reports,
    so a per-tenant matrix is distinguishable in the response body — the point
    being that a wrong cache key serves the WRONG TENANT'S NUMBERS, not merely
    a duplicate key.
    """
    recorded: list[dict[str, str]] = []

    def fake_get(url, **kwargs):
        headers = dict(kwargs.get("headers") or {})
        recorded.append(headers)
        active = headers.get(ACTIVE_TENANT_HEADER)
        coverage = (coverage_by_tenant or {}).get(active, 1.0)
        return _verdict_response(coverage, "live_aws")

    with (
        patch(
            "app.api.v1.endpoints.digital_twin.get_coord_identity",
            new=identity_mock,
        ),
        patch("app.api.v1.endpoints.digital_twin.httpx.AsyncClient") as MockClient,
    ):
        instance = AsyncMock()
        instance.get.side_effect = fake_get
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance
        yield recorded


@pytest.fixture(autouse=True)
def _clear_matrix_cache():
    """The fan-out cache is a module global keyed by tenant; a leftover entry
    from another test would let a broken key look correct."""
    from app.api.v1.endpoints.digital_twin import _MATRIX_CACHE

    _MATRIX_CACHE.clear()
    yield
    _MATRIX_CACHE.clear()


class TestActiveTenantSelection:
    def test_forwards_the_switcher_selection_to_every_probe(self):
        """V1: a tenant-switched operator's probes carry their selection."""
        client = TestClient(_build_test_app())
        with _mock_coord(
            _resolved_identity(_TENANT_A, also_member_of=(_TENANT_B,))
        ) as probes:
            resp = client.get(
                f"{API_PREFIX}/subspaces",
                headers={
                    ACTIVE_TENANT_HEADER: str(_TENANT_B),
                    "Authorization": "Bearer cognito-token",
                },
            )

        assert resp.status_code == 200
        # Every probe, not just the first: the fan-out builds ONE header dict
        # and shares it, so a regression that dropped it drops it everywhere.
        assert len(probes) > 0
        for headers in probes:
            assert headers.get(ACTIVE_TENANT_HEADER) == str(_TENANT_B)
            assert headers.get("Authorization") == "Bearer cognito-token"

    def test_omits_the_header_when_the_operator_never_switched(self):
        """The negative half: no selection means no header, not an empty one.
        Without this, "forwards the selection" is satisfiable by hard-coding
        the header on every request."""
        client = TestClient(_build_test_app())
        with _mock_coord(_resolved_identity(_TENANT_A)) as probes:
            resp = client.get(
                f"{API_PREFIX}/subspaces",
                headers={"Authorization": "Bearer cognito-token"},
            )

        assert resp.status_code == 200
        assert len(probes) > 0
        for headers in probes:
            assert ACTIVE_TENANT_HEADER not in headers

    def test_cache_cannot_serve_tenant_b_matrix_under_tenant_a(self):
        """V1b: the indivisible second half.

        Same operator, same bearer, two requests differing ONLY in the
        selection. Coord answers differently per tenant (that is the whole
        reason the header exists), so a cache keyed on the home tenant would
        return the FIRST tenant's numbers for the second request — and keep
        returning them for the TTL.
        """
        from app.api.v1.endpoints.digital_twin import _MATRIX_CACHE

        client = TestClient(_build_test_app())
        identity = _resolved_identity(_TENANT_A, also_member_of=(_TENANT_B,))
        # coord reports a different completeness for each tenant.
        coverage = {None: 1.0, str(_TENANT_B): 0.4}

        with _mock_coord(identity, coverage) as probes_home:
            home = client.get(
                f"{API_PREFIX}/subspaces",
                headers={"Authorization": "Bearer cognito-token"},
            )
        with _mock_coord(identity, coverage) as probes_switched:
            switched = client.get(
                f"{API_PREFIX}/subspaces",
                headers={
                    ACTIVE_TENANT_HEADER: str(_TENANT_B),
                    "Authorization": "Bearer cognito-token",
                },
            )

        assert home.status_code == 200
        assert switched.status_code == 200
        # The switched request actually dialled coord — it was NOT served the
        # home tenant's cached fan-out.
        assert len(probes_home) > 0
        assert len(probes_switched) > 0
        # Two distinct cache entries, one per EFFECTIVE tenant.
        assert set(_MATRIX_CACHE) == {str(_TENANT_A), str(_TENANT_B)}
        # And the bodies are the two tenants' own answers, not one repeated.
        assert {s["status"] for s in home.json()["subspaces"]} == {"implemented"}
        assert {s["status"] for s in switched.json()["subspaces"]} == {"partial"}

    def test_a_second_request_in_the_same_tenant_IS_cached(self):
        """The cache still works — the fix re-keys it, it does not defeat it.
        Without this, deleting the cache entirely would pass the test above."""
        from app.api.v1.endpoints.digital_twin import _MATRIX_CACHE

        client = TestClient(_build_test_app())
        identity = _resolved_identity(_TENANT_A, also_member_of=(_TENANT_B,))
        headers = {
            ACTIVE_TENANT_HEADER: str(_TENANT_B),
            "Authorization": "Bearer cognito-token",
        }
        with _mock_coord(identity) as first:
            client.get(f"{API_PREFIX}/subspaces", headers=headers)
        with _mock_coord(identity) as second:
            client.get(f"{API_PREFIX}/subspaces", headers=headers)

        assert len(first) > 0
        assert second == []  # served from cache — coord was not dialled again
        assert set(_MATRIX_CACHE) == {str(_TENANT_B)}

    def test_a_non_member_selection_keys_on_home_not_the_selection(self):
        """Coord's `apply_active_tenant_override` DEGRADES a non-member
        selection to home rather than widening, and `_effective_tenant_id`
        mirrors that. The key must mirror it too — otherwise anyone could mint
        unbounded cache entries by sending arbitrary tenant ids, and the
        home-tenant matrix would be filed under a tenant it does not describe.
        """
        from app.api.v1.endpoints.digital_twin import _MATRIX_CACHE

        client = TestClient(_build_test_app())
        with _mock_coord(
            _resolved_identity(_TENANT_A, also_member_of=(_TENANT_B,))
        ) as probes:
            resp = client.get(
                f"{API_PREFIX}/subspaces",
                headers={
                    ACTIVE_TENANT_HEADER: str(_TENANT_C),
                    "Authorization": "Bearer cognito-token",
                },
            )

        assert resp.status_code == 200
        assert set(_MATRIX_CACHE) == {str(_TENANT_A)}
        # The header is still forwarded verbatim — coord is the authority on
        # membership and re-validates it; web only mirrors the OUTCOME for the
        # key it owns.
        assert all(h.get(ACTIVE_TENANT_HEADER) == str(_TENANT_C) for h in probes)


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
        "work_unit_slug": "2026-06-13-approach-d-conductor-engine",
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
                params={"work_unit_slug": "2026-06-13-approach-d-conductor-engine"},
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
            called_kwargs["params"]["work_unit_slug"]
            == "2026-06-13-approach-d-conductor-engine"
        )

    def test_missing_param_is_400_without_calling_coord(self):
        client = TestClient(_build_delivery_app())
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            resp = client.get(f"{API_PREFIX}/delivery/verdict")
            # Validated locally — coord is never dialed for an empty param set.
            MockClient.assert_not_called()
        assert resp.status_code == 400

    def test_legacy_plan_slug_param_is_rejected_without_calling_coord(self):
        """The retired spelling is a 400, not a silent empty lookup.

        Phase 3 of ``2026-07-30-coord-web-plan-slug-wire-key-retirement`` moved
        this route's query param from ``plan_slug`` to ``work_unit_slug``. That
        is a deliberate break for anyone calling the route by hand, and it must
        stay a *loud* one: FastAPI ignores an unknown query param, so a caller
        still sending ``plan_slug`` falls through to the has-nothing branch.
        Pinned so nobody "fixes" the break by re-*honouring* the old key — coord
        drops ``plan_slug`` entirely in Phase 4, so a resurrected alias would
        forward a param coord no longer understands (or, worse, satisfy the
        local required-argument check and turn a clean 400 into a coord-side
        failure). Re-declaring the param without reading it stays green, which
        is right: that is a no-op.
        """
        client = TestClient(_build_delivery_app())
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            resp = client.get(
                f"{API_PREFIX}/delivery/verdict",
                params={"plan_slug": "2026-06-13-approach-d-conductor-engine"},
            )
            MockClient.assert_not_called()
        assert resp.status_code == 400
        assert "work_unit_slug" in resp.json()["detail"]

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
                params={"work_unit_slug": "some-work-unit"},
            )
        # _proxy_coord_get re-raises coord's >=400 status as an HTTPException.
        assert resp.status_code == 502
