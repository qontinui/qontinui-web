"""``StrictQueryRoute`` — an unknown query key is a typed 422, never a silent 200.

Phase 4 of ``2026-09-03-coord-agent-doors-honour-or-refuse-every-parameter``
(dossier ``agent-door-filters-silently-ignored``).

Two layers, both DB-free — the check runs BEFORE dependency resolution, so a
refused request never reaches ``get_async_db``:

* **Layer 1 — the route class in isolation** on a synthetic router: the
  alias (wire name) is what counts, sub-dependency query params are accepted,
  a query-parameter model expands to its fields, a route with no query params
  accepts nothing, and a plain ``APIRouter()`` still ignores (the contrast that
  proves the class is opt-in, not a global behaviour change).
* **Layer 2 — the plan-library router**, the first adopter: the list,
  ``/candidates`` and ``/export`` routes 422 on an unknown key with
  ``accepted`` equal to what the app's OWN route objects declare (read from
  ``app.routes`` / ``app.openapi()``, never retyped), and a path parameter is
  not mistaken for a query key. Plus one request through the booted
  production app, pinning the body shape the app-level exception handler
  emits (``error``/``unknown``/``accepted``/``route`` at the top level — the
  field names coord's ``400 unknown_query_parameter`` carries).

"Every declared key is still accepted" needs the handlers to run against a
database and lives in ``tests/test_plan_library_api.py``.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Annotated
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import APIRouter, Depends, FastAPI, Query
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.api.strict_query import (
    UNKNOWN_QUERY_PARAMETER,
    StrictQueryRoute,
    accepted_query_keys,
)

API_PREFIX = "/api/v1/plan-library"

pytestmark = pytest.mark.asyncio


# ===========================================================================
# Layer 1 — the route class on a synthetic router
# ===========================================================================


def _needs_page(page: int = Query(1, ge=1)) -> int:
    return page


class _Window(BaseModel):
    offset: int = 0
    limit: int = Field(10, alias="page_size")


def _synthetic_app() -> FastAPI:
    strict = APIRouter(route_class=StrictQueryRoute)

    @strict.get("/aliased")
    async def aliased(
        artifact_status: str | None = Query(None, alias="status"),
        kind: str | None = Query(None),
    ) -> dict[str, str | None]:
        return {"status": artifact_status, "kind": kind}

    @strict.get("/nested")
    async def nested(page: int = Depends(_needs_page)) -> dict[str, int]:
        return {"page": page}

    @strict.get("/model")
    async def model(window: Annotated[_Window, Query()]) -> dict[str, int]:
        return {"offset": window.offset, "limit": window.limit}

    @strict.get("/bare")
    async def bare() -> dict[str, bool]:
        return {"ok": True}

    @strict.get("/items/{item_id}")
    async def item(item_id: str, verbose: bool = Query(False)) -> dict[str, object]:
        return {"item_id": item_id, "verbose": verbose}

    lax = APIRouter()

    @lax.get("/lax")
    async def lax_route(kind: str | None = Query(None)) -> dict[str, str | None]:
        return {"kind": kind}

    app = FastAPI()
    app.include_router(strict, prefix="/strict")
    app.include_router(lax)
    return app


@pytest_asyncio.fixture()
async def synthetic() -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_synthetic_app()), base_url="http://test"
    ) as client:
        yield client


def _detail(resp: httpx.Response) -> dict[str, object]:
    detail = resp.json()["detail"]
    assert isinstance(detail, dict)
    return detail


class TestRouteClassInIsolation:
    async def test_alias_is_the_wire_name(self, synthetic: httpx.AsyncClient) -> None:
        """``artifact_status`` is declared with ``alias="status"``: the alias
        is accepted, the Python name is not."""
        ok = await synthetic.get("/strict/aliased", params={"status": "VETTED"})
        assert ok.status_code == 200, ok.text
        assert ok.json() == {"status": "VETTED", "kind": None}

        by_python_name = await synthetic.get(
            "/strict/aliased", params={"artifact_status": "VETTED"}
        )
        assert by_python_name.status_code == 422
        detail = _detail(by_python_name)
        assert detail["error"] == UNKNOWN_QUERY_PARAMETER
        assert detail["unknown"] == ["artifact_status"]
        assert detail["accepted"] == ["kind", "status"]
        assert detail["route"] == "/strict/aliased"

    async def test_unknown_keys_are_listed_sorted_and_deduplicated(
        self, synthetic: httpx.AsyncClient
    ) -> None:
        resp = await synthetic.get("/strict/aliased?zeta=1&alpha=2&alpha=3&kind=plan")
        assert resp.status_code == 422
        assert _detail(resp)["unknown"] == ["alpha", "zeta"]

    async def test_repeated_declared_key_is_fine(
        self, synthetic: httpx.AsyncClient
    ) -> None:
        resp = await synthetic.get("/strict/aliased?kind=a&kind=b")
        assert resp.status_code == 200, resp.text

    async def test_sub_dependency_query_params_are_accepted(
        self, synthetic: httpx.AsyncClient
    ) -> None:
        """A key FastAPI reads through ``Depends(...)`` is a key the route
        implements — the flat dependant is the oracle, not the signature."""
        ok = await synthetic.get("/strict/nested", params={"page": "3"})
        assert ok.status_code == 200, ok.text
        assert ok.json() == {"page": 3}

        bad = await synthetic.get("/strict/nested", params={"pages": "3"})
        assert bad.status_code == 422
        assert _detail(bad)["accepted"] == ["page"]

    async def test_query_model_expands_to_its_field_aliases(
        self, synthetic: httpx.AsyncClient
    ) -> None:
        ok = await synthetic.get(
            "/strict/model", params={"offset": "2", "page_size": "5"}
        )
        assert ok.status_code == 200, ok.text
        assert ok.json() == {"offset": 2, "limit": 5}

        # The parameter's own name (``window``) and the model field's PYTHON
        # name behind an alias (``limit``) are not wire keys.
        for wrong in ("window", "limit"):
            bad = await synthetic.get("/strict/model", params={wrong: "1"})
            assert bad.status_code == 422, wrong
            assert _detail(bad)["unknown"] == [wrong]
            assert _detail(bad)["accepted"] == ["offset", "page_size"]

    async def test_route_with_no_query_params_accepts_nothing(
        self, synthetic: httpx.AsyncClient
    ) -> None:
        ok = await synthetic.get("/strict/bare")
        assert ok.status_code == 200
        bad = await synthetic.get("/strict/bare", params={"anything": "1"})
        assert bad.status_code == 422
        assert _detail(bad)["accepted"] == []
        assert _detail(bad)["unknown"] == ["anything"]

    async def test_path_param_is_not_a_query_key(
        self, synthetic: httpx.AsyncClient
    ) -> None:
        ok = await synthetic.get("/strict/items/abc", params={"verbose": "true"})
        assert ok.status_code == 200, ok.text
        assert ok.json() == {"item_id": "abc", "verbose": True}

        bad = await synthetic.get("/strict/items/abc", params={"item_id": "abc"})
        assert bad.status_code == 422
        assert _detail(bad)["unknown"] == ["item_id"]
        assert _detail(bad)["accepted"] == ["verbose"]

    async def test_plain_router_still_ignores_unknown_keys(
        self, synthetic: httpx.AsyncClient
    ) -> None:
        """The contrast: strictness is opt-in per router, so a router that
        did not adopt the class keeps FastAPI's default silent discard."""
        resp = await synthetic.get("/lax", params={"kind": "plan", "bogus": "1"})
        assert resp.status_code == 200
        assert resp.json() == {"kind": "plan"}

    def test_accepted_keys_match_the_openapi_document(self) -> None:
        """Same oracle two ways: what the class derives from the dependant is
        exactly what FastAPI publishes as ``in: query`` for the route."""
        app = _synthetic_app()
        spec = app.openapi()
        for route in app.routes:
            if not isinstance(route, StrictQueryRoute):
                continue
            published = sorted(
                p["name"]
                for p in spec["paths"][route.path]["get"].get("parameters", [])
                if p["in"] == "query"
            )
            assert accepted_query_keys(route.dependant) == published, route.path


