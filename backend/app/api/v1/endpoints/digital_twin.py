"""Digital Twin Explorer API — coord-backed completeness matrix.

Backs the ``/digital-twin`` web dashboard (Phase 1: the completeness matrix).
The frontend owns the *denominator* — the full sub-space taxonomy manifest
(including not-yet-built rows) under
``frontend/src/app/(app)/digital-twin/_lib/subspaces.manifest.json``. This
backend supplies the *numerator*: a live probe of every sub-space coord's
served catalog DECLARES probeable, returning the same ``DriftVerdict`` envelope
an AI agent would receive (the product goal). The frontend joins the two by
sub-space id.

Read path (vetted): the browser carries an operator Cognito bearer, which we
forward to coord — first to ``GET /coord/twin/catalog`` for the declared list,
then to each declared ``door`` (coord's SSO-gated
``GET /coord/twin/{subspace}/verdict`` routes in ``twin_routes.rs``, or the
admin outbound door). We reuse the exact bearer-forwarding + tenant-resolution
helpers proven in ``operations.py`` so there is one ContextVar and one auth
posture.

Only declared sub-spaces (no required args → a meaningful whole-sub-space
verdict) are live-probed. Every other manifest row (ci/log/ast/type/
origin_resolution, the process + intent rows, …) renders the manifest's static
claim. Where a coord tool answers such a row, the row's ``ask_via`` says where
on the page it can be asked: Ask the Twin, the Delivery tab, or nowhere —
coord withholds the tools of some rows (log, ast, type and origin_resolution
among them) from the device session Ask the Twin runs on.
"""

import asyncio
import math
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
    ACTIVE_TENANT_HEADER,
    _effective_tenant_id,
    _proxy_coord_get,
    _tenant_headers,
    capture_caller_bearer,
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

# The matrix probes exactly what coord DECLARES (plan
# ``2026-10-11-twin-honesty-and-reachability`` Phase 9, design decision D6).
# coord's served catalog (``GET /coord/twin/catalog``, ``twin_probe_door.rs``
# ``served_catalog``) carries, per row, ``snapshot`` (the twin door serves a
# no-argument read for it), ``door`` (the HTTP path that answers it),
# ``door_shape`` (how that answer is laid out) and ``access`` (who may read it).
# Until that plan this module kept a hand copy of coord's snapshot map, which
# drifted from it: a sub-space coord served sat unprobed, and the post-phase-16
# process reads (workers, the merge train, webhooks, the scheduler) and the
# admin outbound door could never become live cells.
#
# A row is probed when coord serves it as a snapshot, OR when its declared door
# is an ``envelope`` door — the admin outbound door
# ``/admin/coord/outbound-budget``, a no-argument read coord deliberately keeps
# off the twin door (D8), so its ``snapshot`` flag is false although a blank GET
# answers it.
_ENVELOPE_DOOR = "envelope"
_REPORT_DOOR = "report"
# coord's twin router (``twin_routes.rs`` ``twin_reads_sso``). Its access
# classes are keyed on the caller's TENANT; every other door may be keyed on
# the operator.
_TWIN_DOOR_PREFIX = "/coord/twin/"

# The last declared probe list a catalog read produced. The catalog is
# fleet-global metadata (the same for every tenant), so one module-level copy
# serves every tenant's degraded matrix: when coord or the catalog cannot be
# read, the matrix degrades to error cells for the ids coord last declared, and
# to an EMPTY degraded matrix when it never declared any — never to an
# invented id list.
_LAST_DECLARED: list[dict[str, Any]] | None = None

# Coverage at/above this counts as a fully-wired observer. Below it (but > 0 and
# not blind) is "partial". Observers routinely report coverage < 1 because a
# slice is unconfigured for this tenant/deploy — that is honest, not broken.
_FULL_COVERAGE_THRESHOLD = 0.99

