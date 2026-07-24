"""Tenant-member dev-overview proxy — gates & rollout dashboard backend.

A single read-only proxy endpoint backing the "gates & rollout"
dashboard at ``/admin/coord/gates`` in the operator console. It forwards to
coord's ``GET /coord/dev-overview`` (which emits the gates + rollout
contract consumed by the frontend ``admin-dev-service``).

Auth posture: the tenant-scoped reads (``/admin-dev/overview`` and
``/admin-dev/prs``) are viewable by ANY AUTHENTICATED TENANT MEMBER
(``get_current_active_user_async`` — authn only, no superuser and no coord
role required). The console is a read-only, tenant-scoped VIEW: coord scopes
those gate/rollout/PR queries to the caller's effective tenant on the
forwarded bearer, so it is the tenant-scoping authority and the old
web-side superuser gate was over-restrictive (it contradicted the console's
documented "any tenant member may VIEW, read-only" design). Dropping it does
NOT widen data access — coord still authorizes and scopes by tenant. The
EXCEPTION is ``/admin-dev/release-verdict``, which stays ``require_admin``
(operator-only): the release verdict is fleet-wide operator-infrastructure
state (coord/web service deploys), not tenant-partitioned, so it must not be
opened to tenant members. Mutating routes remain gated elsewhere
(``require_coord_tenant_admin``); this module is
read-only.

Total-outage hardening (Phase 3): the handler must NOT hard-depend on coord
identity resolution succeeding. Earlier this endpoint depended on
``get_tenant_id``, which calls coord ``GET /admin/coord/me`` in the
dependency — when coord is FULLY down that 502s *before* the handler runs,
so the page showed a raw error instead of the friendly "coord unavailable"
banner. Coord scopes the overview to the effective tenant server-side, so no
web-resolved tenant is required on the wire; only the caller bearer and the
tenant-switcher selection header need forwarding. We therefore use a light
dependency (:func:`_capture_bearer_best_effort`) that captures both headers
and best-effort-resolves the cache-key tenant WITHOUT raising on coord-down,
and call ``_proxy_coord_get(..., forward_bearer=True)`` so the headers are
forwarded even when the tenant could not be resolved. The existing
502/503/504 → empty+``coord_error`` degradation then covers total outage too.

Caching: ``/admin-dev/overview`` triggers a live coord eval on every call;
with the frontend auto-poll that is repeated fleet-wide load. A small
in-process TTL cache (:data:`_CACHE_TTL_SECONDS`) keyed by the resolved
tenant_id (``None`` is its own key, so coord-down callers don't share with
resolved ones) serves a fresh cached envelope when available. Only
SUCCESSFUL coord envelopes are cached — degraded/``coord_error`` envelopes
are never cached. The frontend Refresh button passes ``?refresh=1`` to
bypass the cache.

Stale-while-revalidate (deploy resilience): a coord ECS rolling deploy
causes a seconds-long leader failover during which a coord read can time
out. Because the gate/rollout reads are NOT leader-gated (any caught-up
replica serves them from Postgres), the data we just showed is still valid,
so rather than blanking the page we retain the last successful envelope per
view for a longer window (:data:`_LAST_GOOD_TTL_SECONDS`) and serve THAT —
annotated ``coord_reconnecting``/``stale_since``/``last_good_generated_at`` —
on a coord-down error. The frontend shows a subtle "reconnecting" hint over
the live data and auto-recovers; the hard "unavailable" banner is reserved
for a true cold start with no last-known-good. (This SWR applies only to the
overview — the PR list and release-verdict are intentionally uncached and
NOT SWR'd: stale merge-readiness / "is prod current?" state is misleading,
not helpful.)

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

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.api.admin_deps import require_admin
from app.api.coord_proxy import (
    ACTIVE_TENANT_HEADER,
    _caller_active_tenant,
    _caller_bearer,
    _extract_caller_token,
    _proxy_coord_get,
    _proxy_coord_post,
)
from app.api.deps import get_current_active_user_async
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

# ---- Last-known-good (stale-while-revalidate) ----------------------------
#
# A coord ECS rolling deploy causes a seconds-long leader failover; during it
# a single coord-read timeout used to blank the whole gates/rollout page with
# a hard "coord unavailable — Retry with Refresh" banner. That is poor UX for
# a transient: the reads are NOT leader-gated (any caught-up replica serves
# them straight from Postgres — coord `src/api/gate_routes.rs::list_gates`),
# so the data we showed a moment ago is still valid.
#
# So we retain the LAST successful envelope per cache key for a longer window
# than the 30s freshness TTL, and on a coord-down error we serve THAT —
# annotated as stale/reconnecting — instead of an empty banner. The frontend
# renders a subtle "reconnecting — showing data from Ns ago" hint over the
# live data and auto-recovers, so a deploy never produces a dead page. The
# hard "unavailable" banner is reserved for a true cold start (no last-good
# for this key yet).
#
# Ceiling: beyond ~10 min the data is too old to responsibly present as
# "reconnecting", so we let it expire and fall back to the empty banner. This
# is deliberately distinct from the 30s freshness window — last-good is only
# consulted on the coord-down path, never served as if fresh.
_LAST_GOOD_TTL_SECONDS = 600.0

# cache key (effective_tenant, limit, verdict, include_archived, would_reap) ->
# (monotonic_expiry, cached_envelope). The effective tenant is the dashboard
# tenant-switcher selection when present, else the resolved home tenant — so
# two selections never serve each other's cached page.
# limit/verdict/include_archived/would_reap are part of the key so different
# views never serve each other's cached page either.
_CacheKey = tuple[str | None, int, str | None, bool, bool]
_overview_cache: dict[_CacheKey, tuple[float, dict[str, Any]]] = {}
# Last-known-good store: same key, a longer (~10 min) monotonic expiry. Only
# successful coord envelopes are ever stored here (written by `_cache_set`).
_last_good_cache: dict[_CacheKey, tuple[float, dict[str, Any]]] = {}
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
            "archived": 0,
        },
        "rollouts": {
            "auto_merge": {"live": [], "shadow": [], "dry_run": []},
            "features": [],
        },
        "coord_error": detail,
    }


def _degraded_with_last_good(detail: str, last_good: dict[str, Any]) -> dict[str, Any]:
    """Serve the last-known-good envelope annotated as stale/reconnecting.

    Used on the coord-down path when we still hold a recent successful
    envelope for this view. Returns a *copy* of ``last_good`` (never mutates
    the cached dict, which is shared) with three staleness markers added:

    * ``coord_reconnecting`` — the page renders a subtle "reconnecting" hint
      over the live data instead of the hard "unavailable" banner.
    * ``last_good_generated_at`` — coord's ``generated_at`` from when the data
      was actually produced, so the page can show a truthful "data from Ns
      ago" without the auto-poll resetting an "updated just now" stamp.
    * ``coord_error`` — kept (the reason) so telemetry and the cold-start
      banner path stay consistent; the page branches on ``coord_reconnecting``
      first, so a present-data degrade never shows the hard banner.

    ``gates`` / ``counts`` / ``rollouts`` are carried through from
    ``last_good`` unchanged — that is the whole point.
    """
    return {
        **last_good,
        "coord_reconnecting": True,
        "stale_since": datetime.now(UTC).isoformat(),
        "last_good_generated_at": last_good.get("generated_at"),
        "coord_error": detail,
    }


async def _capture_bearer_best_effort(request: Request) -> str | None:
    """Capture the caller bearer + tenant selection; never raise.

    Replaces the hard ``get_tenant_id`` dependency. It performs three jobs —
    (a) capture the caller's Cognito bearer into the request-scoped
    ContextVar that ``_proxy_coord_get`` forwards, (b) capture the dashboard
    tenant-switcher selection (``X-Qontinui-Active-Tenant``) into the
    ContextVar ``_tenant_headers`` forwards, so coord re-scopes the
    operator's context to the selected tenant (membership-validated
    coord-side by ``auth::apply_active_tenant_override``), and (c) return
    the effective-tenant cache key — but it NEVER raises when coord is
    unreachable.

    * The bearer + selection captures are unconditional and run first, so
      the forwarded headers survive even if identity resolution fails.
    * The returned key is the VALIDATED effective tenant: the switcher
      selection when the operator is a member of it (matched against
      ``identity.tenants``, mirroring coord's
      ``auth::apply_active_tenant_override`` membership gate and
      ``_effective_tenant_roles``), else the home tenant. The raw header
      must NEVER key the shared cache: coord silently serves HOME-tenant
      data for a non-member selection, so a raw-header key would let one
      operator's home envelope be served to a different operator who
      legitimately selected that tenant (cross-tenant cache poisoning).
    * On a coord-down failure (502/504) or an unresolved-operator 403 the
      error is swallowed and ``None`` is returned — the handler treats
      ``None`` as "identity unknown: bypass the shared cache entirely"
      (no read, no write, no last-known-good) while still forwarding the
      bearer (``forward_bearer=True``) so the overview's own degradation
      surfaces the banner.

    This is NOT an auth gate — the handler's authn dependency
    (``get_current_active_user_async``, any authenticated tenant member) is
    the web-side gate and is unaffected; coord scopes the data by tenant.
    """
    _caller_bearer.set(_extract_caller_token(request))
    selection = (request.headers.get(ACTIVE_TENANT_HEADER) or "").strip() or None
    _caller_active_tenant.set(selection)
    try:
        identity = await get_coord_identity(request)
    except HTTPException:
        # coord unreachable (502/504), unresolved operator (403), or any
        # other coord-side error — identity unknown, so the caller must
        # not touch the shared cache. Forward the bearer anyway and let
        # the proxy's degradation handle a true outage.
        return None
    if identity.home_tenant_id is None:
        return None
    effective = identity.home_tenant_id
    if selection:
        for t in identity.tenants:
            if str(t.tenant_id) == selection or t.slug == selection:
                effective = t.tenant_id
                break
    return str(effective)


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
    include_archived: bool = Query(
        default=False,
        description="Include reaper-archived (archived_at IS NOT NULL) gates in "
        "the page. Omitted/false ⇒ live gates only (the default hot path).",
    ),
    would_reap: bool = Query(
        default=False,
        description="Restrict to the Tier-4 SHADOW would-reap set "
        "(shadow_reap_signal IS NOT NULL) — the gates the reaper would reap if "
        "armed live, each carrying its cited abandonment signal. Omitted/false "
        "⇒ no shadow filter.",
    ),
    tenant_key: str | None = Depends(_capture_bearer_best_effort),
    _user: User = Depends(
        get_current_active_user_async
    ),  # any authenticated tenant member
) -> Any:
    """Proxy coord's ``GET /coord/dev-overview`` (gates + rollout overview).

    Returns coord's JSON envelope verbatim — the
    ``{generated_at, gates, rollouts}`` contract the frontend
    ``admin-dev-service`` types against. The caller bearer AND the dashboard
    tenant-switcher selection (``X-Qontinui-Active-Tenant``) are forwarded,
    so coord authorizes on the operator identity and scopes the overview to
    the selected tenant (coord's ``/coord/dev-overview`` filters every gate/
    rollout query by the effective tenant). ``tenant_key`` is the VALIDATED
    effective tenant (membership-checked selection, else home tenant) and is
    used solely as the cache key — two tenants never share a cache entry.
    ``None`` (identity resolution failed) bypasses the shared cache
    entirely, never sharing an entry with anyone.

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
    # ``tenant_key is None`` = identity unknown (coord-down / unresolved
    # operator): bypass the SHARED cache entirely — reading or writing it
    # without a validated tenant would let one operator's envelope be
    # served to another (cross-tenant cache poisoning).
    use_cache = tenant_key is not None
    cache_key: _CacheKey = (tenant_key, limit, verdict, include_archived, would_reap)
    if not refresh and use_cache:
        cached = await _cache_get(cache_key)
        if cached is not None:
            return cached

    # Forward the page controls to coord (the shared `_proxy_coord_get` already
    # threads `params` onto the query string). `verdict` is omitted when None;
    # `include_archived` is sent as `1` only when set (live-only is the default).
    params: dict[str, Any] = {"limit": limit}
    if verdict is not None:
        params["verdict"] = verdict
    if include_archived:
        params["include_archived"] = 1
    if would_reap:
        params["would_reap"] = 1

    try:
        envelope = await _proxy_coord_get(
            "/coord/dev-overview",
            params=params,
            forward_bearer=True,
        )
    except HTTPException as exc:
        if exc.status_code in _COORD_DOWN_STATUSES:
            detail = exc.detail if isinstance(exc.detail, str) else "coord unavailable"
            # Stale-while-revalidate: if we still hold a recent successful
            # envelope for this view, serve it annotated as reconnecting so a
            # transient (a coord deploy's leader failover) never blanks the
            # page. Only a true cold start (no last-good) falls back to the
            # hard "unavailable" banner. Degraded envelopes are never cached.
            # Identity-unknown callers skip last-good too (shared store).
            last_good = await _last_good_get(cache_key) if use_cache else None
            if last_good is not None:
                return _degraded_with_last_good(detail, last_good)
            return _empty_overview(detail)
        raise

    # Only cache a successful coord envelope (never a degraded one), and
    # only under a validated tenant key.
    if use_cache and isinstance(envelope, dict) and "coord_error" not in envelope:
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
    include_merged: int = Query(
        default=0,
        ge=0,
        le=24 * 30,
        description="When >0, ask coord to include recently-merged PRs (with "
        "per-PR deploy_state) in the list, not just open PRs. 0 (default) "
        "preserves the open-PRs-only behavior. coord honors this only after "
        "its own per-PR-deploy-state PR lands; forwarding it is harmless "
        "before then.",
    ),
    merged_count_hours: int = Query(
        default=0,
        ge=0,
        le=24 * 30,
        description="When >0, ask coord to add `merged_recent_count` (how many "
        "PRs landed in the last N hours) to the envelope — the cheap count "
        "without the expensive per-PR deploy classification `include_merged` "
        "does. Independent of `include_merged`; harmless against a coord that "
        "predates it (the field is simply absent).",
    ),
    _tenant_key: str | None = Depends(_capture_bearer_best_effort),
    _user: User = Depends(
        get_current_active_user_async
    ),  # any authenticated tenant member
) -> Any:
    """Proxy coord's ``GET /pr-merge/prs`` (open PRs + merge status).

    Pure passthrough: returns coord's JSON envelope verbatim — the
    ``{prs, total}`` contract where each PR is already enriched coord-side
    with a typed ``merge_status`` + ``blocking_summary`` (coord owns that
    shape; the web side computes nothing and renames nothing). The caller
    bearer and the tenant-switcher selection are forwarded so coord
    authorizes on the operator identity and scopes the list to the
    effective tenant; the dependency is retained purely for those
    header captures.

    Mirrors ``get_dev_overview``'s auth + degradation posture exactly: the
    web-side gate is authn only (``get_current_active_user_async`` — any
    authenticated tenant member; coord scopes the list to the caller's
    effective tenant), the bearer is captured best-effort so a coord-down
    identity resolution never 502s in the dependency, and
    ``forward_bearer=True`` forwards the bearer even when the tenant is
    unresolved. When coord is unreachable/degraded
    (connect-refused → 502, timeout → 504, etc.) the endpoint returns an
    empty ``{prs, total, coord_error}`` envelope rather than re-raising the
    5xx, so the dashboard renders a clear "coord unavailable" state.

    Unlike the overview, this list is NOT cached: it reflects fast-moving PR
    + CI state where stale data is misleading on a merge-readiness dashboard.
    """
    # Forward each param to coord only when set (>0) so the default request is
    # byte-for-byte the legacy open-PRs-only call. The shared
    # `_proxy_coord_get` threads `params` onto the query string. coord adds
    # `deploy_state`/`deploy_lag_secs`/`deployed_surface` to each PR row when
    # honoring `include_merged`, and a top-level `merged_recent_count` when
    # honoring `merged_count_hours`; this proxy returns coord's envelope
    # verbatim (no field whitelist/rename), so both pass through unchanged.
    params: dict[str, Any] = {}
    if include_merged > 0:
        params["include_merged"] = include_merged
    if merged_count_hours > 0:
        params["merged_count_hours"] = merged_count_hours
    try:
        envelope = await _proxy_coord_get(
            "/pr-merge/prs",
            params=params or None,
            forward_bearer=True,
        )
    except HTTPException as exc:
        if exc.status_code in _COORD_DOWN_STATUSES:
            detail = exc.detail if isinstance(exc.detail, str) else "coord unavailable"
            return _empty_prs(detail)
        raise
    return envelope


