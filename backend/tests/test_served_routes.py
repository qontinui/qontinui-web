"""``GET /api/v1/meta/served-routes``: the inventory coord reads instead of probing.

Plan ``2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb``,
Phase 3, test T11. What must hold, each with the mutation that turns it red:

* every in-schema ``APIRoute``'s ``(method, path_format)`` is listed, and only
  those (listing a hidden route, or emitting ``route.path``, fails);
* a ``{p:path}`` route is listed as ``{p}``, the OpenAPI key form;
* hidden routes are counted in ``hidden_count`` and never named;
* over the real app, the listed pairs are exactly the operations of
  ``app.openapi()``, the document ``scripts/export_openapi.py`` commits;
* ``If-None-Match`` naming the ETag answers 304 with no body (ignoring the
  header fails);
* the digest covers the routes, not the build, so a redeploy of the same
  surface keeps its ETag;
* the route is public and hidden from the schema.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI, WebSocket
from fastapi.testclient import TestClient

from app.api.v1.endpoints import served_routes
from app.api.v1.endpoints.served_routes import (
    BUILD_SHA_ENV,
    build_served_route_inventory,
    etag_matches,
)

_OPENAPI_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def _fixture_app() -> FastAPI:
    app = FastAPI()
    api = APIRouter()

    @api.get("/items")
    async def list_items() -> list[str]:
        return []

    @api.post("/items")
    async def create_item() -> dict[str, str]:
        return {}

    @api.api_route("/items/{item_id}", methods=["PUT", "PATCH"])
    async def update_item(item_id: int) -> dict[str, int]:
        return {"id": item_id}

    @api.get("/files/{file_path:path}")
    async def read_file(file_path: str) -> dict[str, str]:
        return {"path": file_path}

    @api.delete("/secret-admin", include_in_schema=False)
    async def hidden_route() -> None:
        return None

    @api.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        await websocket.close()

    app.include_router(api, prefix="/api/v1")
    app.include_router(
        served_routes.router, prefix="/api/v1/meta", include_in_schema=False
    )
    return app


def _inventory(app: FastAPI, build_sha: str = "abc123") -> dict:
    return json.loads(build_served_route_inventory(app.routes, build_sha).body)


def _openapi_operations(app: FastAPI) -> set[tuple[str, str]]:
    return {
        (method.upper(), path)
        for path, item in app.openapi()["paths"].items()
        for method in item
        if method in _OPENAPI_METHODS
    }


def test_lists_every_in_schema_operation_and_only_those() -> None:
    inv = _inventory(_fixture_app())
    pairs = {(r["method"], r["path"]) for r in inv["routes"]}
    assert pairs == {
        ("GET", "/api/v1/items"),
        ("POST", "/api/v1/items"),
        ("PUT", "/api/v1/items/{item_id}"),
        ("PATCH", "/api/v1/items/{item_id}"),
        ("GET", "/api/v1/files/{file_path}"),
    }
    assert inv["route_count"] == len(pairs)


def test_a_path_converter_is_listed_in_openapi_key_form() -> None:
    paths = {r["path"] for r in _inventory(_fixture_app())["routes"]}
    assert "/api/v1/files/{file_path}" in paths
    assert not any(":path" in p for p in paths), "emit path_format, not path"


def test_hidden_routes_are_counted_never_named() -> None:
    inv = _inventory(_fixture_app())
    assert inv["hidden_count"] == 2, (
        "the hidden DELETE and the inventory route itself; the websocket is "
        "not an HTTP operation and is neither listed nor counted"
    )
    body = json.dumps(inv)
    assert "secret-admin" not in body
    assert "served-routes" not in body


def test_the_fixture_inventory_equals_its_openapi_operations() -> None:
    app = _fixture_app()
    pairs = {(r["method"], r["path"]) for r in _inventory(app)["routes"]}
    assert pairs == _openapi_operations(app)


def test_the_real_app_inventory_equals_its_openapi_operations() -> None:
    """Over the app as built here, the inventory IS the committed spec's shape.

    ``scripts/export_openapi.py`` writes ``app.openapi()`` to the committed
    snapshot, and coord reads that snapshot as the declared set. Any pair here
    that is not an operation there would read as a ShadowRoute in coord, and
    any operation missing here as a RouteMissing, on a build that is correct.
    """
    from app.main import app

    pairs = {(r["method"], r["path"]) for r in _inventory(app)["routes"]}
    assert pairs == _openapi_operations(app)
    assert "/api/v1/meta/served-routes" not in app.openapi()["paths"]


def test_every_base_spec_operation_is_in_the_real_app_inventory() -> None:
    """Every operation of the committed BASE spec is served: no false RouteMissing.

    The base spec (``openapi-schema.base.json``) is the declared set coord reads
    for api.qontinui.io. The converse does not hold wherever cloud-control is
    installed (CI, and the prod image): its extension routes are served but
    not in the base spec, which is why this is a subset check.
    """
    from app.main import app

    spec_path = (
        Path(__file__).resolve().parents[2]
        / "frontend/src/lib/api-client/openapi-schema.base.json"
    )
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    declared = {
        (method.upper(), path)
        for path, item in spec["paths"].items()
        for method in item
        if method in _OPENAPI_METHODS
    }
    served = {(r["method"], r["path"]) for r in _inventory(app)["routes"]}
    missing = sorted(declared - served)
    assert not missing, f"declared in the base spec but not served: {missing[:10]}"


def test_the_digest_covers_routes_not_the_build() -> None:
    app = _fixture_app()
    a = build_served_route_inventory(app.routes, "sha-one")
    b = build_served_route_inventory(app.routes, "sha-two")
    assert a.etag == b.etag and a.digest == b.digest
    assert json.loads(a.body)["build_sha"] == "sha-one"
    assert json.loads(a.body)["digest"] == f"sha256:{a.digest}"

    other = FastAPI()

    @other.get("/only")
    async def only() -> None:
        return None

    assert build_served_route_inventory(other.routes, "sha-one").etag != a.etag


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, False),
        ("", False),
        ('"abc"', True),
        ('W/"abc"', True),
        ('"zzz", "abc"', True),
        ("*", True),
        ('"abcd"', False),
        ("abc", False),
    ],
)
def test_etag_matching(header: str | None, expected: bool) -> None:
    assert etag_matches(header, '"abc"') is expected
    assert etag_matches(header, 'W/"abc"') is expected, "weak comparison"


def test_the_route_serves_the_inventory_and_honours_if_none_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(BUILD_SHA_ENV, "deadbeef")
    client = TestClient(_fixture_app())

    first = client.get("/api/v1/meta/served-routes")
    assert first.status_code == 200
    assert first.headers["content-type"] == "application/json"
    etag = first.headers["etag"]
    body = first.json()
    assert body["build_sha"] == "deadbeef"
    assert body["schema_version"] == 1
    assert etag == f'W/"{body["digest"].removeprefix("sha256:")}"', (
        "weak: GZipMiddleware may re-encode the body"
    )

    second = client.get("/api/v1/meta/served-routes", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.content == b""
    assert second.headers["etag"] == etag

    stale = client.get(
        "/api/v1/meta/served-routes", headers={"If-None-Match": '"stale"'}
    )
    assert stale.status_code == 200


def test_an_unset_build_sha_reads_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(BUILD_SHA_ENV, raising=False)
    body = TestClient(_fixture_app()).get("/api/v1/meta/served-routes").json()
    assert body["build_sha"] == "unknown"


def test_the_real_app_serves_it_without_credentials() -> None:
    """Public by design: coord's observer carries no credential to this host."""
    from app.main import app

    response = TestClient(app).get("/api/v1/meta/served-routes")
    assert response.status_code == 200, response.text
    assert response.json()["route_count"] > 0