# Short per-tenant TTL cache over the whole matrix fan-out (the catalog read
# plus every declared probe). The matrix fires one live coord read per declared
# sub-space per load; without this, N dashboard viewers = N× that many
# coord reads. React Query already throttles a single client; this bounds the
# coord load across all viewers of a tenant. Small + in-process (per worker) by
# design — staleness is acceptable for a completeness view.
#
# The key MUST be the EFFECTIVE tenant (the switcher selection when the operator
# is a member of it, else home), never the home tenant, because coord scopes the
# probed verdicts to the selection we forward. Keying on home while forwarding
# the selection would file tenant B's matrix under tenant A and serve it to A —
# a cross-tenant read that outlives the request that caused it.
#
# Only the TWIN-door probes (``/coord/twin/...``) are cached. coord gates those
# per TENANT, so every operator of one effective tenant gets the same answer.
# A door outside the twin router (the admin outbound door) is gated per
# OPERATOR — ``require_role("admin")`` — so its answer is never shared: it is
# probed on every request with that request's own bearer (see
# ``_is_operator_gated``). Caching it would serve one admin's outbound budget to
# a non-admin of the same tenant for the TTL, and a non-admin's refusal to the
# admin.
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


def _class_bucket_age(envelope: dict[str, Any]) -> int | float | None:
    """The age in seconds of the bucket an ``envelope`` door's drift class
    comes from, or ``None`` when that age cannot be known.

    coord's admin outbound door (``OutboundBudgetResponse``,
    ``outbound_budget_read.rs``) has no answer-level age. Each bucket carries
    its own ``staleness_seconds``. ``get_outbound_budget`` sorts the buckets
    worst-first and takes the envelope's ``drift_class`` from the first one.
    So the first bucket's age dates the class, and no other age in the answer
    does. The rule is checked here, not assumed: the age is carried only when
    the first bucket's class IS the envelope's, and only when it is a finite,
    non-negative number of seconds (coord clamps at 0). Anything else serves
    no age, which the page shows as UNKNOWN. That includes an answer with no
    bucket at all (coverage 0, class ``unknown``).
    """
    buckets = envelope.get("buckets")
    if not isinstance(buckets, list) or not buckets:
        return None
    first = buckets[0]
    if not isinstance(first, dict):
        return None
    if first.get("drift_class") != envelope.get("drift_class"):
        return None
    age = first.get("staleness_seconds")
    if isinstance(age, bool) or not isinstance(age, int | float):
        return None
    if not math.isfinite(age) or age < 0:
        return None
    return age


def _envelope_metrics(
    verdict: dict[str, Any], door_shape: str | None
) -> dict[str, Any]:
    """The goal-#3/#4 surface: the credibility/usefulness numbers, verbatim.

    One exception: an ``envelope`` door reports no answer-level
    ``staleness_seconds``. Its ``staleness_seconds`` here is the age of the
    bucket its drift class comes from (``_class_bucket_age``), and the page
    names it as that bucket's age.
    """
    staleness = (
        _class_bucket_age(verdict)
        if door_shape == _ENVELOPE_DOOR
        else verdict.get("staleness_seconds")
    )
    return {
        "coverage": verdict.get("coverage"),
        "credibility": verdict.get("credibility"),
        "posterior": verdict.get("posterior"),
        "staleness_seconds": staleness,
        "provenance": verdict.get("provenance"),
        "drift_class": verdict.get("drift_class"),
    }


def _declared_probes(catalog: Any) -> list[dict[str, Any]] | None:
    """The probe list coord's served catalog declares, or ``None`` when the
    body declares nothing readable.

    One entry per catalog row that is probeable with a blank GET — coord serves
    it as a snapshot (``snapshot: true``), or its door is an ``envelope`` door
    (see ``_ENVELOPE_DOOR``) — carrying ``subspace``, ``door``, ``door_shape``
    and ``access`` verbatim.

    ``None`` (never an empty list) for a body that is not a catalog, and for a
    catalog served by a coord predating the declaration (no row carries a
    ``snapshot`` flag): an empty list would render "coord declares no
    sub-space", which that coord never said.
    """
    if not isinstance(catalog, dict):
        return None
    entries = catalog.get("entries")
    if not isinstance(entries, list):
        return None
    rows = [e for e in entries if isinstance(e, dict)]
    if not any(isinstance(e.get("snapshot"), bool) for e in rows):
        return None
    declared: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in rows:
        subspace = entry.get("subspace")
        door = entry.get("door")
        door_shape = entry.get("door_shape")
        if not isinstance(subspace, str) or not subspace or subspace in seen:
            continue
        if not isinstance(door, str) or not door.startswith("/"):
            continue
        if entry.get("snapshot") is not True and door_shape != _ENVELOPE_DOOR:
            continue
        seen.add(subspace)
        declared.append(
            {
                "subspace": subspace,
                "door": door,
                "door_shape": door_shape if isinstance(door_shape, str) else None,
                "access": entry.get("access"),
            }
        )
    return declared