def _empty_release_verdict(detail: str) -> dict[str, Any]:
    """A valid (empty) release-verdict envelope annotated with ``coord_error``.

    Mirrors :func:`_empty_prs`'s degradation convention: the shape matches
    coord's release-verdict contract (``{verdict: {surfaces: [...]}}``) so the
    frontend type stays valid, and ``coord_error`` (an optional field the strip
    surfaces) explains why the data is empty. Returned instead of re-raising a
    coord-down 5xx so the deploy-status strip renders a "deploy status
    unavailable" state rather than emitting a 5xx that fails the crawl gate.
    """
    return {"verdict": {"surfaces": []}, "coord_error": detail}


@router.get("/admin-dev/release-verdict")
async def get_release_verdict(
    _tenant_key: str | None = Depends(_capture_bearer_best_effort),
    _admin: User = Depends(
        require_admin
    ),  # operator-only: verdict is fleet-wide, not tenant-scoped
) -> Any:
    """Proxy coord's ``GET /coord/twin/release/verdict`` (per-surface deploy state).

    Pure passthrough backing the always-visible deploy-status strip atop
    ``/admin/coord/prs``: returns coord's release-verdict envelope verbatim —
    the ``{verdict: {surfaces: [{components: {...}}]}}`` contract where each
    surface's per-surface drift state lives in ``surfaces[i].components`` (coord
    owns that shape; the web side computes nothing and renames nothing). The
    verdict is fleet-wide (deploy surfaces are not per-tenant); the caller
    bearer + tenant-switcher selection are forwarded so coord authorizes on
    the operator identity; the dependency is retained purely for those
    header captures.

    Auth: ``require_admin`` (operator/superuser) — UNLIKE ``get_overview`` /
    ``get_prs``, this read is NOT relaxed to tenant members. The release
    verdict is fleet-wide (deploy surfaces are the operator's own services —
    coord/web — not per-tenant), so it carries no tenant-scoped meaning for a
    developer and coord does not tenant-partition it; opening it to any member
    would expose operator infrastructure state cross-tenant. It shares
    ``get_prs``'s degradation posture: the bearer is captured best-effort so a
    coord-down identity resolution never 502s in the dependency, and
    ``forward_bearer=True`` forwards the bearer even when the tenant is
    unresolved. When coord is unreachable/degraded (connect-refused → 502,
    timeout → 504, etc.) the endpoint returns an empty
    ``{verdict: {surfaces: []}, coord_error}`` envelope rather than re-raising
    the 5xx, so neither the Spec CI crawl gate (which runs without a live coord)
    nor the dashboard ever sees a 5xx.

    Like ``get_prs``, this is NOT cached: it reflects fast-moving per-surface
    deploy state where stale data is misleading on a "is prod current?" strip.
    """
    try:
        envelope = await _proxy_coord_get(
            "/coord/twin/release/verdict",
            forward_bearer=True,
        )
    except HTTPException as exc:
        if exc.status_code in _COORD_DOWN_STATUSES:
            detail = exc.detail if isinstance(exc.detail, str) else "coord unavailable"
            return _empty_release_verdict(detail)
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
    """Store a successful ``envelope`` for ``key``.

    Writes both the ~30s freshness cache (the auto-poll fast path) and the
    ~10min last-known-good store (consulted only on the coord-down path for
    stale-while-revalidate). Callers must only pass a successful coord
    envelope here — never a ``coord_error`` degraded one.
    """
    now = time.monotonic()
    async with _cache_lock:
        _overview_cache[key] = (now + _CACHE_TTL_SECONDS, envelope)
        _last_good_cache[key] = (now + _LAST_GOOD_TTL_SECONDS, envelope)


