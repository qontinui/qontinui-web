"""Tests for the Digital Twin Explorer matrix endpoint + classification.

Three layers:
  - Pure `_classify` unit tests: the envelope → cell-status rubric (the goal
    #3/#4 surface — how a DriftVerdict becomes implemented / partial / blind).
  - The declared probe list: `_declared_probes` over coord's served catalog
    (plan ``2026-10-11-twin-honesty-and-reachability`` Phase 9 — the matrix
    probes what coord declares, not a hand copy), including the Spec CI stubs,
    whose catalog and probe bodies must describe the same sub-spaces.
  - An integration test over `GET /api/v1/digital-twin/subspaces` with a mocked
    coord: catalog → per-sub-space probe at its declared door → cell, with
    honest blind/error/restricted degradation.

Mirrors the proxy-test pattern in ``test_operations_gates_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient`` so no live coord/runner is needed.
"""

import asyncio
import json
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints.digital_twin import (
    _class_bucket_age,
    _classify,
    _declared_probes,
    _is_operator_gated,
)

API_PREFIX = "/api/v1/digital-twin"

# backend/tests/x.py -> parents[2] == the repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
# The page's Spec CI spec, whose route stubs carry a catalog body and a matrix
# body. Spec CI renders the page from both, so they must describe the same
# probed sub-spaces.
_SPEC = (
    _REPO_ROOT
    / "frontend"
    / "specs"
    / "pages"
    / "digital-twin"
    / "state-machine.derived.json"
)


def _catalog_entry(
    subspace: str,
    *,
    snapshot: bool,
    door: str | None,
    door_shape: str | None,
    access: str | None,
) -> dict[str, Any]:
    """One served-catalog row, in coord ``twin_probe_door.rs`` ``served_entry``
    shape (only the fields this backend reads matter; the rest ride along)."""
    return {
        "id": subspace,
        "subspace": subspace,
        "symbol": f"Ξ_{subspace}",
        "twin": "environment",
        "stages": ["operate"],
        "description": subspace,
        "query_tool": f"coord_query_{subspace}",
        "kind": "snapshot" if snapshot else "parameterized",
        "declared_status": "live",
        "params": [],
        "snapshot": snapshot,
        "access": access,
        "door": door,
        "door_shape": door_shape,
        "observed": None,
    }


def _snapshot(subspace: str, shape: str = "verdict_wrapper", access="system_tenant"):
    return _catalog_entry(
        subspace,
        snapshot=True,
        door=f"/coord/twin/{subspace}/verdict",
        door_shape=shape,
        access=access,
    )


# A stubbed served catalog. Probed: four verdict-wrapper snapshots, a
# report-shaped snapshot (`worktree`), a post-phase-16 process probe
# (`workers`) and the admin outbound door (an `envelope` door, `snapshot:
# false`). Not probed: the parameterized delivery read (a door, but not a
# snapshot and not an envelope) and `ci` (no door at all).
_CATALOG = {
    "total": 9,
    "entries": [
        _snapshot("release"),
        _snapshot("infra"),
        _snapshot("config"),
        _snapshot("memory", access="tenant"),
        _snapshot("worktree", shape="report", access="tenant"),
        _snapshot("workers", access="coord_internal"),
        _catalog_entry(
            "outbound",
            snapshot=False,
            door="/admin/coord/outbound-budget",
            door_shape="envelope",
            access=None,
        ),
        _catalog_entry(
            "delivery",
            snapshot=False,
            door="/coord/twin/delivery/verdict",
            door_shape="verdict_wrapper",
            access="tenant",
        ),
        _catalog_entry("ci", snapshot=False, door=None, door_shape=None, access=None),
    ],
}
# Verdict-wrapper snapshots only, for the tests that grade every cell alike.
_WRAPPER_CATALOG = {
    "total": 3,
    "entries": [_snapshot("release"), _snapshot("infra"), _snapshot("memory")],
}
_PROBED_IDS = {
    "release",
    "infra",
    "config",
    "memory",
    "worktree",
    "workers",
    "outbound",
}
_CATALOG_PATH = "/coord/twin/catalog"
_OUTBOUND_DOOR = "/admin/coord/outbound-budget"


def settings_coord_url() -> str:
    """The coord base URL the endpoint prefixes every door with."""
    from app.core.config import settings

    return settings.COORD_URL