# ===========================================================================
# Layer 2 — the plan-library router (first adopter)
# ===========================================================================


def _plan_library_app() -> FastAPI:
    """The router mounted as ``api.py`` mounts it — no overrides at all.

    None are needed: a refused request never reaches the auth or database
    dependencies, which is the property under test.
    """
    from app.api.v1.endpoints.plan_library import router

    app = FastAPI()
    app.include_router(router, prefix=API_PREFIX)
    return app


def _get_routes(app: FastAPI) -> dict[str, APIRoute]:
    return {
        r.path: r for r in app.routes if isinstance(r, APIRoute) and "GET" in r.methods
    }


def _published_query_names(app: FastAPI, path: str) -> list[str]:
    spec = app.openapi()
    return sorted(
        p["name"]
        for p in spec["paths"][path]["get"].get("parameters", [])
        if p["in"] == "query"
    )


@pytest.fixture()
def plan_library_app() -> FastAPI:
    return _plan_library_app()


@pytest_asyncio.fixture()
async def plan_client(
    plan_library_app: FastAPI,
) -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=plan_library_app), base_url="http://test"
    ) as client:
        yield client


class TestPlanLibraryRefusesUnknownKeys:
    def test_every_get_route_is_strict(self, plan_library_app: FastAPI) -> None:
        routes = _get_routes(plan_library_app)
        assert routes, "no GET routes mounted"
        for path, route in routes.items():
            assert isinstance(route, StrictQueryRoute), path

    @pytest.mark.parametrize(
        ("suffix", "unknown"),
        [
            ("", "slug"),
            ("", "work_unit_slig"),
            ("/candidates", "work_unit_slug"),
            ("/export", "artifact_status"),
        ],
    )
    async def test_unknown_key_is_422_naming_the_accepted_set(
        self,
        plan_library_app: FastAPI,
        plan_client: httpx.AsyncClient,
        suffix: str,
        unknown: str,
    ) -> None:
        """``accepted`` is read from the app's own routes, not retyped: the
        route object's dependant and the OpenAPI document must both agree
        with the body, so a handler gaining a ``Query(...)`` cannot desync
        this test from the contract."""
        path = f"{API_PREFIX}{suffix}"
        route = _get_routes(plan_library_app)[path]

        resp = await plan_client.get(path, params={unknown: "x", "limit": "1"})
        assert resp.status_code == 422, resp.text
        detail = _detail(resp)
        assert detail["error"] == UNKNOWN_QUERY_PARAMETER
        assert detail["unknown"] == [unknown]
        assert detail["route"] == path
        assert detail["accepted"] == accepted_query_keys(route.dependant)
        assert detail["accepted"] == _published_query_names(plan_library_app, path)
        assert "limit" in detail["accepted"]
        assert unknown not in detail["accepted"]

    async def test_status_alias_is_the_accepted_spelling(
        self, plan_library_app: FastAPI
    ) -> None:
        """``artifact_status`` / ``status_filter`` are declared with
        ``alias="status"`` on the list and ``/export`` routes — the Risk the
        plan named. The wire name is what the contract accepts."""
        routes = _get_routes(plan_library_app)
        for suffix in ("", "/export"):
            accepted = accepted_query_keys(routes[f"{API_PREFIX}{suffix}"].dependant)
            assert "status" in accepted, suffix
            assert "artifact_status" not in accepted, suffix
            assert "status_filter" not in accepted, suffix

    async def test_path_param_is_not_mistaken_for_a_query_key(
        self, plan_library_app: FastAPI, plan_client: httpx.AsyncClient
    ) -> None:
        """``/{artifact_id}`` takes ``artifact_id`` from the PATH; sending it as
        a query key is unknown, and the accepted set is the query set only."""
        routes = _get_routes(plan_library_app)
        artifact_id = uuid4()

        detail_route = routes[f"{API_PREFIX}/{{artifact_id}}"]
        assert accepted_query_keys(detail_route.dependant) == ["include_coord"]
        resp = await plan_client.get(
            f"{API_PREFIX}/{artifact_id}", params={"artifact_id": str(artifact_id)}
        )
        assert resp.status_code == 422, resp.text
        assert _detail(resp)["unknown"] == ["artifact_id"]
        assert _detail(resp)["accepted"] == ["include_coord"]
        assert _detail(resp)["route"] == f"{API_PREFIX}/{{artifact_id}}"

        export_route = routes[f"{API_PREFIX}/{{artifact_id}}/export"]
        assert accepted_query_keys(export_route.dependant) == ["version_number"]
        resp = await plan_client.get(
            f"{API_PREFIX}/{artifact_id}/export", params={"version": "1"}
        )
        assert resp.status_code == 422, resp.text
        assert _detail(resp)["unknown"] == ["version"]
        assert _detail(resp)["accepted"] == ["version_number"]


class TestProductionBodyShape:
    """Through the booted ``app.main.app``: the app-level HTTPException handler
    lifts ``error`` and the extra fields to the top level. This is the body a
    real caller sees, and its field names are coord's."""

    def test_refusal_body_through_the_real_app(self, test_client: TestClient) -> None:
        resp = test_client.get(
            f"{API_PREFIX}/candidates", params={"work_unit_slug": "abc", "limit": "1"}
        )
        assert resp.status_code == 422, resp.text
        body = resp.json()
        assert body["error"] == UNKNOWN_QUERY_PARAMETER
        assert body["unknown"] == ["work_unit_slug"]
        assert body["route"] == f"{API_PREFIX}/candidates"
        assert "limit" in body["accepted"]
        assert "work_unit_slug" not in body["accepted"]
        from app.main import app as production_app

        assert body["accepted"] == _published_query_names(
            production_app, f"{API_PREFIX}/candidates"
        )
        assert "does not implement query parameter(s) work_unit_slug" in body["message"]
