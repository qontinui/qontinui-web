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
from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_current_active_user_async
from app.api.v1.endpoints.admin_dev import (
    _COORD_DOWN_STATUSES,
    _capture_bearer_best_effort,
)
from app.api.v1.endpoints.operations import (
    _caller_bearer,
    _extract_caller_token,
    _proxy_coord_get,
    _tenant_headers,
    get_tenant_id,
)
from app.core.config import settings
from app.services.coord_identity import get_coord_identity

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
    # NOTE: `auth` is intentionally absent — coord_query_auth_config exposes
    # Cognito pool wiring / tenancy graph (the most recon-sensitive sub-space),
    # so coord drops it from its snapshot map (/coord/twin/auth/verdict 404s) and
    # we don't probe it. The manifest marks `auth` parameterized (interactive
    # explorer only).
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

    if resp.status_code == 403:
        # coord's twin tenant gate (require_twin_tenant) denied this operator —
        # their home tenant is outside COORD_TWIN_ALLOWED_TENANT_IDS. Distinct
        # from a tool failure: it's an access decision, surfaced as "restricted"
        # so the UI shows a friendly access message instead of an all-error grid.
        return {"id": subspace, "status": "restricted"}
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


def _degraded_matrix(reason: str) -> dict[str, Any]:
    """An all-error matrix returned (HTTP 200) when coord / the tenant cannot be
    resolved — honest degradation, never a 5xx. The page must not hard-fail when
    coord is down, and the Spec CI crawl gate flags a new route that 5xx's."""
    return {
        "subspaces": [
            {"id": s, "status": "error", "error": reason} for s in _PROBEABLE_SUBSPACES
        ],
        "probed": len(_PROBEABLE_SUBSPACES),
        "degraded": True,
    }


@router.get("/subspaces")
async def get_twin_subspaces(
    request: Request,
    _user=Depends(get_current_active_user_async),
) -> Any:
    """Live numerator for the completeness matrix: a per-sub-space probe of
    every fleet-wide snapshot twin observer.

    Per-tenant: the home tenant is resolved best-effort (and the caller's Cognito
    bearer captured for forwarding). The matrix reflects what coord can observe
    for *their* tenant — flag-gated / tenant-scoped observers legitimately read
    ``blind`` for some tenants. If coord/the tenant is unavailable we DEGRADE to
    an all-error matrix (HTTP 200), never 5xx.
    """
    _caller_bearer.set(_extract_caller_token(request))
    try:
        identity = await get_coord_identity(request)
        tenant_id = identity.home_tenant_id
    except Exception:  # coord unreachable / unresolvable — degrade, don't 5xx
        tenant_id = None
    if tenant_id is None:
        return _degraded_matrix("coord_unavailable")

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
    # coord's twin tenant gate (when armed) 403s every route for an operator
    # outside COORD_TWIN_ALLOWED_TENANT_IDS. Surface that as a top-level
    # `restricted` flag so the UI shows a friendly access message rather than an
    # all-"error" grid (an access decision, not an outage).
    restricted = any(r.get("status") == "restricted" for r in results)
    payload = {
        "subspaces": list(results),
        "probed": len(results),
        "restricted": restricted,
    }
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


@router.get("/catalog")
async def get_twin_catalog(
    _tenant_key: str | None = Depends(_capture_bearer_best_effort),
    _user=Depends(get_current_active_user_async),
) -> Any:
    """The coord-owned queryable-surface catalog — the single-source index of the
    fleet-wide ``coord_query_*`` twin observers (agent Q&A meta-answer Phase 2).

    The catalog content is fleet-global static metadata, but coord's
    ``GET /coord/twin/catalog`` is auth-gated via ``TenantId`` (read-auth
    contract), so the operator bearer is forwarded (``forward_bearer=True``).
    The bearer capture is best-effort (never raises) rather than a hard
    ``get_tenant_id`` dependency, mirroring ``get_release_verdict``'s posture:
    when coord is unreachable (connect-refused → 502, timeout → 504, etc.) the
    endpoint returns an empty ``{entries: [], total: 0, coord_error}`` envelope
    rather than re-raising the 5xx, so neither the Spec CI crawl gate (which
    runs without a live coord) nor the dashboard ever sees a 5xx. Returns
    ``{entries: [...], total: N}``.
    """
    try:
        return await _proxy_coord_get("/coord/twin/catalog", forward_bearer=True)
    except HTTPException as exc:
        if exc.status_code in _COORD_DOWN_STATUSES:
            detail = exc.detail if isinstance(exc.detail, str) else "coord unavailable"
            return {"entries": [], "total": 0, "coord_error": detail}
        raise


@router.get("/delivery/verdict")
async def get_delivery_verdict(
    plan_slug: str | None = None,
    repo: str | None = None,
    pr: int | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Delivery verdict for one plan — "has this plan/PR actually landed?".

    The *parameterized* twin read (Phase 5 of plan
    ``2026-06-15-twin-delivery-verdict-completion-view``). Unlike the snapshot
    matrix, delivery needs an argument (``plan_slug``, or ``repo``+``pr``), so it
    is a distinct on-demand route rather than a matrix cell. It proxies coord's
    SSO-gated ``GET /coord/twin/delivery/verdict`` (``twin_routes.rs``), which
    dispatches the SAME ``coord_query_delivery`` MCP tool an agent calls — with
    ``force_refresh=true`` server-side — so the dashboard answer is byte-identical
    to (and as fresh as) what an agent would receive: plan lifecycle status ⋈
    per-PR merge state ⋈ best-effort deploy state, with provenance + staleness.

    Validates the parameter set locally (mirroring coord) to avoid a wasted
    round-trip; coord's own 4xx/5xx (e.g. a tool failure → 502) still surface via
    :func:`_proxy_coord_get`.
    """
    has_slug = bool(plan_slug and plan_slug.strip())
    has_repo_pr = bool(repo and repo.strip()) and pr is not None
    if not has_slug and not has_repo_pr:
        raise HTTPException(
            status_code=400,
            detail="plan_slug (or repo+pr) is required",
        )

    params: dict[str, Any] = {}
    if has_slug:
        params["plan_slug"] = plan_slug.strip()  # type: ignore[union-attr]
    if repo and repo.strip():
        params["repo"] = repo.strip()
    if pr is not None:
        params["pr"] = pr

    return await _proxy_coord_get(
        "/coord/twin/delivery/verdict", params=params, tenant_id=tenant_id
    )