async def _fetch_declared(
    client: httpx.AsyncClient, headers: dict[str, str]
) -> list[dict[str, Any]] | None:
    """Read coord's served catalog and return its declared probe list.

    Never raises: an unreachable coord, a non-200 answer or an unparseable body
    is ``None``, and the caller degrades the matrix.
    """
    try:
        resp = await client.get(
            f"{settings.COORD_URL}/coord/twin/catalog", headers=headers
        )
    except httpx.HTTPError as exc:  # ConnectError, TimeoutException and friends
        logger.warning("twin_catalog_unreachable", error=str(exc))
        return None
    if resp.status_code != 200:
        logger.warning("twin_catalog_refused", http_status=resp.status_code)
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    return _declared_probes(body)


async def _probe_subspace(
    client: httpx.AsyncClient,
    probe: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any]:
    """Probe one declared sub-space at its declared door, tolerating every
    failure.

    Never raises: a coord error, an unreachable coord, or a tool failure all map
    to an honest cell status rather than aborting the whole matrix. The body is
    read by the catalog's ``door_shape``:

    - ``verdict_wrapper`` — ``{subspace, tool, verdict}``; the DriftVerdict sits
      under ``verdict``.
    - ``envelope`` — the DriftVerdict fields sit at the top level (the admin
      outbound door's ``OutboundBudgetResponse``), graded by the same
      ``_classify``. It has no answer-level age, so its metrics carry the age
      of the bucket its drift class comes from (``_class_bucket_age``).
    - ``report`` — ``{subspace, tool, verdict}`` where ``verdict`` is the tool's
      own report, not a DriftVerdict. It carries no coverage or drift class, so
      it is not graded at all: the cell reads ``served`` ("coord answered, and
      what it answered is not a verdict"), never a ``partial`` made up from a
      missing coverage.
    """
    subspace: str = probe["subspace"]
    door_shape = probe.get("door_shape")
    url = f"{settings.COORD_URL}{probe['door']}"
    try:
        resp = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        return {"id": subspace, "status": "error", "error": "coord_timeout"}
    except httpx.HTTPError as exc:  # ConnectError and friends
        logger.warning("twin_probe_unreachable", subspace=subspace, error=str(exc))
        return {"id": subspace, "status": "error", "error": "coord_unreachable"}

    if resp.status_code == 403:
        # An access decision for THIS sub-space: coord's per-sub-space class
        # (a Qontinui-internal infra verdict read by another tenant), the coarse
        # twin tenant gate, or the admin gate on the outbound door. It marks
        # only this cell; the matrix-level `restricted` flag is set only when
        # every probe answered this way.
        return {"id": subspace, "status": "restricted", "door_shape": door_shape}
    if resp.status_code == 404:
        # coord declared a door that does not answer — coord's catalog and its
        # router disagree. The page renders it as an error, never a silent ok.
        return {"id": subspace, "status": "no_snapshot_tool", "door_shape": door_shape}
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
            "door_shape": door_shape,
        }

    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        return {
            "id": subspace,
            "status": "error",
            "error": "malformed_verdict",
            "door_shape": door_shape,
        }

    verdict: Any = body if door_shape == _ENVELOPE_DOOR else body.get("verdict")
    if not isinstance(verdict, dict):
        return {
            "id": subspace,
            "status": "error",
            "error": "malformed_verdict",
            "door_shape": door_shape,
        }

    if door_shape == _REPORT_DOOR:
        return {
            "id": subspace,
            "status": "served",
            "tool": body.get("tool"),
            "door_shape": door_shape,
        }
    return {
        "id": subspace,
        "status": _classify(verdict),
        "tool": body.get("tool"),
        "metrics": _envelope_metrics(verdict, door_shape),
        "door_shape": door_shape,
    }


def _is_operator_gated(probe: dict[str, Any]) -> bool:
    """Whether a declared door may answer per OPERATOR rather than per tenant.
    Such a probe is never cached (see ``_MATRIX_CACHE``).

    Either condition makes it so:

    - coord's own declaration: ``access`` is ``null`` exactly for a door the
      twin router does not serve (its access classes are all tenant-keyed), so
      the door's own gate — ``require_role("admin")`` on the outbound door —
      governs it;
    - the path: any door outside the twin router, so a future per-operator door
      coord forgets to declare ``access: null`` for is still never cached.
    """
    return probe.get("access") is None or not str(probe["door"]).startswith(
        _TWIN_DOOR_PREFIX
    )


