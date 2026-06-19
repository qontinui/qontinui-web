"""Superuser dev-overview proxy — gates & rollout dashboard backend.

A single read-only proxy endpoint backing the superuser "gates & rollout"
dashboard at ``/admin/coord/gates`` in the operator console. It forwards to
coord's ``GET /coord/dev-overview`` (which emits the gates + rollout
contract consumed by the frontend ``admin-dev-service``).

Auth posture: ``require_admin`` (superuser) is the hard web-side gate and is
NEVER weakened. The page itself lives behind the console's superuser gate
too; this is defense in depth. Coord additionally authorizes on the
forwarded caller bearer.

Total-outage hardening (Phase 3): the handler must NOT hard-depend on coord
identity resolution succeeding. Earlier this endpoint depended on
``get_tenant_id``, which calls coord ``GET /admin/coord/me`` in the
dependency — when coord is FULLY down that 502s *before* the handler runs,
so the page showed a raw error instead of the friendly "coord unavailable"
banner. The overview is fleet-wide (not tenant-scoped on the web side), so a
resolved tenant is not actually required; only the caller bearer needs
forwarding. We therefore use a light dependency (:func:`_capture_bearer_best_effort`)
that captures the bearer and best-effort-resolves the tenant WITHOUT raising
on coord-down, and call ``_proxy_coord_get(..., forward_bearer=True)`` so the
bearer is forwarded even when the tenant could not be resolved. The existing
502/503/504 → empty+``coord_error`` degradation then covers total outage too.

Caching: ``/admin-dev/overview`` triggers a live coord eval on every call;
with the frontend auto-poll that is repeated fleet-wide load. A small
in-process TTL cache (:data:`_CACHE_TTL_SECONDS`) keyed by the resolved
tenant_id (``None`` is its own key, so coord-down callers don't share with
resolved ones) serves a fresh cached envelope when available. Only
SUCCESSFUL coord envelopes are cached — degraded/``coord_error`` envelopes
are never cached, so a transient outage cannot pin a stale banner. The
frontend Refresh button passes ``?refresh=1`` to bypass the cache.

The proxy plumbing comes from the shared :mod:`app.api.coord_proxy` module
(re-export of the canonical helpers in
``app.api.v1.endpoints.operations``) so this endpoint does not grow a third
private copy of the bearer-capture/forward machinery.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.admin_deps import require_admin
from app.api.coord_proxy import (
    _caller_bearer,
    _extract_caller_token,
    _proxy_coord_get,
)
from app.models.user import User
from app.services.coord_identity import get_coord_identity

router = APIRouter()

# coord-unavailability statuses that the monitoring dashboard degrades over
# rather than propagating: a read-only status page should render a
# "coord unavailable" banner, not a hard 5xx. (Also keeps the Spec CI crawl
# gate green — coord is unreachable in that environment.)
_COORD_DOWN_STATUSES = {502, 503, 504}

# ---- In-process TTL cache (Phase 3) --------------------------------------
#
# The overview is an expensive live coord eval; the frontend auto-polls it.
# A tiny module-level cache keyed by the resolved tenant_id (or ``None``)
# serves a fresh successful envelope without re-hitting coord. Thread-safety
# for the async runtime is provided by a single asyncio.Lock guarding the
# dict. Only successful envelopes are stored — never a ``coord_error``
# degraded envelope (so a transient outage can't pin a stale banner).
_CACHE_TTL_SECONDS = 30.0

# cache key (tenant_id, limit, verdict) -> (monotonic_expiry, cached_envelope).
# limit/verdict are part of the key so different views never serve each other's
# cached page.
_CacheKey = tuple[UUID | None, int, str | None]
_overview_cache: dict[_CacheKey, tuple[float, dict[str, Any]]] = {}
_cache_lock = asyncio.Lock()


def _empty_overview(detail: str) -> dict[str, Any]:
    """A valid (empty) dev-overview envelope annotated with ``coord_error``.

    Shape matches coord's ``{generated_at, gates, counts, rollouts}`` contract
    so the frontend types stay valid; ``coord_error`` (an optional field the
    page surfaces as a banner) explains why the data is empty.
    """
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "gates": [],
        "counts": {
            "total": 0,
            "open": 0,
            "cleared": 0,
            "cleared_today": 0,
            "failed": 0,
            "stale": 0,
            "muted": 0,
            "snoozed": 0,
        },
        "rollouts": {
            "auto_merge": {"live": [], "shadow": [], "dry_run": []},
            "features": [],
        },
        "coord_error": detail,
    }


async def _capture_bearer_best_effort(request: Request) -> UUID | None:
    """Capture the caller bearer; best-effort resolve the tenant (no raise).

    Replaces the hard ``get_tenant_id`` dependency. It performs the two jobs
    that dependency did — (a) capture the caller's Cognito bearer into the
    request-scoped ContextVar that ``_proxy_coord_get`` forwards, and (b)
    resolve the home tenant — but it NEVER raises when coord is unreachable.

    * The bearer capture is unconditional and runs first, so the forwarded
      bearer survives even if identity resolution fails.
    * Tenant resolution is best-effort: a coord-down failure (502/504) or an
      unresolved-operator 403 is swallowed and ``None`` is returned. The
      handler then forwards the bearer regardless (``forward_bearer=True``),
      and the overview's own degradation surfaces the banner.

    This is NOT an auth gate — ``require_admin`` (superuser) remains the hard
    web-side gate on the handler and is unaffected.
    """
    _caller_bearer.set(_extract_caller_token(request))
    try:
        identity = await get_coord_identity(request)
    except HTTPException:
        # coord unreachable (502/504), unresolved operator (403), or any
        # other coord-side error — the overview is fleet-wide, so a missing
        # tenant is tolerable. Forward the bearer anyway and let the proxy's
        # degradation handle a true outage.
        return None
    return identity.home_tenant_id


@router.get("/admin-dev/overview")
async def get_dev_overview(
    refresh: bool = Query(
        default=False,
        description="Bypass the ~30s in-process cache and refetch from coord.",
    ),
    limit: int = Query(
        default=200,
        ge=1,
        le=500,
        description="Max gates in the page (coord orders OPEN-first, so the "
        "actionable + ETA-bearing gates surface within the cap).",
    ),
    verdict: str | None = Query(
        default=None,
        pattern="^(open|cleared|failed)$",
        description="Optional verdict filter; omit for all (still open-first).",
    ),
    tenant_id: UUID | None = Depends(_capture_bearer_best_effort),
    _admin: User = Depends(require_admin),  # superuser gate (hard, never weakened)
) -> Any:
    """Proxy coord's ``GET /coord/dev-overview`` (gates + rollout overview).

    Returns coord's JSON envelope verbatim — the
    ``{generated_at, gates, rollouts}`` contract the frontend
    ``admin-dev-service`` types against. The overview is fleet-wide (not
    tenant-scoped on the web side); the caller bearer is forwarded so coord
    authorizes on the operator identity. ``tenant_id`` is resolved
    best-effort only (it may be ``None`` when coord identity resolution
    fails) and is used solely as the cache key — coord-down callers (key
    ``None``) never share a cache entry with resolved ones.

    Caching: a fresh successful envelope is served from a ~30s in-process
    cache; ``?refresh=1`` bypasses it (the frontend Refresh button passes
    it). Degraded ``coord_error`` envelopes are never cached.

    When coord is unreachable/degraded (connect-refused → 502, timeout →
    504, etc.) the endpoint returns an empty envelope annotated with
    ``coord_error`` rather than re-raising the 5xx, so the dashboard renders
    a clear "coord unavailable" state instead of a broken page. Because
    identity resolution no longer hard-fails the request, this covers a TOTAL
    coord outage too (not just the case where ``/admin/coord/me`` happened to
    succeed). The Spec CI crawl, which runs without a live coord, stays green.
    """
    cache_key: _CacheKey = (tenant_id, limit, verdict)
    if not refresh:
        cached = await _cache_get(cache_key)
        if cached is not None:
            return cached

    # Forward the page controls to coord (the shared `_proxy_coord_get` already
    # threads `params` onto the query string). `verdict` is omitted when None.
    params: dict[str, Any] = {"limit": limit}
    if verdict is not None:
        params["verdict"] = verdict

    try:
        envelope = await _proxy_coord_get(
            "/coord/dev-overview",
            params=params,
            tenant_id=tenant_id,
            forward_bearer=True,
        )
    except HTTPException as exc:
        if exc.status_code in _COORD_DOWN_STATUSES:
            detail = exc.detail if isinstance(exc.detail, str) else "coord unavailable"
            # Do NOT cache degraded envelopes.
            return _empty_overview(detail)
        raise

    # Only cache a successful coord envelope (never a degraded one).
    if isinstance(envelope, dict) and "coord_error" not in envelope:
        await _cache_set(cache_key, envelope)
    return envelope


def _empty_prs(detail: str) -> dict[str, Any]:
    """A valid (empty) open-PRs envelope annotated with ``coord_error``.

    Mirrors :func:`_empty_overview`'s degradation convention: the shape
    matches coord's ``{prs, total}`` contract so the frontend types stay
    valid, and ``coord_error`` (an optional field the page surfaces as a
    banner) explains why the data is empty. Returned instead of re-raising a
    coord-down 5xx so the dashboard renders a "coord unavailable" state
    rather than a broken page.
    """
    return {
        "prs": [],
        "total": 0,
        "coord_error": detail,
    }


@router.get("/admin-dev/prs")
async def get_prs(
    tenant_id: UUID | None = Depends(_capture_bearer_best_effort),
    _admin: User = Depends(require_admin),  # superuser gate (hard, never weakened)
) -> Any:
    """Proxy coord's ``GET /pr-merge/prs`` (open PRs + merge status).

    Pure passthrough: returns coord's JSON envelope verbatim — the
    ``{prs, total}`` contract where each PR is already enriched coord-side
    with a typed ``merge_status`` + ``blocking_summary`` (coord owns that
    shape; the web side computes nothing and renames nothing). The list is
    fleet-wide (not tenant-scoped on the web side); the caller bearer is
    forwarded so coord authorizes on the operator identity. ``tenant_id`` is
    resolved best-effort only (it may be ``None`` when coord identity
    resolution fails) and is used solely to trigger bearer-forwarding.

    Mirrors ``get_dev_overview``'s auth + degradation posture exactly:
    ``require_admin`` (superuser) is the hard web-side gate, the bearer is
    captured best-effort so a coord-down identity resolution never 502s in
    the dependency, and ``forward_bearer=True`` forwards the bearer even when
    the tenant is unresolved. When coord is unreachable/degraded
    (connect-refused → 502, timeout → 504, etc.) the endpoint returns an
    empty ``{prs, total, coord_error}`` envelope rather than re-raising the
    5xx, so the dashboard renders a clear "coord unavailable" state.

    Unlike the overview, this list is NOT cached: it reflects fast-moving PR
    + CI state where stale data is misleading on a merge-readiness dashboard.
    """
    try:
        envelope = await _proxy_coord_get(
            "/pr-merge/prs", tenant_id=tenant_id, forward_bearer=True
        )
    except HTTPException as exc:
        if exc.status_code in _COORD_DOWN_STATUSES:
            detail = exc.detail if isinstance(exc.detail, str) else "coord unavailable"
            return _empty_prs(detail)
        raise
    return envelope


async def _cache_get(key: _CacheKey) -> dict[str, Any] | None:
    """Return a non-expired cached envelope for ``key`` or ``None``."""
    now = time.monotonic()
    async with _cache_lock:
        entry = _overview_cache.get(key)
        if entry is None:
            return None
        expiry, envelope = entry
        if expiry <= now:
            # Stale — drop it so the dict doesn't accumulate dead keys.
            _overview_cache.pop(key, None)
            return None
        return envelope


async def _cache_set(key: _CacheKey, envelope: dict[str, Any]) -> None:
    """Store ``envelope`` for ``key`` with a ~30s TTL."""
    expiry = time.monotonic() + _CACHE_TTL_SECONDS
    async with _cache_lock:
        _overview_cache[key] = (expiry, envelope)
