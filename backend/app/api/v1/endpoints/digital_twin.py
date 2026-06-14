"""Digital Twin Explorer API — coord-backed completeness matrix.

Backs the ``/digital-twin`` web dashboard (Phase 1: the completeness matrix).
The frontend owns the *denominator* — the full sub-space taxonomy manifest
(including not-yet-built rows) under
``frontend/src/app/(app)/digital-twin/_lib/subspaces.manifest.json``. This
backend supplies the *numerator*: a live probe of each fleet-wide **snapshot**
twin observer, returning the same ``DriftVerdict`` envelope an AI agent would
receive (the product goal). The frontend joins the two by sub-space ``id``.

Read path (vetted): the browser carries an operator Cognito bearer, which we
forward to coord's SSO-gated ``GET /coord/twin/{subspace}/verdict`` routes
(``twin_routes.rs`` on coord's ``boundary_reads_sso`` family). We reuse the
exact bearer-forwarding + tenant-resolution helpers proven in ``operations.py``
so there is one ContextVar and one auth posture.

Only **snapshot** sub-spaces (no required args → a meaningful whole-sub-space
verdict) are live-probed. Parameterized-query sub-spaces (ci/log/ast/type/
origin_resolution) are interactive-only and surfaced from the manifest's static
status in Phase 2's explorer, not here.
"""

import asyncio
import time
from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends

from app.api.v1.endpoints.operations import (
    _proxy_coord_get,
    _tenant_headers,
    get_tenant_id,
)
from app.core.config import settings

logger = structlog.get_logger(__name__)

router = APIRouter()

# Per-probe budget. The matrix fans out concurrently, so the page-level latency
# is ~one probe, not the sum. Kept short: a slow observer should mark its cell
# "error", never hang the matrix.
_TWIN_PROBE_TIMEOUT = httpx.Timeout(8.0, connect=4.0)

# The fleet-wide SNAPSHOT sub-spaces the matrix live-probes. Mirrors the
# ``subspace_tool`` map in coord ``twin_routes.rs`` (guarded there by a unit
# test). If this list and coord's map drift, coord answers 404 for an unmapped
# id and the cell degrades to ``no_snapshot_tool`` — benign, never a crash.
_PROBEABLE_SUBSPACES: tuple[str, ...] = (
    "release",
    "schema",
    "infra",
    "infra_health",
    "config",
    "health",
    "deps",
    "route_serving",
    "auth",
    "client_telemetry",
    "worktree",
)

# Coverage at/above this counts as a fully-wired observer. Below it (but > 0 and
# not blind) is "partial". Observers routinely report coverage < 1 because a
# slice is unconfigured for this tenant/deploy — that is honest, not broken.
_FULL_COVERAGE_THRESHOLD = 0.99

# Short per-tenant TTL cache over the whole matrix fan-out. The matrix fires ~11
# live coord observer reads per load; without this, N dashboard viewers = N×11
# coord reads. React Query already throttles a single client; this bounds the
# coord load across all viewers of a tenant. Keyed by tenant; small + in-process
# (per worker) by design — staleness is acceptable for a completeness view.
_MATRIX_CACHE: dict[str, tuple[float, Any]] = {}
_MATRIX_CACHE_TTL_S = 30.0


def _classify(verdict: dict[str, Any]) -> str:
    """Map a ``DriftVerdict`` envelope to a matrix cell status.

    Mirrors the plan's "Live introspection" rubric. Blind (observer present but
    unconfigured for this tenant/deploy) is distinct from partial and from
    not-built — so the matrix never reports an unbuilt sub-space as merely
    "off".
    """
    coverage = verdict.get("coverage")
    provenance = str(verdict.get("provenance") or "")
    drift_class = str(verdict.get("drift_class") or "")

    if provenance.endswith(":unconfigured") or drift_class == "unknown":
        return "blind"
    if isinstance(coverage, int | float):
        if coverage >= _FULL_COVERAGE_THRESHOLD:
            return "implemented"
        if coverage > 0:
            return "partial"
        return "blind"
    # No coverage field at all — the observer answered but we can't grade it.
    return "partial"


