"""
Operations API — Fleet & cross-machine monitoring.

Renamed from ``dev_dashboard.py``. The route prefix moves from
``/dev-dashboard`` to ``/operations`` and the endpoints become
user-authenticated (premium-feature material). The `runners` list now
uses the canonical `Runner` wire shape (``derived_status``, etc.) so
consumers don't need a separate mental model for fleet vs runners.

Note: the ``/operations/heartbeat`` and ``/operations/claude-sessions``
ingestion endpoints stay unauthenticated (LAN-only) — they are the
cross-machine beacon path. Phase 5 cleanup may collapse them into the
new ``runners`` table.
"""

from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.devices import _device_to_wire as _runner_to_wire
from app.core.config import settings
from app.crud import runner_crud
from app.models.user import User as UserModel
from app.schemas.dev_dashboard import (
    AggregatedTaskRuns,
    ClaudeSessionReport,
    RegisteredRunner,
    RunnerHeartbeat,
    RunnerTaskRun,
)
from app.services.coord_operator_resolver import resolve_tenant_for_user
from app.services.dev_dashboard_service import get_fleet_registry

# Timeout for coord proxy reads. The merge queue is a small JSON payload
# served from PG; if coord takes longer than 5s something is wrong.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Header coord uses to scope every SQL query on the dashboard's data
# tables (coord.plans, coord.agent_*, coord.memories, coord.primary_trees,
# coord.agent_worktrees). Coord-side enforcement lives in
# `qontinui-coord/src/tenant_scope.rs`. Failing closed: web rejects
# the request with 403 ``tenant_not_resolved`` before it ever hits coord.
TENANT_HEADER = "X-Qontinui-Tenant-Id"

logger = structlog.get_logger(__name__)
router = APIRouter()


# ---- Tenant resolution dependency ---------------------------------------
#
# Every dashboard endpoint that proxies to coord depends on this. It
# replaces the old ``require_admin`` posture — instead of "must be a
# superuser," the new rule is "any authenticated user, scoped to their
# resolved tenant." The dependency resolves the user → operator →
# tenant_id chain and returns the UUID; handlers forward it as the
# ``X-Qontinui-Tenant-Id`` header on the underlying coord call.
#
# The operator-management surfaces (``/admin/coord/operators/*``,
# ``/admin/coord/audit/*``) — when they land — will stay
# `require_role("admin")`-gated, not this dependency. They live in a
# different file and aren't part of the operations dashboard.


