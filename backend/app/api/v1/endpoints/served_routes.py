"""The served-routes inventory: ``GET /api/v1/meta/served-routes``.

Phase 3 of plan
``qontinui-dev-notes/plans/2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb.md``
(design decision D1).

coord's route-serving observer used to learn whether a documented route is
served by SENDING its documented verb: every static POST, PUT, PATCH and DELETE,
anonymously, three times per 300 s cycle. One of those probes ran a committed
DELETE on every cycle. This route replaces those probes with one read. It
reports the routes this process actually serves, so the observer compares them
against the committed spec per method (and for ``{param}`` paths too, which a
probe could not reach) without invoking a single handler.

What it lists, and what it does not
====================================

Every ``APIRoute`` with ``include_in_schema`` set, as ``(method, path)`` pairs,
where ``path`` is ``route.path_format``: the OpenAPI key form, with converters
stripped (``/files/{file_path}``, never ``/files/{file_path:path}``). That is
the form ``scripts/export_openapi.py`` writes into the committed spec, so a
listed path compares against a spec key byte for byte. The methods are the
route's own, which is exactly the set FastAPI turns into OpenAPI operations.

Routes hidden from the schema are COUNTED in ``hidden_count`` and never named.
Everything listed is already disclosed by the public repo's committed spec, so
the route discloses nothing new. It is public for the same reason, and because
the observer carries no credential to this host (plan D2). It is itself hidden
from the schema, so it counts itself in ``hidden_count``.

``build_sha`` is the image's commit (``QONTINUI_BUILD_SHA``, set by
``backend/Dockerfile`` from ``deploy-web.yml``; ``unknown`` elsewhere). coord
reads two fetches that disagree on it as a rollout in progress, never as a
removed route (plan test T10).

Caching
=======

The inventory is computed once per app, on first request, and cached on
``app.state``: routes are registered at import time (cloud-control's included)
and do not change while the process runs. The plan says "at startup"; building
on first request is the same inventory, without a lifespan hook. ``digest`` is a
SHA-256 over the sorted pairs only, not over ``build_sha``, so a redeploy that
serves the same routes keeps its digest and its ETag. The ETag is WEAK
(``W/"<digest>"``) because ``GZipMiddleware`` may re-encode the body, and a
strong ETag promises byte identity. A request whose ``If-None-Match`` names it
(weak comparison) gets ``304`` and no body. The route has no rate limit: coord
fetches it once per pass, conditionally.

Prod serves more than the committed BASE spec declares: the image composes
qontinui-cloud-control (``backend/Dockerfile``), so its extension routes are
listed here too. Comparing this inventory against the base spec therefore shows
them as undeclared; that is prod's real surface, and a Phase 4 reader must
declare against the extended spec or treat them accordingly.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterable
from dataclasses import dataclass

from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from starlette.responses import Response
from starlette.routing import BaseRoute

router = APIRouter()

INVENTORY_SCHEMA_VERSION = 1
BUILD_SHA_ENV = "QONTINUI_BUILD_SHA"
UNKNOWN_BUILD_SHA = "unknown"

_STATE_ATTR = "served_routes_inventory"


@dataclass(frozen=True)
class ServedRouteInventory:
    """The serialized inventory body and the weak ETag that names it."""

    body: bytes
    etag: str
    digest: str


def _build_sha() -> str:
    return os.environ.get(BUILD_SHA_ENV, "").strip() or UNKNOWN_BUILD_SHA


def build_served_route_inventory(
    routes: Iterable[BaseRoute], build_sha: str
) -> ServedRouteInventory:
    """Build the inventory over ``routes``.

    Only ``APIRoute`` instances are considered. Mounts, websocket routes and
    plain Starlette routes are not HTTP API operations and never appear in the
    OpenAPI document, so they are neither listed nor counted.
    """
    served: set[tuple[str, str]] = set()
    hidden: set[tuple[str, str]] = set()
    for route in routes:
        if not isinstance(route, APIRoute):
            continue
        target = served if route.include_in_schema else hidden
        for method in route.methods:
            target.add((method.upper(), route.path_format))

    # A (method, path) pair both hidden and served (two registrations of one
    # operation) is listed, because it IS served in the schema.
    hidden -= served

    pairs = sorted(served, key=lambda p: (p[1], p[0]))
    digest = hashlib.sha256(
        "\n".join(f"{method} {path}" for method, path in pairs).encode("utf-8")
    ).hexdigest()
    body = json.dumps(
        {
            "schema_version": INVENTORY_SCHEMA_VERSION,
            "build_sha": build_sha,
            "digest": f"sha256:{digest}",
            "route_count": len(pairs),
            "hidden_count": len(hidden),
            "routes": [{"method": m, "path": p} for m, p in pairs],
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return ServedRouteInventory(body=body, etag=f'W/"{digest}"', digest=digest)


def _inventory_for(request: Request) -> ServedRouteInventory:
    state = request.app.state
    inventory: ServedRouteInventory | None = getattr(state, _STATE_ATTR, None)
    if inventory is None:
        inventory = build_served_route_inventory(request.app.routes, _build_sha())
        setattr(state, _STATE_ATTR, inventory)
    return inventory


def _opaque_tag(tag: str) -> str:
    return tag[2:] if tag.startswith("W/") else tag


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    """RFC 9110 weak comparison of an ``If-None-Match`` list against ``etag``."""
    if not if_none_match:
        return False
    for candidate in if_none_match.split(","):
        candidate = candidate.strip()
        if candidate == "*":
            return True
        if _opaque_tag(candidate) == _opaque_tag(etag):
            return True
    return False


@router.get("/served-routes")
async def get_served_routes(request: Request) -> Response:
    """Every in-schema route this process serves, as (method, path) pairs.

    Public and unauthenticated by design; see the module docstring.
    """
    inventory = _inventory_for(request)
    headers = {"ETag": inventory.etag, "Cache-Control": "no-cache"}
    if etag_matches(request.headers.get("If-None-Match"), inventory.etag):
        return Response(status_code=304, headers=headers)
    return Response(
        content=inventory.body, media_type="application/json", headers=headers
    )