def _spec_stub_body(url_pattern: str) -> Any:
    """The body the page's Spec CI spec stubs ``url_pattern`` with; fails
    closed on a missing spec or stub."""
    if not _SPEC.is_file():
        pytest.fail(f"Spec not found: {_SPEC}; if it moved, update _SPEC.")
    stubs = json.loads(_SPEC.read_text(encoding="utf-8"))["metadata"]["routeStubs"]
    for stub in stubs:
        if stub["urlPattern"] == url_pattern:
            return stub["body"]
    pytest.fail(f"{_SPEC} stubs no route {url_pattern}")


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


def _json_response(body: Any, status_code: int = 200) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = body
    resp.text = json.dumps(body)
    return resp


def _catalog_response(catalog: Any = None) -> MagicMock:
    return _json_response(_CATALOG if catalog is None else catalog)


def _verdict_response(coverage, provenance, drift_class="ok") -> MagicMock:
    return _json_response(
        {
            "subspace": "x",
            "tool": "coord_query_x",
            "verdict": {
                "coverage": coverage,
                "credibility": 0.9,
                "provenance": provenance,
                "drift_class": drift_class,
            },
        }
    )


def _envelope_response(coverage, drift_class="none") -> MagicMock:
    """The admin outbound door's ``OutboundBudgetResponse``: the DriftVerdict
    fields at the TOP level, no ``verdict`` wrapper."""
    return _json_response(
        {
            "dependency": None,
            "scope_reason": "system_tenant_fleet_wide",
            "scoped_installation_ids": [],
            "buckets": [],
            "count": 0,
            "drift_class": drift_class,
            "coverage": coverage,
            "staleness_threshold_seconds": 300,
            "observer_interval_seconds": 30,
            "low_fraction_threshold": 0.1,
            "budget_target_fraction": 0.8,
            "provenance": "outbound_budget_observations",
            "credibility": 0.9,
        }
    )


def _report_response() -> MagicMock:
    """A report-shaped twin door body: ``verdict`` is the tool's own report
    (``coord_list_worktrees`` answers ``{devices}``), not a DriftVerdict."""
    return _json_response(
        {
            "subspace": "worktree",
            "tool": "coord_list_worktrees",
            "verdict": {"devices": []},
        }
    )


def _status_response(status_code: int) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = {"error": "nope"}
    resp.text = "nope"
    return resp


@contextmanager
def _coord(route, identity=None):
    """Patch identity + the probe client. ``route(url)`` answers every probe;
    the catalog route answers ``_CATALOG`` unless ``route`` answers it first
    (return ``None`` to fall through). Yields the list of requested URLs."""
    urls: list[str] = []

    def fake_get(url, **kwargs):
        urls.append(url)
        answer = route(url)
        if answer is not None:
            return answer
        if url.endswith(_CATALOG_PATH):
            return _catalog_response()
        raise AssertionError(f"unrouted coord GET {url}")

    with (
        patch(
            "app.api.v1.endpoints.digital_twin.get_coord_identity",
            new=identity or _resolved_identity(),
        ),
        patch("app.api.v1.endpoints.digital_twin.httpx.AsyncClient") as MockClient,
    ):
        instance = AsyncMock()
        instance.get.side_effect = fake_get
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance
        yield urls