async def get_tenant_id(
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> UUID:
    """Dependency: resolve the current user's tenant_id (UUID).

    See ``app.services.coord_operator_resolver`` for the resolution
    policy. Raises 403 ``tenant_not_resolved`` if the user isn't linked
    to a coord operator row (and the bootstrap fallback also misses).
    """
    return await resolve_tenant_for_user(current_user, db)


def _tenant_headers(tenant_id: UUID) -> dict[str, str]:
    """Build the request-headers dict carrying the tenant scope.

    Centralised so adding a future header (e.g. ``X-Qontinui-Operator-Id``
    for audit-log stamping) is a one-line change.
    """
    return {TENANT_HEADER: str(tenant_id)}


# ---- Cross-machine beacon (unauth, LAN-only — kept verbatim) -------------


@router.post("/heartbeat", response_model=RegisteredRunner)
async def runner_heartbeat(heartbeat: RunnerHeartbeat) -> RegisteredRunner:
    """Receive heartbeat from a runner (cross-machine beacon)."""
    registry = get_fleet_registry()
    runner = await registry.register_heartbeat(heartbeat)
    logger.debug(
        "runner_heartbeat",
        runner_id=runner.id,
        tasks=runner.running_task_count,
    )
    return runner


@router.post("/claude-sessions")
async def report_claude_sessions(report: ClaudeSessionReport) -> dict:
    """Receive Claude Code session report from a machine."""
    registry = get_fleet_registry()
    await registry.report_claude_sessions(report)
    return {
        "status": "ok",
        "hostname": report.hostname,
        "session_count": len(report.sessions),
    }


# ---- Operations dashboard endpoints (auth, user-scoped) ------------------


@router.get("/fleet")
async def get_fleet_status(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict[str, Any]:
    """Return the user's fleet (runners + cross-machine Claude sessions).

    Response shape:
        ``{ "runners": list[Runner], "claude_sessions": dict[hostname, list[ClaudeSession]] }``

    The ``runners`` list uses the canonical wire shape (with
    ``derived_status``, ``ws_connected``, ...). The ``claude_sessions``
    section comes from the in-memory cross-machine fleet registry.
    """
    runners = await runner_crud.list_runners(db, current_user.id)
    wire_runners = [_runner_to_wire(r).model_dump(mode="json") for r in runners]

    registry = get_fleet_registry()
    fleet_status = await registry.get_fleet_status()

    return {
        "runners": wire_runners,
        "claude_sessions": {
            hostname: [s.model_dump(mode="json") for s in sessions]
            for hostname, sessions in fleet_status.claude_sessions.items()
        },
        "total_claude_sessions": fleet_status.total_claude_sessions,
    }


@router.get("/fleet/tasks", response_model=AggregatedTaskRuns)
async def get_all_tasks(
    *,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> AggregatedTaskRuns:
    """Get all running tasks across all runners (cross-machine beacon)."""
    registry = get_fleet_registry()
    tasks = await registry.get_all_running_tasks()
    return AggregatedTaskRuns(
        task_runs=[RunnerTaskRun(**t) for t in tasks],
        total=len(tasks),
    )


@router.get("/fleet/runners/{runner_id}/output")
async def get_runner_task_output(
    runner_id: str,
    task_run_id: str = Query(...),
    tail_chars: int = Query(default=5000),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict:
    """Proxy to a specific runner to get task output."""
    registry = get_fleet_registry()
    result = await registry.proxy_runner_request(
        runner_id,
        f"/task-runs/{task_run_id}/output",
        params={"tail_chars": tail_chars},
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Runner {runner_id} not found or unreachable",
        )
    return dict(result)


@router.get("/fleet/runners/{runner_id}/workflow-state")
async def get_runner_workflow_state(
    runner_id: str,
    task_run_id: str = Query(...),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict:
    """Proxy to a specific runner to get workflow state."""
    registry = get_fleet_registry()
    result = await registry.proxy_runner_request(
        runner_id,
        f"/task-runs/{task_run_id}/workflow-state",
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Runner {runner_id} not found or unreachable",
        )
    return dict(result)


@router.delete("/fleet/runners/{runner_id}")
async def remove_runner(
    runner_id: str,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict:
    """Manually remove a runner from the cross-machine beacon registry."""
    registry = get_fleet_registry()
    removed = await registry.remove_runner(runner_id)
    if not removed:
        raise HTTPException(
            status_code=404,
            detail=f"Runner {runner_id} not found",
        )
    return {"status": "removed", "runner_id": runner_id}


# ---- Coord merge-queue proxy (operations dashboard) ----------------------
#
# The Next.js frontend at `demo.staging.qontinui.io` (and any future
# staging subdomain) renders the merge-train section on /operations.
# Coord lives at a different origin and has no CORS layer, so the
# browser can't reach coord directly. These endpoints proxy
# read-only merge state through the web backend, which already shares
# the user's auth context. No mutating coord routes are exposed —
# proposal creation / cancellation / land still go agent → coord
# directly, which is the right boundary.
#
# Per plans/2026-05-18-coordination-layer-demos.md §5.2.1.


async def _proxy_coord_get(
    path: str,
    *,
    params: dict[str, Any] | None = None,
    tenant_id: UUID | None = None,
) -> Any:
    """Proxy a GET request to coord and return the JSON body.

    ``params`` is forwarded as the query string when set — the merge
    queue endpoint takes none, but the claims dashboard endpoints
    (Phase 5 of plan 2026-05-18-agent-spawn-coordination.md) take
    ``kind``, ``prefix``, ``limit``, ``since`` filters.

    ``tenant_id`` — when set, the ``X-Qontinui-Tenant-Id`` header is
    injected so coord can scope every SQL query on the dashboard's
    data tables. Fleet-wide / staff-only endpoints (``/merge/queue``,
    ``/claims/*``) leave it ``None``; those callers are coord-staff
    only and intentionally tenant-blind in the pilot.
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.get("/merge/queue")
async def get_merge_queue(
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return the in-flight merge proposals from coord."""
    return await _proxy_coord_get("/merge/queue")


@router.get("/merge/{proposal_id}")
async def get_merge_proposal(
    proposal_id: str,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return a single merge proposal's detail from coord."""
    return await _proxy_coord_get(f"/merge/{proposal_id}")


@router.get("/pr-merge/prs")
async def get_pr_merge_prs(
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """PR Merge Orchestrator Phase 1 D1.6 + D1.7 -- proxy coord's
    ``GET /pr-merge/prs`` (read-only list of all open PRs joined to
    per-(repo, head_sha) CI lifecycle).

    Anonymous in the pilot, mirroring ``/merge/queue`` per coord's
    routes.rs comment ("§4.5 anonymous in the pilot"). The web side
    still requires an authenticated dashboard user; coord-side
    tenant scoping arrives in Phase 2.
    """
    return await _proxy_coord_get("/pr-merge/prs")


# ---- PR Merge Orchestrator Phase 2 D2.4 — per-tenant settings ------------
#
# Five endpoints, each tenant-scoped via ``get_tenant_id``. The
# ``X-Qontinui-Tenant-Id`` header propagates to coord; the coord-side
# TenantId extractor (``src/tenant_scope.rs``) parses it into a UUID
# and feeds every SELECT/UPDATE in ``src/pr_merge/settings_routes.rs``.
#
# Coord-side endpoints are anonymous (pilot posture, same as
# ``/pr-merge/prs``); the web side enforces authentication +
# tenant resolution before forwarding.


async def _proxy_coord_patch(
    path: str,
    body: Any,
    *,
    tenant_id: UUID | None = None,
) -> Any:
    """Proxy a PATCH request to coord. Returns the JSON body.

    Used by the PR Merge Orchestrator Phase 2 settings endpoints
    (``PATCH /pr-merge/settings`` + ``PATCH /pr-merge/repos/:repo/profile``).
    Same posture as ``_proxy_coord_post`` — tenant header,
    timeout/connect-error mapping. Sticking to the existing httpx
    pattern keeps the proxy footprint minimal.
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.patch(url, json=body, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.get("/pr-merge/settings")
async def get_pr_merge_settings(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Tenant-scoped read of the per-tenant merge settings. Returns the
    resolved EffectiveProfile (global → tenant tier, no per-repo
    overrides applied)."""
    return await _proxy_coord_get("/pr-merge/settings", tenant_id=tenant_id)


@router.patch("/pr-merge/settings")
async def patch_pr_merge_settings(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """UPSERT the tenant-level merge settings. Coord audits the change
    + publishes a Redis pubsub invalidation. Returns the post-write
    EffectiveProfile."""
    return await _proxy_coord_patch(
        "/pr-merge/settings", body, tenant_id=tenant_id
    )


@router.get("/pr-merge/repos")
async def get_pr_merge_repos(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List the tenant's repos with framework-signal chips +
    profile_source provenance. Drives the per-repo override-card list
    on the Merge Orchestration → Settings page."""
    return await _proxy_coord_get("/pr-merge/repos", tenant_id=tenant_id)


@router.get("/pr-merge/repos/{repo:path}/profile")
async def get_pr_merge_repo_profile(
    repo: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Resolved per-(tenant, repo) settings — three-tier
    (global → tenant → repo) layered. The ``repo`` is the
    ``owner/name`` form; the ``:path`` converter lets FastAPI accept
    the ``/`` inline without URL-encoding."""
    return await _proxy_coord_get(
        f"/pr-merge/repos/{repo}/profile", tenant_id=tenant_id
    )


@router.patch("/pr-merge/repos/{repo:path}/profile")
async def patch_pr_merge_repo_profile(
    repo: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """UPSERT the per-repo override row. Coord stamps
    ``profile_source='user_edit'``, audits the change, and publishes
    invalidation. Returns the post-write EffectiveProfile."""
    return await _proxy_coord_patch(
        f"/pr-merge/repos/{repo}/profile", body, tenant_id=tenant_id
    )


async def _proxy_coord_post(
    path: str,
    body: Any,
    *,
    tenant_id: UUID | None = None,
) -> Any:
    """Proxy a POST request to coord and return the JSON body.

    ``tenant_id`` — see ``_proxy_coord_get``.
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.post(url, json=body, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.post("/agents/allocate")
async def post_agents_allocate(
    body: dict[str, Any],
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Proxy `POST /agents/allocate` to coord.

    Used by the demo-control page (§5.2.3 of the coordination-layer
    demo plan) to spawn agents on PC + MSI with one click. Body
    shape matches coord's `AllocateRequest` (machine_id, repos,
    optional intent). Coord's response — including the agent's JWT
    — passes through; the operator's browser doesn't consume the
    JWT itself, but the receiving runner picks up the allocation
    via the `events.agent.allocated` event coord fans out.
    """
    return await _proxy_coord_post("/agents/allocate", body)


# ---- Coord claims-dashboard proxy ---------------------------------------
#
# Plan `2026-05-18-agent-spawn-coordination.md` Phase 5 — the
# `/admin/agent-claims` dashboard backend. Five read-only proxy
# endpoints that forward to coord:
#
# - `/operations/claims/list`             → coord `/coord/claims/list`
# - `/operations/claims/recent-conflicts` → coord `/coord/claims/recent-conflicts`
# - `/operations/claims/recent-expirations` → coord `/coord/claims/recent-expirations`
# - `/operations/claims/steals`           → coord `/coord/claims/steals`
# - `/operations/claims/alerts`           → coord `/coord/alerts` (filtered)
#
# Same proxy posture as the merge endpoints above — read-only, no
# mutating coord routes exposed through this surface. Steal +
# acquire stay agent → coord directly (correct auth boundary).


@router.get("/claims/list")
async def get_claims_list(
    kind: str,
    prefix: str = "",
    limit: int | None = None,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """List active claims by kind + resource_key prefix."""
    params: dict[str, Any] = {"kind": kind, "prefix": prefix}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get("/coord/claims/list", params=params)


@router.get("/claims/recent-conflicts")
async def get_recent_conflicts(
    limit: int | None = None,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return the recent-conflicts ring buffer from coord."""
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get("/coord/claims/recent-conflicts", params=params)


@router.get("/claims/recent-expirations")
async def get_recent_expirations(
    limit: int | None = None,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return the recent-expirations ring buffer from coord."""
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get("/coord/claims/recent-expirations", params=params)


@router.get("/claims/steals")
async def get_claims_steals(
    since: str | None = None,
    limit: int | None = None,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return recent admin_stolen audit rows from coord."""
    params: dict[str, Any] = {}
    if since is not None:
        params["since"] = since
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get("/coord/claims/steals", params=params)


@router.get("/claims/alerts")
async def get_claims_alerts(
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return active claim-related alerts from coord.

    Filters the coord ``/coord/alerts`` response to rows whose
    ``alert_key`` starts with ``claim-`` (the convention used by
    [`claims_alert_watcher`](https://github.com/qontinui/qontinui-coord/blob/main/src/claims_alert_watcher.rs)).
    Other alert kinds (fleet-health, alembic-status, etc.) stay scoped
    to the Operations page's general alerts surface.
    """
    payload = await _proxy_coord_get("/coord/alerts")
    # coord returns either a list or `{"alerts": [...]}` depending on
    # the version; tolerate both.
    if isinstance(payload, dict) and "alerts" in payload:
        rows = payload["alerts"]
        is_dict = True
    elif isinstance(payload, list):
        rows = payload
        is_dict = False
    else:
        return payload
    filtered = [
        a
        for a in rows
        if isinstance(a, dict) and str(a.get("alert_key", "")).startswith("claim-")
    ]
    if is_dict:
        return {"alerts": filtered}
    return filtered


# ---- Coord readiness dashboard proxy (Wave 2 — tenant-scoped) ------------
#
# Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 2. Adds
# the browser-side operator console at ``/admin/coord/*``. ALL endpoints
# in this section are tenant-scoped via ``get_tenant_id`` (resolves
# the current user's coord operator row → home tenant_id, injects
# ``X-Qontinui-Tenant-Id`` on the coord call so coord-side handlers
# filter every SQL query). Replaces the prior ``require_admin`` gate;
# the dashboard is now usable by any authenticated qontinui user against
# their own tenant. The operator-management surfaces (when they land at
# ``/admin/coord/operators/*`` + ``/admin/coord/audit/*``) keep a separate
# admin-role gate — they're qontinui-staff fleet-wide views, not the
# user-scoped dashboard.
#
# Routes (read-only unless noted):
#
# - GET    /operations/plans                            — list coord.plans
# - GET    /operations/plans/{slug}                      — single plan
# - GET    /operations/plans/{slug}/history              — status history
# - POST   /operations/plans/{slug}/transition           — set plan status
# - GET    /operations/trees/by-device/{device_id}       — primary trees
# - GET    /operations/trees/contention                  — overlap view
# - GET    /operations/alerts                            — full alert rollup
# - GET    /operations/fleet/health                      — fleet rollup
# - GET    /operations/agent-questions/pending           — Wave-3 prep
# - GET    /operations/agent-questions/{id}              — Wave-3a single lookup
# - GET    /operations/agent-questions/by-session/{sid}  — Wave-3a by-session
# - POST   /operations/agent-questions/{id}/respond      — Wave-3 prep
# - GET    /operations/agent-logs/by-agent/{agent_id}    — Wave-3 prep
# - GET    /operations/agent-logs/by-session/{session_id} — Wave 3b
# - GET    /operations/agent-logs/recent                 — Wave 3b
# - GET    /operations/memory/list                       — Wave-3 prep
# - GET    /operations/memory/{name}                     — Wave-3 prep
# - GET    /operations/memory/{name}/version/{version}    — Wave-3c
# - POST   /operations/memory/upsert                      — Wave-3c
# - DELETE /operations/memory/{name}                      — Wave-3c (soft-delete)
# - POST   /operations/memory/{name}/restore              — Wave-3c


# ---- Plans (Phase 2 substrate — coord.plans is canonical per Q7) --------


@router.get("/plans")
async def list_coord_plans(
    status: str | None = Query(default=None, description="Filter by status."),
    limit: int | None = Query(default=None, ge=1, le=500),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List entries from ``coord.plans`` via coord (tenant-scoped)."""
    params: dict[str, Any] = {}
    if status is not None:
        params["status"] = status
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/plans", params=params or None, tenant_id=tenant_id
    )


@router.get("/plans/{slug}")
async def get_coord_plan(
    slug: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single plan from ``coord.plans`` (tenant-scoped)."""
    return await _proxy_coord_get(f"/coord/plans/{slug}", tenant_id=tenant_id)


@router.get("/plans/{slug}/history")
async def get_coord_plan_history(
    slug: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the status history timeline for a plan (tenant-scoped)."""
    return await _proxy_coord_get(f"/coord/plans/{slug}/history", tenant_id=tenant_id)


@router.post("/plans/{slug}/transition")
async def post_coord_plan_transition(
    slug: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Transition a plan to a new status (tenant-scoped).

    Body shape (coord): ``{"status": "<new_status>", "note": "<optional>"}``.
    Audit trail lives in ``coord.plan_status_history``.
    """
    return await _proxy_coord_post(
        f"/coord/plans/{slug}/transition", body, tenant_id=tenant_id
    )


# ---- Primary trees (Phase 1 substrate) -----------------------------------


@router.get("/trees/by-device/{device_id}")
async def get_trees_by_device(
    device_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return primary-tree rows for a device (tenant-scoped)."""
    return await _proxy_coord_get(
        f"/coord/trees/by-device/{device_id}", tenant_id=tenant_id
    )


@router.get("/trees/contention")
async def get_trees_contention(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return primary-tree contention view across the fleet (tenant-scoped)."""
    return await _proxy_coord_get("/coord/trees/contention", tenant_id=tenant_id)


# ---- Alerts (full rollup; sibling of /claims/alerts) ---------------------


@router.get("/alerts")
async def get_coord_alerts(
    include_resolved: bool = Query(default=False),
    severity: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the full ``coord.alerts`` rollup with optional filters.

    Sibling of ``/operations/claims/alerts`` (which filters to
    ``alert_key`` prefix ``claim-``). This endpoint exposes ALL alert
    kinds (claim / conflict / stale_wip / health) for the dashboard's
    Alerts page. Tenant-scoped — the underlying ``coord.alerts`` rollup
    is fleet-wide today but the tenant header lets coord-side enforcement
    filter once the alert producer stamps a tenant_id per row.
    """
    params: dict[str, Any] = {"include_resolved": include_resolved}
    if severity is not None:
        params["severity"] = severity
    if kind is not None:
        params["kind"] = kind
    return await _proxy_coord_get("/coord/alerts", params=params, tenant_id=tenant_id)


# ---- Fleet health --------------------------------------------------------


@router.get("/fleet/health")
async def get_fleet_health(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the fleet-health rollup from coord (tenant-scoped)."""
    return await _proxy_coord_get("/coord/fleet/health", tenant_id=tenant_id)


# ---- Wave-3 prep (decision queue + agent-logs + memory) ------------------
#
# These endpoints are added now so the Wave-3 frontend (decision queue
# inbox, per-agent log tail, memory browser) doesn't need to re-touch
# operations.py. Backed by the Phase 3/5/6 coord routes — the substrate
# is shipped; the operator UI for them lands in Wave-3.


@router.get("/agent-questions/pending")
async def get_pending_agent_questions(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return pending agent questions awaiting an operator response."""
    return await _proxy_coord_get("/coord/agent-questions/pending", tenant_id=tenant_id)


@router.get("/agent-questions/answered")
async def get_answered_agent_questions(
    limit: int | None = Query(default=None, ge=1, le=500),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return recently-answered agent questions.

    Wave 3a — surfaces the "answered" tab on the questions inbox so
    operators can audit prior decisions without leaving the page.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/agent-questions/answered",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/agent-questions/by-session/{session_id}")
async def get_agent_questions_by_session(
    session_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return all questions tied to a single ``agent_session_id``.

    Cross-link target from ``/admin/agent-sessions/{session_id}``. Returns
    pending + answered rows so the session-lineage view can show the
    operator-decision arm in line with the other UNION arms.
    """
    return await _proxy_coord_get(
        f"/coord/agent-questions/by-session/{session_id}", tenant_id=tenant_id
    )


@router.get("/agent-questions/{question_id}")
async def get_agent_question(
    question_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single agent-question row (pending or answered).

    Backs the ``/admin/coord/questions/[id]`` detail page so the operator
    can render the full question + context + options without first
    fetching the pending list.
    """
    return await _proxy_coord_get(
        f"/coord/agent-questions/{question_id}", tenant_id=tenant_id
    )


@router.post("/agent-questions/{question_id}/respond")
async def post_agent_question_response(
    question_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Operator answers an agent question."""
    return await _proxy_coord_post(
        f"/coord/agent-questions/{question_id}/respond",
        body,
        tenant_id=tenant_id,
    )


@router.get("/agent-logs/by-agent/{agent_id}")
async def get_agent_logs_by_agent(
    agent_id: str,
    limit: int | None = Query(default=None, ge=1, le=2000),
    since: str | None = Query(default=None),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return ``coord.agent_logs`` rows for a single agent_id."""
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if since is not None:
        params["since"] = since
    return await _proxy_coord_get(
        f"/coord/agent-logs/by-agent/{agent_id}",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/agent-logs/by-session/{session_id}")
async def get_agent_logs_by_session(
    session_id: str,
    limit: int | None = Query(default=None, ge=1, le=2000),
    since: str | None = Query(default=None),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return ``coord.agent_logs`` rows for a single agent_session_id.

    Wave 3b — backs the per-agent live view's cross-link to the
    session-lineage page. Coord routes the request to its
    ``/coord/agent-logs/by-session/{session_id}`` handler, which selects
    on the ``agent_session_id`` column rather than ``agent_id``.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if since is not None:
        params["since"] = since
    return await _proxy_coord_get(
        f"/coord/agent-logs/by-session/{session_id}",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/agent-logs/recent")
async def get_agent_logs_recent(
    limit: int | None = Query(default=None, ge=1, le=2000),
    since: str | None = Query(default=None),
    level: str | None = Query(default=None, description="Filter by min level."),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the fleet-wide recent agent_logs timeline.

    Wave 3b — backs the ``/admin/coord/agents`` landing timeline.
    Optional ``level`` filters to a minimum severity (trace/debug/info/
    warn/error). Coord owns the ordering + level-rollup semantics; this
    endpoint is a transparent proxy.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if since is not None:
        params["since"] = since
    if level is not None:
        params["level"] = level
    return await _proxy_coord_get(
        "/coord/agent-logs/recent",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/memory/list")
async def get_memory_list(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List entries from the canonical memory substrate."""
    return await _proxy_coord_get("/coord/memory/list", tenant_id=tenant_id)


@router.get("/memory/{name}")
async def get_memory_entry(
    name: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single memory entry (latest version) by name."""
    return await _proxy_coord_get(f"/coord/memory/{name}", tenant_id=tenant_id)


# ---- Wave 4 — Spawn-from-Plan ---------------------------------------------
#
# Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 4 (Wave 4).
# The operator authoring path: pick a plan + phase, pick a device, pick
# repos + intent + declared_overlap_paths, write an initial prompt, hit
# Submit. Coord owns claim acquisition + agent allocation + first-tick
# prompt delivery; this surface is a thin proxy.
#
# Sibling of ``POST /agents/allocate`` (Wave 0 demo-control path). The
# spawn route is admin-gated because it mints a coord agent and pins
# device state; allocate stays user-auth (legacy demo entrypoint).
#
# Wire shape (request):
#   ``{ "plan_slug": str, "plan_phase": str, "device_id": str,
#       "repos": list[str], "intent": str,
#       "declared_overlap_paths": list[str] | None,
#       "initial_prompt": str }``
#
# Wire shape (response): coord's spawn payload passes through — at
# minimum ``{ "agent_id": str, "agent_session_id": str, ...}``.


@router.post("/agents/spawn")
async def post_agents_spawn(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Proxy ``POST /agents/spawn`` to coord (Wave 4 spawn-from-plan).

    Operator-driven spawn from the ``/admin/coord/spawn`` page. Coord
    handles claim acquisition, device pinning, agent JWT mint, and
    first-tick initial-prompt delivery. The browser doesn't consume
    the agent JWT directly — the receiving runner picks up the new
    agent through the ``events.agent.spawned`` event coord publishes.
    """
    return await _proxy_coord_post("/agents/spawn", body, tenant_id=tenant_id)


@router.get("/agents/{agent_id}")
async def get_agent(
    agent_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single spawned agent's status row from coord.

    Backs the spawn-confirmation surface so the operator can see
    "spawn succeeded; agent X is now allocated to device Y" without
    leaving the page. Read-only — mutating routes (steal, kill, ...)
    stay agent→coord direct.
    """
    return await _proxy_coord_get(f"/agents/{agent_id}", tenant_id=tenant_id)


# ---- Wave-3c memory browser (mutation surface) ---------------------------
#
# Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 6.
# Resolved decision Q3 — event-sourced LWW with full version history.
# Resolved decision Q8 — dual-write + 30-day reversible window
# (coord is the canonical store, per-machine FS is the backup).
#
# All endpoints below mutate or read historical memory state and are
# admin-gated.


async def _proxy_coord_delete(
    path: str,
    *,
    tenant_id: UUID | None = None,
) -> Any:
    """Proxy a DELETE request to coord and return the JSON body.

    Mirrors ``_proxy_coord_get`` / ``_proxy_coord_post`` for the
    tombstone-soft-delete path (coord retains the row + version history;
    DELETE only sets a tombstone marker per Q3's event-sourced shape).
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.delete(url, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    # Coord may return 204 No Content for delete; tolerate empty bodies.
    if resp.status_code == 204 or not resp.content:
        return {"status": "ok"}
    return resp.json()


@router.get("/memory/{name}/version/{version}")
async def get_memory_version(
    name: str,
    version: int,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a specific historical version of a memory entry.

    Per Q3, every write appends an immutable new version row; the
    dashboard's version-history dropdown drives this endpoint to render
    older content (read-only).
    """
    return await _proxy_coord_get(
        f"/coord/memory/{name}/version/{version}", tenant_id=tenant_id
    )


@router.post("/memory/upsert")
async def post_memory_upsert(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Upsert a memory entry (creates a new immutable version row).

    Body shape (coord): ``{"name", "content", "type"?, "description"?,
    "written_by_agent"?, "written_by_device"?}``. Coord stamps the
    monotonic version number + ``written_at``.
    """
    return await _proxy_coord_post("/coord/memory/upsert", body, tenant_id=tenant_id)


@router.delete("/memory/{name}")
async def delete_memory_entry(
    name: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Soft-delete (tombstone) a memory entry.

    Per Q3 the row + version history is retained; coord only sets a
    tombstone marker so reads filter the entry out but ``restore`` can
    revive it.
    """
    return await _proxy_coord_delete(f"/coord/memory/{name}", tenant_id=tenant_id)


@router.post("/memory/{name}/restore")
async def post_memory_restore(
    name: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Restore a memory entry to a previous version.

    Body shape: ``{"version": <int>}``. Coord copies the selected
    version's content into a fresh write (new version number), so the
    history line stays append-only.
    """
    return await _proxy_coord_post(
        f"/coord/memory/{name}/restore", body, tenant_id=tenant_id
    )