def _envelope_metrics(verdict: dict[str, Any]) -> dict[str, Any]:
    """The goal-#3/#4 surface: the credibility/usefulness numbers, verbatim."""
    return {
        "coverage": verdict.get("coverage"),
        "credibility": verdict.get("credibility"),
        "posterior": verdict.get("posterior"),
        "staleness_seconds": verdict.get("staleness_seconds"),
        "provenance": verdict.get("provenance"),
        "drift_class": verdict.get("drift_class"),
    }


async def _probe_subspace(
    client: httpx.AsyncClient,
    subspace: str,
    headers: dict[str, str],
) -> dict[str, Any]:
    """Probe one sub-space's coord verdict route, tolerating every failure.

    Never raises: a coord error, an unreachable coord, or a tool failure all map
    to an honest cell status rather than aborting the whole matrix.
    """
    url = f"{settings.COORD_URL}/coord/twin/{subspace}/verdict"
    try:
        resp = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        return {"id": subspace, "status": "error", "error": "coord_timeout"}
    except httpx.HTTPError as exc:  # ConnectError and friends
        logger.warning("twin_probe_unreachable", subspace=subspace, error=str(exc))
        return {"id": subspace, "status": "error", "error": "coord_unreachable"}

    if resp.status_code == 404:
        # coord serves no snapshot tool for this id (parameterized/not-built).
        return {"id": subspace, "status": "no_snapshot_tool"}
    if resp.status_code >= 400:
        # Tool failed (e.g. hard live-read failure) — honest "error", never ok.
        detail: Any
        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text
        return {
            "id": subspace,
            "status": "error",
            "error": "coord_tool_failed",
            "http_status": resp.status_code,
            "detail": detail,
        }

    body = resp.json()
    verdict = body.get("verdict") if isinstance(body, dict) else None
    if not isinstance(verdict, dict):
        return {"id": subspace, "status": "error", "error": "malformed_verdict"}

    return {
        "id": subspace,
        "status": _classify(verdict),
        "tool": body.get("tool"),
        "metrics": _envelope_metrics(verdict),
    }


@router.get("/subspaces")
async def get_twin_subspaces(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Live numerator for the completeness matrix: a per-sub-space probe of
    every fleet-wide snapshot twin observer.

    Per-tenant: ``get_tenant_id`` resolves the operator's home tenant AND
    captures the caller's Cognito bearer (forwarded to coord). The matrix the
    user sees reflects what coord can observe for *their* tenant — flag-gated /
    tenant-scoped observers legitimately read ``blind`` for some tenants.
    """
    cache_key = str(tenant_id)
    now = time.monotonic()
    cached = _MATRIX_CACHE.get(cache_key)
    if cached is not None and now - cached[0] < _MATRIX_CACHE_TTL_S:
        return cached[1]

    headers = _tenant_headers(tenant_id)
    async with httpx.AsyncClient(timeout=_TWIN_PROBE_TIMEOUT) as client:
        results = await asyncio.gather(
            *(_probe_subspace(client, s, headers) for s in _PROBEABLE_SUBSPACES)
        )
    payload = {"subspaces": list(results), "probed": len(results)}
    _MATRIX_CACHE[cache_key] = (now, payload)
    return payload


@router.get("/subspace/{subspace_id}/raw")
async def get_twin_subspace_raw(
    subspace_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Raw ``DriftVerdict`` passthrough for one sub-space — the exact JSON an AI
    agent's ``tools/call`` receives. Backs Phase 2's "show raw data" button; the
    contract is defined now so it is stable. Errors surface as coord's status
    (404 for a non-snapshot id, 502 for a tool failure) via ``_proxy_coord_get``.
    """
    return await _proxy_coord_get(
        f"/coord/twin/{subspace_id}/verdict", tenant_id=tenant_id
    )