def _degraded_matrix(reason: str) -> dict[str, Any]:
    """The matrix returned (HTTP 200) when coord, the tenant or coord's catalog
    cannot be read — honest degradation, never a 5xx. The page must not
    hard-fail when coord is down, and the Spec CI crawl gate flags a new route
    that 5xx's.

    Its cells are the ids coord LAST declared (``_LAST_DECLARED``), each an
    ``error`` carrying ``reason``. With no declaration ever read in this
    process, it is an empty matrix flagged ``degraded`` — the page then shows
    every manifest row's own status, and no sub-space id is invented here.
    """
    declared = _LAST_DECLARED or []
    return {
        "subspaces": [
            {"id": p["subspace"], "status": "error", "error": reason} for p in declared
        ],
        "probed": len(declared),
        "degraded": True,
    }


@router.get("/subspaces")
async def get_twin_subspaces(
    request: Request,
    _user=Depends(get_current_active_user_async),
) -> Any:
    """Live numerator for the completeness matrix: a per-sub-space probe of
    every sub-space coord's served catalog declares probeable.

    Per-tenant: the tenant is resolved best-effort (and the caller's Cognito
    bearer **plus their tenant-switcher selection** captured for forwarding).
    The matrix reflects what coord can observe for *their* tenant — flag-gated
    / tenant-scoped observers legitimately read ``blind`` for some tenants, and
    a Qontinui-internal sub-space reads ``restricted`` for another tenant. If
    coord, the tenant or the catalog is unavailable we DEGRADE (HTTP 200, see
    ``_degraded_matrix``), never 5xx.

    Tenant selection (plan
    ``2026-08-28-tenant-creation-followup-defects-from-the-preemptive-sweep``
    Phase 3). This route captures the caller's context INLINE rather than via
    ``Depends(get_tenant_id)`` like its siblings, and used to set only
    ``_caller_bearer`` — so ``_tenant_headers`` found ``_caller_active_tenant``
    at its ``None`` default and dropped ``X-Qontinui-Active-Tenant``, silently
    serving a tenant-switched operator their HOME tenant's matrix. It now calls
    the same ``capture_caller_bearer`` the siblings reach through, which sets
    both.

    Forwarding the header alone would be worse than the bug: the fan-out result
    is cached, so a matrix coord scoped to the SELECTED tenant would land under
    the HOME tenant's key and later be served to a request that selected home —
    a cached cross-tenant read. The cache is therefore keyed on the EFFECTIVE
    tenant (``_effective_tenant_id``: the selection when the operator is a
    member of it, else home — mirroring coord's own
    ``apply_active_tenant_override``, which degrades a non-member selection to
    home rather than widening).
    """
    global _LAST_DECLARED

    active_tenant = request.headers.get(ACTIVE_TENANT_HEADER)
    capture_caller_bearer(request)
    tenant_id: UUID | None = None
    effective_id: UUID | None = None
    try:
        identity = await get_coord_identity(request)
        tenant_id = identity.home_tenant_id
        effective_id = _effective_tenant_id(identity, active_tenant)
    except Exception:  # coord unreachable / unresolvable — degrade, don't 5xx
        tenant_id = None
        effective_id = None
    if tenant_id is None or effective_id is None:
        return _degraded_matrix("coord_unavailable")

    cache_key = str(effective_id)
    now = time.monotonic()
    headers = _tenant_headers(effective_id)
    async with httpx.AsyncClient(timeout=_TWIN_PROBE_TIMEOUT) as client:
        cached = _MATRIX_CACHE.get(cache_key)
        if cached is not None and now - cached[0] < _MATRIX_CACHE_TTL_S:
            declared, shared = cached[1]
            # Operator-gated doors: this request's own answer, never the cache's.
            own_results = await asyncio.gather(
                *(
                    _probe_subspace(client, p, headers)
                    for p in declared
                    if _is_operator_gated(p)
                )
            )
        else:
            fetched = await _fetch_declared(client, headers)
            if fetched is None:
                # Not cached: the next request retries the catalog rather than
                # serving a degraded matrix for the whole TTL.
                return _degraded_matrix("catalog_unavailable")
            declared = fetched
            # One concurrent fan-out; the results are split afterwards into the
            # shared (cached) half and this request's own operator-gated half.
            fanned = await asyncio.gather(
                *(_probe_subspace(client, p, headers) for p in declared)
            )
            shared = {
                r["id"]: r
                for p, r in zip(declared, fanned, strict=True)
                if not _is_operator_gated(p)
            }
            own_results = [
                r
                for p, r in zip(declared, fanned, strict=True)
                if _is_operator_gated(p)
            ]
            _MATRIX_CACHE[cache_key] = (now, (declared, shared))
            _LAST_DECLARED = declared
    own = {r["id"]: r for r in own_results}
    results = [
        own[p["subspace"]] if _is_operator_gated(p) else shared[p["subspace"]]
        for p in declared
    ]
    # The matrix-level `restricted` flag means the coarse gate is armed against
    # this operator: EVERY probe was refused. A single refused sub-space (a
    # Qontinui-internal verdict read by another tenant, or the admin-gated
    # outbound door read by a non-admin) marks only its own cell, so an
    # operator keeps their own `memory` and `worktree` cells beside it.
    restricted = bool(results) and all(r.get("status") == "restricted" for r in results)
    return {
        "subspaces": results,
        "probed": len(results),
        "restricted": restricted,
    }


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