async def _last_good_get(key: _CacheKey) -> dict[str, Any] | None:
    """Return the last successful envelope for ``key`` if within the ceiling.

    Consulted ONLY on the coord-down path. Returns ``None`` when there is no
    last-known-good for this view, or it has aged past
    :data:`_LAST_GOOD_TTL_SECONDS` (too old to present as "reconnecting").
    """
    now = time.monotonic()
    async with _cache_lock:
        entry = _last_good_cache.get(key)
        if entry is None:
            return None
        expiry, envelope = entry
        if expiry <= now:
            _last_good_cache.pop(key, None)
            return None
        return envelope


class GateDoctorSweepRequest(BaseModel):
    """Body for ``POST /admin-dev/gates/doctor/sweep``.

    Mirrors coord's ``GateDoctorSweepRequest`` defaults verbatim
    (``qontinui-coord/src/api/gate_routes.rs``): dry-run-first, and the
    ``land_backfill`` sweep mode (re-clear ``failed`` ``pr_merged``-on-coord
    gates whose work actually landed). ``mode`` is passed through unvalidated
    so coord remains the single authority on the mode set — an unknown mode
    is coord's ``400`` to raise, not the web layer's.
    """

    dry_run: bool = True
    mode: str = "land_backfill"


@router.post("/admin-dev/gates/doctor/sweep")
async def post_gate_doctor_sweep(
    body: GateDoctorSweepRequest,
    _tenant_key: str | None = Depends(_capture_bearer_best_effort),
    _admin: User = Depends(
        require_admin
    ),  # operator-only: the sweep mutates fleet-wide coord.gates, not tenant state
) -> Any:
    """Proxy coord's ``POST /coord/gates/doctor/sweep`` (gate-doctor sweep).

    Fires coord's gate-doctor sweep from the interactive operator console.
    coord mounts this on its admin-role ``operator_admin_writes`` router and
    rejects non-interactive/headless callers by design — the sweep must run
    from a logged-in dashboard session, which is exactly the operator bearer
    this proxy forwards (``forward_bearer=True``). The ``land_backfill`` mode
    re-clears ``failed`` ``pr_merged``-on-coord gates whose work actually
    landed (the residue the land-aware ``pr_merged`` verdict leaves behind).

    Auth: ``require_admin`` (operator-only) — UNLIKE the tenant-member reads
    (``overview`` / ``prs``), this is a MUTATION on fleet-wide operator
    infrastructure (``coord.gates``), not tenant-partitioned state. It mirrors
    the sibling operator-only mutation (``release-verdict``): web fails fast
    with a clean ``403`` for a non-admin rather than forwarding a doomed
    bearer for coord's admin-role router to reject opaquely. The
    ``_capture_bearer_best_effort`` dependency captures the caller bearer +
    tenant-switcher selection so ``forward_bearer=True`` forwards the
    operator's real identity for coord to authorize on.

    Body (``GateDoctorSweepRequest``) is passed through verbatim
    (``dry_run`` default ``true``, ``mode`` default ``"land_backfill"``);
    coord's ``BackfillReport`` JSON — ``{dry_run, examined, backfilled,
    left_failed, entries[]}`` — is returned verbatim. This is a MUTATION:
    it is NOT cached/SWR'd. coord ``4xx``/``5xx`` are surfaced verbatim (a
    ``403`` means the operator bearer was not forwarded/accepted — it is NOT
    swallowed into a degraded envelope).
    """
    return await _proxy_coord_post(
        "/coord/gates/doctor/sweep",
        body.model_dump(),
        forward_bearer=True,
    )