class TestDeclaredProbes:
    def test_probes_the_snapshot_rows_and_the_envelope_door_only(self):
        declared = _declared_probes(_CATALOG)
        assert declared is not None
        assert {p["subspace"] for p in declared} == _PROBED_IDS
        by_id = {p["subspace"]: p for p in declared}
        # The outbound row is probed at the admin door coord declares for it,
        # although coord does not serve it as a snapshot.
        assert by_id["outbound"]["door"] == _OUTBOUND_DOOR
        assert by_id["outbound"]["door_shape"] == "envelope"
        assert by_id["worktree"]["door_shape"] == "report"
        assert by_id["memory"]["access"] == "tenant"
        # A parameterized door and a doorless row are never probed.
        assert "delivery" not in by_id
        assert "ci" not in by_id

    def test_operator_gated_by_coords_declaration_or_by_the_path(self):
        """A probe is never cached when coord declares no twin-door class for it
        (``access: null``) OR its door is off the twin router — either alone."""
        twin = {"door": "/coord/twin/release/verdict", "access": "system_tenant"}
        assert _is_operator_gated(twin) is False
        # coord's declaration alone: a twin-router path with no access class.
        assert _is_operator_gated({**twin, "access": None}) is True
        # The path alone: an access class, but a door off the twin router.
        assert (
            _is_operator_gated({"door": "/admin/coord/x", "access": "tenant"}) is True
        )
        by_id = {p["subspace"]: p for p in _declared_probes(_CATALOG) or []}
        assert _is_operator_gated(by_id["outbound"]) is True
        assert not any(
            _is_operator_gated(p) for sid, p in by_id.items() if sid != "outbound"
        )

    def test_a_catalog_that_declares_nothing_is_none_not_an_empty_list(self):
        # A coord predating the declaration serves rows with no `snapshot`
        # flag. That is "nothing declared", not "coord declares no sub-space".
        legacy = {
            "total": 1,
            "entries": [
                {
                    "id": "release",
                    "description": "x",
                    "query_tool": "coord_query_release_state",
                    "params": [],
                    "kind": "snapshot",
                    "status": "live",
                }
            ],
        }
        assert _declared_probes(legacy) is None
        assert _declared_probes({"entries": "nope"}) is None
        assert _declared_probes(["not", "a", "catalog"]) is None
        assert _declared_probes(None) is None

    def test_the_spec_ci_stubs_describe_the_same_probed_subspaces(self):
        """The Spec CI catalog stub and matrix stub agree.

        The page joins the two, so a sub-space the catalog stub declares but the
        matrix stub omits renders an error cell under Spec CI, and one the
        matrix stub carries but the catalog does not declare is a cell the page
        never shows as live.
        """
        catalog = _spec_stub_body("**/api/v1/digital-twin/catalog")
        matrix = _spec_stub_body("**/api/v1/digital-twin/subspaces")
        declared = _declared_probes(catalog)
        assert declared, "the catalog stub declares no probe"
        probed = [cell["id"] for cell in matrix["subspaces"]]
        assert len(probed) == len(set(probed)), "duplicate id in the matrix stub"
        assert {p["subspace"] for p in declared} == set(probed)
        assert matrix["probed"] == len(probed)