def _empty_twin_catalog(detail: str) -> dict[str, Any]:
    """A valid (empty) twin-catalog envelope annotated with ``coord_error``.

    Shape matches coord's ``{entries, total}`` contract so the frontend types
    stay valid; ``coord_error`` (an optional field ``TwinCatalog`` surfaces as
    a "coord is unavailable" panel) explains why the catalog is empty.

    A named module-level helper rather than an inline literal so it is
    importable — ``tests/test_coord_down_envelope_contract.py`` pins it against
    ``TwinCatalogResponse`` the same way ``_empty_overview`` / ``_empty_prs``
    are pinned. ``total`` in particular is rendered *outside* the
    ``coord_error`` branch (``TwinCatalog.tsx:34``), so dropping it prints
    "undefined observers" right above the outage notice.
    """
    return {"entries": [], "total": 0, "coord_error": detail}


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
            return _empty_twin_catalog(detail)
        raise


@router.get("/delivery/verdict")
async def get_delivery_verdict(
    work_unit_slug: str | None = None,
    repo: str | None = None,
    pr: int | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Delivery verdict for one work unit — "has this work unit/PR landed?".

    The *parameterized* twin read (Phase 5 of plan
    ``2026-06-15-twin-delivery-verdict-completion-view``). Unlike the snapshot
    matrix, delivery needs an argument (``work_unit_slug``, or ``repo``+``pr``),
    so it is a distinct on-demand route rather than a matrix cell. It proxies
    coord's SSO-gated ``GET /coord/twin/delivery/verdict`` (``twin_routes.rs``),
    which dispatches the SAME ``coord_query_delivery`` MCP tool an agent calls —
    with ``force_refresh=true`` server-side — so the dashboard answer is
    byte-identical to (and as fresh as) what an agent would receive: work-unit
    lifecycle status ⋈ per-PR merge state ⋈ best-effort deploy state, with
    provenance + staleness.

    The slug parameter was spelled ``plan_slug`` on both this route and coord's
    until Phase 3 of plan
    ``2026-07-30-coord-web-plan-slug-wire-key-retirement``. Coord dual-accepts
    both spellings during the retirement window and drops ``plan_slug`` in
    Phase 4, so this proxy forwards only the canonical key.

    Validates the parameter set locally (mirroring coord) to avoid a wasted
    round-trip; coord's own 4xx/5xx (e.g. a tool failure → 502) still surface via
    :func:`_proxy_coord_get`.
    """
    has_slug = bool(work_unit_slug and work_unit_slug.strip())
    has_repo_pr = bool(repo and repo.strip()) and pr is not None
    if not has_slug and not has_repo_pr:
        raise HTTPException(
            status_code=400,
            detail="work_unit_slug (or repo+pr) is required",
        )

    params: dict[str, Any] = {}
    if has_slug:
        params["work_unit_slug"] = work_unit_slug.strip()  # type: ignore[union-attr]
    if repo and repo.strip():
        params["repo"] = repo.strip()
    if pr is not None:
        params["pr"] = pr

    return await _proxy_coord_get(
        "/coord/twin/delivery/verdict", params=params, tenant_id=tenant_id
    )