class TestSubspacesEndpoint:
    def test_probes_each_declared_door_and_classifies_per_subspace(self):
        client = TestClient(_build_test_app())

        # Route the mocked coord response by URL so the concurrent fan-out is
        # deterministic regardless of completion order.
        def route(url):
            if "/twin/release/" in url:
                return _verdict_response(1.0, "live_aws")  # implemented
            if "/twin/infra/" in url:
                return _verdict_response(0.4, "live_aws")  # partial
            if "/twin/config/" in url:
                return _verdict_response(0.0, "config:unconfigured")  # blind
            if "/twin/memory/" in url:
                return _status_response(502)  # error
            if "/twin/worktree/" in url:
                return _report_response()  # served, not graded
            if "/twin/workers/" in url:
                return _status_response(404)  # declared door that 404s
            if url.endswith(_OUTBOUND_DOOR):
                return _envelope_response(0.6)  # partial, read at top level
            return None

        with _coord(route) as urls:
            resp = client.get(f"{API_PREFIX}/subspaces")

        assert resp.status_code == 200
        body = resp.json()
        by_id = {s["id"]: s for s in body["subspaces"]}
        assert set(by_id) == _PROBED_IDS
        assert body["probed"] == len(body["subspaces"]) == len(_PROBED_IDS)
        assert body["restricted"] is False
        assert by_id["release"]["status"] == "implemented"
        assert by_id["release"]["metrics"]["provenance"] == "live_aws"
        assert by_id["infra"]["status"] == "partial"
        assert by_id["config"]["status"] == "blind"
        assert by_id["memory"]["status"] == "error"
        assert by_id["workers"]["status"] == "no_snapshot_tool"
        # A report is served, never graded: no `partial` from a missing
        # coverage, and no metrics invented for it.
        assert by_id["worktree"]["status"] == "served"
        assert "metrics" not in by_id["worktree"]
        assert by_id["worktree"]["door_shape"] == "report"
        # The envelope door is read at the top level, not as malformed.
        assert by_id["outbound"]["status"] == "partial"
        assert by_id["outbound"]["metrics"]["coverage"] == 0.6
        assert by_id["outbound"]["door_shape"] == "envelope"
        # The catalog is read first; then exactly the declared doors, each once.
        assert urls[0].endswith(_CATALOG_PATH)
        assert any(u.endswith(_OUTBOUND_DOOR) for u in urls)
        assert not any("/twin/outbound/" in u for u in urls)
        assert not any("/twin/delivery/" in u or "/twin/ci/" in u for u in urls)
        assert len(urls) == 1 + len(_PROBED_IDS)

    def test_an_envelope_door_with_a_verdict_wrapper_reading_would_be_malformed(
        self,
    ):
        """The door shape is what makes the outbound cell readable: the same
        top-level body read through a ``{verdict}`` wrapper is malformed."""
        client = TestClient(_build_test_app())
        catalog = {
            "total": 1,
            "entries": [
                _catalog_entry(
                    "outbound",
                    snapshot=True,
                    door=_OUTBOUND_DOOR,
                    door_shape="verdict_wrapper",
                    access=None,
                )
            ],
        }

        def route(url):
            if url.endswith(_CATALOG_PATH):
                return _catalog_response(catalog)
            return _envelope_response(1.0)

        with _coord(route):
            resp = client.get(f"{API_PREFIX}/subspaces")

        cell = resp.json()["subspaces"][0]
        assert cell["status"] == "error"
        assert cell["error"] == "malformed_verdict"

    def test_a_single_403_marks_only_its_own_cell(self):
        """Another tenant's operator: the Qontinui-internal sub-spaces and the
        admin outbound door refuse, their own `memory` and `worktree` answer.
        The matrix is NOT `restricted` — that flag means every probe refused."""
        client = TestClient(_build_test_app())

        def route(url):
            if "/twin/memory/" in url:
                return _verdict_response(1.0, "coord_memory_observations")
            if "/twin/worktree/" in url:
                return _report_response()
            if url.endswith(_CATALOG_PATH):
                return None
            return _status_response(403)

        with _coord(route):
            resp = client.get(f"{API_PREFIX}/subspaces")

        body = resp.json()
        by_id = {s["id"]: s["status"] for s in body["subspaces"]}
        assert body["restricted"] is False
        assert by_id["memory"] == "implemented"
        assert by_id["worktree"] == "served"
        for refused in ("release", "infra", "config", "workers", "outbound"):
            assert by_id[refused] == "restricted", refused

    def test_one_refused_door_alone_does_not_restrict_the_matrix(self):
        # Only the admin outbound door refuses (a non-admin operator).
        client = TestClient(_build_test_app())

        def route(url):
            if url.endswith(_OUTBOUND_DOOR):
                return _status_response(403)
            if url.endswith(_CATALOG_PATH):
                return None
            return _verdict_response(1.0, "live_aws")

        with _coord(route):
            body = client.get(f"{API_PREFIX}/subspaces").json()

        assert body["restricted"] is False
        statuses = {s["id"]: s["status"] for s in body["subspaces"]}
        assert statuses["outbound"] == "restricted"
        assert statuses["release"] == "implemented"

    def test_every_probe_refused_sets_the_top_level_restricted(self):
        # The coarse gate armed against this operator: every door answers 403.
        client = TestClient(_build_test_app())

        def route(url):
            if url.endswith(_CATALOG_PATH):
                return None
            return _status_response(403)

        with _coord(route):
            resp = client.get(f"{API_PREFIX}/subspaces")

        assert resp.status_code == 200
        body = resp.json()
        assert body["restricted"] is True
        assert {s["status"] for s in body["subspaces"]} == {"restricted"}

    def test_coord_unreachable_degrades_with_no_invented_ids(self):
        """No identity and no catalog ever read: an empty degraded matrix, not
        a list of ids this module made up."""
        client = TestClient(_build_test_app())
        with patch("app.api.v1.endpoints.digital_twin.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = client.get(f"{API_PREFIX}/subspaces")

        # Honest degradation: the matrix endpoint itself stays 200 — never a
        # 500 that blanks the whole page.
        assert resp.status_code == 200
        assert resp.json() == {"subspaces": [], "probed": 0, "degraded": True}

    def test_catalog_unreadable_degrades_to_the_last_declared_list(self):
        client = TestClient(_build_test_app())

        def healthy(url):
            if url.endswith(_CATALOG_PATH):
                return None
            return _verdict_response(1.0, "live_aws")

        # A good read first: it records the declared list.
        with _coord(healthy):
            first = client.get(f"{API_PREFIX}/subspaces")
        assert first.json()["restricted"] is False

        from app.api.v1.endpoints.digital_twin import _MATRIX_CACHE

        _MATRIX_CACHE.clear()

        def route(url):
            if url.endswith(_CATALOG_PATH):
                return _status_response(502)
            raise AssertionError(f"probed {url} with no catalog")

        with _coord(route):
            resp = client.get(f"{API_PREFIX}/subspaces")

        assert resp.status_code == 200
        body = resp.json()
        assert body["degraded"] is True
        assert {s["id"] for s in body["subspaces"]} == _PROBED_IDS
        assert {s["status"] for s in body["subspaces"]} == {"error"}
        assert {s["error"] for s in body["subspaces"]} == {"catalog_unavailable"}
        # A degraded matrix is not cached: the next request retries coord.
        assert _MATRIX_CACHE == {}

    def test_the_admin_outbound_door_is_never_shared_across_operators(self):
        """coord gates the outbound door per OPERATOR (``require_role("admin")``)
        while the matrix cache is per TENANT. Two operators of ONE tenant — an
        admin, then a non-admin, then the admin again inside the TTL — each get
        their own outbound answer; only the twin-door probes are shared."""
        client = TestClient(_build_test_app())
        tenant = uuid4()
        calls: list[tuple[str, str | None]] = []

        def fake_get(url, **kwargs):
            bearer = dict(kwargs.get("headers") or {}).get("Authorization")
            calls.append((url, bearer))
            if url.endswith(_CATALOG_PATH):
                return _catalog_response()
            if url.endswith(_OUTBOUND_DOOR):
                if bearer == "Bearer admin-token":
                    return _envelope_response(1.0)
                return _status_response(403)
            if "/twin/worktree/" in url:
                return _report_response()
            return _verdict_response(1.0, "live_aws")

        def outbound_status(token: str) -> str:
            resp = client.get(
                f"{API_PREFIX}/subspaces",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 200
            by_id = {s["id"]: s for s in resp.json()["subspaces"]}
            assert set(by_id) == _PROBED_IDS
            return by_id["outbound"]["status"]

        with (
            patch(
                "app.api.v1.endpoints.digital_twin.get_coord_identity",
                new=_resolved_identity(tenant),
            ),
            patch("app.api.v1.endpoints.digital_twin.httpx.AsyncClient") as MockClient,
        ):
            instance = AsyncMock()
            instance.get.side_effect = fake_get
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance

            assert outbound_status("admin-token") == "implemented"
            first = len(calls)
            assert outbound_status("viewer-token") == "restricted"
            # The second request dialled ONLY the outbound door, with its own
            # bearer: the twin-door probes came from the tenant's cache.
            assert calls[first:] == [
                (f"{settings_coord_url()}{_OUTBOUND_DOOR}", "Bearer viewer-token")
            ]
            assert outbound_status("admin-token") == "implemented"

    def test_a_cache_miss_probes_shared_and_operator_gated_doors_concurrently(
        self,
    ):
        """On a miss the twin-door probes and the operator-gated door are ONE
        fan-out: every twin-door probe here waits (bounded) for the outbound
        probe to have started, which a twin-doors-first sequence never lets
        happen."""
        client = TestClient(_build_test_app())
        started: dict[str, asyncio.Event] = {}

        def outbound_event() -> asyncio.Event:
            # Created lazily, on the loop the request runs on.
            return started.setdefault("outbound", asyncio.Event())

        async def fake_get(url, **kwargs):
            if url.endswith(_CATALOG_PATH):
                return _catalog_response()
            if url.endswith(_OUTBOUND_DOOR):
                outbound_event().set()
                return _envelope_response(1.0)
            await asyncio.wait_for(outbound_event().wait(), timeout=2.0)
            if "/twin/worktree/" in url:
                return _report_response()
            return _verdict_response(1.0, "live_aws")

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
        statuses = {s["id"]: s["status"] for s in resp.json()["subspaces"]}
        assert set(statuses) == _PROBED_IDS
        assert "error" not in statuses.values()

    def test_catalog_unreadable_with_no_prior_declaration_is_empty(self):
        client = TestClient(_build_test_app())

        def route(url):
            if url.endswith(_CATALOG_PATH):
                return _catalog_response({"entries": "not a list"})
            raise AssertionError(f"probed {url} with no catalog")

        with _coord(route):
            body = client.get(f"{API_PREFIX}/subspaces").json()

        assert body == {"subspaces": [], "probed": 0, "degraded": True}


# ---------------------------------------------------------------------------
# The admin outbound door's age: the bucket its drift class comes from
#
# coord's ``OutboundBudgetResponse`` has no answer-level ``staleness_seconds``;
# each bucket carries its own. ``get_outbound_budget`` sorts the buckets
# worst-first and takes ``drift_class`` from the first, so that bucket's age
# dates the class (qontinui-coord ``outbound_budget_read.rs``, read at
# origin/main 58719876). These bodies are the door's real shape.
# ---------------------------------------------------------------------------

_OUTBOUND_ONLY_CATALOG = {
    "total": 2,
    "entries": [
        _catalog_entry(
            "outbound",
            snapshot=False,
            door=_OUTBOUND_DOOR,
            door_shape="envelope",
            access=None,
        ),
        _snapshot("release"),
    ],
}


_MISSING = object()


def _bucket(drift_class: str, age: Any, resource: str = "core:134903706") -> dict:
    """One served bucket (``OutboundBudgetBucket``), observed ``age`` seconds
    before the read. ``age`` is sent as given (``_MISSING`` leaves the field
    out), so a test can send a value coord never would."""
    bucket = {
        "dependency": "github",
        "resource": resource,
        "installation_id": 134903706,
        "drift_class": drift_class,
        "drift_subclass": None,
        "remaining": 3189,
        "limit_total": 5850,
        "remaining_fraction": 0.545,
        "burn_rate_per_min": 84.8,
        "paced_rate_per_min": 78.0,
        "below_low_threshold": False,
        "low_threshold_kind": "coord_github_ratelimit_low",
        "cooldown_until": None,
        "reset_at": None,
        "serving_stale_reads": None,
        "observed_at": "2026-10-27T12:00:00+00:00",
        # coord's own bound: stale past 10 polls of 30 s.
        "freshness": "stale" if isinstance(age, int) and age > 300 else "fresh",
        "top_consumers": None,
        "caller_breakdown": None,
    }
    if age is not _MISSING:
        bucket["staleness_seconds"] = age
    return bucket


def _outbound_body(buckets: list[dict], drift_class: str | None = None) -> dict:
    """The door's body over ``buckets`` (already worst-first). Its class is
    the first bucket's unless ``drift_class`` says otherwise, as coord's own
    rule would not."""
    if drift_class is None:
        drift_class = buckets[0]["drift_class"] if buckets else "unknown"
    return {
        "dependency": None,
        "scope_reason": "system_tenant_fleet_wide",
        "scoped_installation_ids": [],
        "buckets": buckets,
        "count": len(buckets),
        "drift_class": drift_class,
        "coverage": 1.0 if buckets else 0.0,
        "staleness_threshold_seconds": 300,
        "observer_interval_seconds": 30,
        "low_fraction_threshold": 0.1,
        "budget_target_fraction": 0.8,
        "provenance": "persisted_oplog",
        "credibility": 0.95,
    }


def _matrix_cells(body: dict, release_staleness: Any = 30) -> dict[str, dict]:
    """GET the matrix over HTTP, coord answering ``body`` at the outbound door
    and a twin-door verdict aged ``release_staleness`` for ``release``; return
    the cells by id."""
    client = TestClient(_build_test_app())

    def route(url):
        if url.endswith(_CATALOG_PATH):
            return _catalog_response(_OUTBOUND_ONLY_CATALOG)
        if url.endswith(_OUTBOUND_DOOR):
            return _json_response(body)
        if "/twin/release/" in url:
            return _json_response(
                {
                    "subspace": "release",
                    "tool": "coord_query_release_state",
                    "verdict": {
                        "coverage": 1.0,
                        "credibility": 0.9,
                        "provenance": "ecs_describe_tasks",
                        "drift_class": "none",
                        "staleness_seconds": release_staleness,
                        # A wrapper verdict's own bucket-like field is not
                        # read: only an envelope door's buckets are.
                        "buckets": [_bucket("none", 999)],
                    },
                }
            )
        return None

    with _coord(route):
        resp = client.get(f"{API_PREFIX}/subspaces")
    assert resp.status_code == 200
    return {c["id"]: c for c in resp.json()["subspaces"]}


def _outbound_cell(body: dict) -> dict:
    return _matrix_cells(body)["outbound"]


class TestOutboundEnvelopeAge:
    def test_carries_the_age_of_the_bucket_its_class_comes_from(self):
        # Worst-first: the burning bucket drives the class. Behind it an
        # orphan last observed weeks ago, which is older but not the class's.
        cell = _outbound_cell(
            _outbound_body(
                [_bucket("burning", 12), _bucket("nominal", 3_009_931, "search:1")]
            )
        )
        assert cell["status"] == "implemented"
        assert cell["door_shape"] == "envelope"
        assert cell["metrics"]["drift_class"] == "burning"
        assert cell["metrics"]["staleness_seconds"] == 12

    def test_an_orphan_bucket_that_drives_the_class_is_dated_by_its_own_age(self):
        cell = _outbound_cell(
            _outbound_body([_bucket("exhausted", 3_009_931), _bucket("nominal", 2)])
        )
        assert cell["metrics"]["drift_class"] == "exhausted"
        assert cell["metrics"]["staleness_seconds"] == 3_009_931

    def test_serves_no_age_when_coord_observed_no_bucket(self):
        cell = _outbound_cell(_outbound_body([]))
        assert cell["status"] == "blind"
        assert cell["metrics"]["coverage"] == 0.0
        assert cell["metrics"]["staleness_seconds"] is None

    def test_serves_no_age_when_the_first_bucket_is_not_where_the_class_comes_from(
        self,
    ):
        # Not coord's rule today; if it changes, no bucket's age is passed off
        # as the class's.
        cell = _outbound_cell(
            _outbound_body([_bucket("nominal", 12)], drift_class="exhausted")
        )
        assert cell["metrics"]["drift_class"] == "exhausted"
        assert cell["metrics"]["staleness_seconds"] is None

    @pytest.mark.parametrize("age", [_MISSING, None, "12", True, -1])
    def test_serves_no_age_that_is_not_a_number_of_seconds(self, age):
        cell = _outbound_cell(_outbound_body([_bucket("burning", age)]))
        assert cell["metrics"]["drift_class"] == "burning"
        assert cell["metrics"]["staleness_seconds"] is None

    @pytest.mark.parametrize("age", [float("nan"), float("inf"), float("-inf")])
    def test_takes_no_age_from_a_float_that_is_not_finite(self, age):
        # Called directly: over HTTP the route's ``-> Any`` serialization
        # already writes a non-finite float as null, so only the function's
        # own guard can be seen to hold here.
        envelope = _outbound_body([_bucket("burning", age)])
        assert _class_bucket_age(envelope) is None
        assert _class_bucket_age(_outbound_body([_bucket("burning", 12)])) == 12

    def test_a_twin_door_verdict_keeps_its_own_staleness(self):
        body = _outbound_body([_bucket("burning", 12)])
        release = _matrix_cells(body, release_staleness=30)["release"]
        assert release["door_shape"] == "verdict_wrapper"
        assert release["metrics"]["staleness_seconds"] == 30
        # coord omits it on a live answer: passed through as it came.
        release = _matrix_cells(body, release_staleness=None)["release"]
        assert release["metrics"]["staleness_seconds"] is None


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

    The catalog read is recorded too: it rides the same forwarded headers, and
    it declares only verdict-wrapper snapshots (``_WRAPPER_CATALOG``) so every
    cell is graded from the per-tenant coverage.
    """
    recorded: list[dict[str, str]] = []

    def fake_get(url, **kwargs):
        headers = dict(kwargs.get("headers") or {})
        recorded.append(headers)
        if url.endswith(_CATALOG_PATH):
            return _catalog_response(_WRAPPER_CATALOG)
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
    from app.api.v1.endpoints import digital_twin

    digital_twin._MATRIX_CACHE.clear()
    # The last declared probe list is module state too: a list left by another
    # test would turn a "never declared" degrade into a "last declared" one.
    digital_twin._LAST_DECLARED = None
    yield
    digital_twin._MATRIX_CACHE.clear()
    digital_twin._LAST_DECLARED = None


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
