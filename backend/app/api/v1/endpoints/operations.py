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

import asyncio
import json
from typing import Any
from uuid import UUID

import httpx
import structlog
import websockets
import websockets.exceptions
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from qontinui_schemas.generated.per_type.memory_restore_request import (
    MemoryRestoreRequest,
)

# Canonical wire-format DTOs for `/operations/memory/*` proxy routes —
# promoted to qontinui-schemas in plan
# ``2026-05-22-memories-on-coord-cross-machine.md`` Phase 6 so coord,
# runner-side memory bridge, and qontinui-web all share one shape.
from qontinui_schemas.generated.per_type.memory_upsert_request import (
    MemoryUpsertRequest,
)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketState

# websockets.connect IS a top-level export in 16.x (verified via
# `dir(websockets)`), but it's a lazy import the mypy stubs don't
# resolve. The explicit re-import below is the type-checker affordance;
# at runtime the symbol is identical to `websockets.connect`.
from websockets.asyncio.client import connect as websockets_connect  # noqa: E402

from app.api.deps import (
    get_async_db,
    get_current_active_user_async,
    get_current_user_from_ws,
)
from app.api.v1.endpoints.devices import _device_to_wire as _runner_to_wire
from app.core.config import settings
from app.crud import runner_crud
from app.db.session import AsyncSessionLocal
from app.models.user import User as UserModel
from app.schemas.dev_dashboard import (
    AggregatedTaskRuns,
    ClaudeSessionReport,
    RegisteredRunner,
    RunnerHeartbeat,
    RunnerTaskRun,
)
from app.services.coord_device_status import (
    CoordDeviceStatusDisabledError,
    CoordDeviceStatusMintFailedError,
    build_device_status_ws_url,
    fetch_device_status,
    mint_device_status_token,
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

    # Build per-hostname CI runner info from coord.devices rows that
    # have ci_runner_status set (Phase 4c self-hosted CI runners).
    ci_runners: dict[str, dict[str, Any]] = {}
    for device in runners:
        if device.ci_runner_status is not None and device.hostname:
            ci_runners[device.hostname] = {
                "status": device.ci_runner_status,
                "labels": list(device.ci_runner_labels or []),
                "lastJobAt": (
                    device.ci_runner_last_job_at.isoformat()
                    if device.ci_runner_last_job_at
                    else None
                ),
            }

    result: dict[str, Any] = {
        "runners": wire_runners,
        "claude_sessions": {
            hostname: [s.model_dump(mode="json") for s in sessions]
            for hostname, sessions in fleet_status.claude_sessions.items()
        },
        "total_claude_sessions": fleet_status.total_claude_sessions,
    }

    if ci_runners:
        result["ci_runners"] = ci_runners

    return result


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
    return await _proxy_coord_patch("/pr-merge/settings", body, tenant_id=tenant_id)


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


@router.get("/pr-merge/graph")
async def get_pr_merge_graph(
    repo: str,
    pr: int,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """PR Merge Orchestrator Phase 5 D5.2 — cross-repo dependency
    graph for a PR's connected component, tenant-scoped.

    Coord returns ``{nodes, edges, topo_order, cycle_detected,
    cycle_members}`` — the frontend renders this as a DAG via dagre
    + the `@xyflow/react` workspace dep already present in
    ``frontend/package.json``.

    Cross-tenant edges are never traversed coord-side; the
    ``X-Qontinui-Tenant-Id`` header injected here is what enforces
    scoping. Two tenants viewing the same repo see disjoint graphs
    in the v1 one-repo-one-tenant model.
    """
    return await _proxy_coord_get(
        "/pr-merge/graph",
        params={"repo": repo, "pr": pr},
        tenant_id=tenant_id,
    )


# ---- PR Merge Orchestrator Phase 6 D6.4 + D6.6 — escalation surface -----
#
# Two endpoints proxying the coord-side ``src/pr_merge/escalations_routes.rs``
# handlers. Both tenant-scoped via the ``X-Qontinui-Tenant-Id`` header;
# the web side authenticates the dashboard user and resolves them to a
# tenant before forwarding. Same posture as the Phase 2 settings
# endpoints — anonymous on coord, authenticated + tenant-scoped here.


@router.get("/pr-merge/escalations")
async def get_pr_merge_escalations(
    include_resolved: bool = False,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Tenant-scoped list of pending (and optionally resolved) merge
    escalations. Drives the MergeTrain "Escalations" dashboard section.

    Each row is a joined view across ``coord.alerts``
    (kind='merge_escalation'), ``coord.merge_escalations_meta``, and
    ``coord.merge_decisions``. The payload carries PR link, reason,
    specialist rationale, rule citations, suggested action, and the
    structured alternatives the operator picks from.
    """
    return await _proxy_coord_get(
        "/pr-merge/escalations",
        params={"include_resolved": "true" if include_resolved else "false"},
        tenant_id=tenant_id,
    )


# ---- PR Merge Orchestrator Phase 8 D8.0 + D8.2 + D8.3 — onboarding --------
#
# Four proxies. precondition-status drives the wizard's polling loop on
# step 2 ("Sign into Claude Code"); audit spawns the repo-auditor + waits
# for STARTER_PROFILE; accept persists the (possibly hand-edited) profile;
# profile-callback is the auditor-agent's write-back surface.


@router.get("/pr-merge/onboarding/precondition-status")
async def get_pr_merge_onboarding_precondition(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return ``{paired, claude_code_available, ready}`` for the calling
    tenant. Drives the onboarding wizard's polling loop on step 2 (the
    "Sign into Claude Code on your device" verification step).
    """
    return await _proxy_coord_get(
        "/pr-merge/onboarding/precondition-status",
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/onboarding/audit")
async def post_pr_merge_onboarding_audit(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Spawn the repo-auditor subagent for the named repo + wait for the
    STARTER_PROFILE. On precondition miss (no audit-capable device)
    coord returns 409 with body ``{"error": "no_audit_capable_device",
    "next_step": "pair_device"}`` — the dashboard surfaces this as a
    redirect back to the pairing wizard, not a generic error toast.
    """
    return await _proxy_coord_post(
        "/pr-merge/onboarding/audit",
        body,
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/onboarding/accept")
async def post_pr_merge_onboarding_accept(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """UPSERT ``coord.tenant_repo_profiles`` with
    ``profile_source='audit'`` + the (possibly hand-edited) starter
    profile. Stamps ``coord.operator_audit`` + publishes settings cache
    invalidation.
    """
    return await _proxy_coord_post(
        "/pr-merge/onboarding/accept",
        body,
        tenant_id=tenant_id,
    )


# ---- PR Merge Orchestrator Phase 8 D8.6 — Suggestions inbox ------------


@router.get("/pr-merge/suggestions")
async def get_pr_merge_suggestions(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List pending drift-suggestion + audit-stale alerts for the
    calling tenant. Drives the MergeTrain "Suggestions" section.
    """
    return await _proxy_coord_get(
        "/pr-merge/suggestions",
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/suggestions/{alert_id}/accept")
async def post_pr_merge_suggestion_accept(
    alert_id: int,
    body: dict[str, Any] | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Apply the suggestion's ``proposed_diff`` to settings + resolve
    the alert + write a ``drift_suggestion_accepted`` user_override
    row (closes the feedback loop).
    """
    return await _proxy_coord_post(
        f"/pr-merge/suggestions/{alert_id}/accept",
        body or {},
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/suggestions/{alert_id}/reject")
async def post_pr_merge_suggestion_reject(
    alert_id: int,
    body: dict[str, Any] | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Resolve the alert with ``resolution_action='rejected'`` + write
    a ``drift_suggestion_rejected`` user_override row (signal: don't
    re-propose this kind for N days).
    """
    return await _proxy_coord_post(
        f"/pr-merge/suggestions/{alert_id}/reject",
        body or {},
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/suggestions/{alert_id}/mute")
async def post_pr_merge_suggestion_mute(
    alert_id: int,
    body: dict[str, Any] | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Mute the suggestion kind for ``body.days`` days (default 30).
    Stored in ``coord.tenant_merge_settings.suggestion_mutes`` JSONB.
    """
    return await _proxy_coord_post(
        f"/pr-merge/suggestions/{alert_id}/mute",
        body or {},
        tenant_id=tenant_id,
    )


# ---- Phase 9 D9.4 + D9.6 — rollout substrate proxies ----------------------
#
# Two endpoints proxying the coord-side ``src/pr_merge/rollout_routes.rs``
# (kill-switch) + ``src/pr_merge/slo_routes.rs`` (SLO dashboard). Both
# tenant-scoped via the ``X-Qontinui-Tenant-Id`` header.


@router.post("/pr-merge/kill-switch")
async def post_pr_merge_kill_switch(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Emergency-stop: flip the calling tenant's rollout_state to
    ``dry_run``. Body shape::

        {
            "scope": "tenant" | "repo:<owner/name>",
            "reason": "<operator's stated reason>"
        }

    Coord:
    1. Verifies the tenant owns the repo (when scope=repo).
    2. UPDATE ``coord.tenant_merge_settings.rollout_state='dry_run'``
       (scope=tenant) or ``coord.tenant_repo_profiles.rollout_state=
       'dry_run'`` (scope=repo).
    3. Invalidates the settings cache (process-local + Redis pubsub).
    4. INSERTs a ``coord.user_overrides(override_kind=
       'kill_switch_activated')`` row.
    5. INSERTs a ``coord.alerts(kind='kill_switch_fired',
       severity='warning')`` row.
    6. Stamps ``auth_sso::audit_mutation``.

    Returns ``{ "scope", "previous_state", "new_state", "affected_repos" }``.
    """
    return await _proxy_coord_post(
        "/pr-merge/kill-switch",
        body,
        tenant_id=tenant_id,
    )


@router.get("/pr-merge/slo")
async def get_pr_merge_slo(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Per-tenant SLO dashboard — per-(tenant, repo) metrics over the
    last 7/30 days.

    Returns ``{ "tenant_id", "repos": [...], "kill_switch_history_last_30d":
    [...], "generated_at" }`` where each repo carries
    ``current_rollout_state`` + 7/30 day windows of
    ``auto_merge_success_rate``, ``escalation_rate``,
    ``operator_override_rate``, ``shadow_vs_live_agreement_rate``,
    ``total_decisions``, ``shadow_decisions``.

    Drives MergeOrchestrationSettings.tsx's SLO Dashboard section.
    """
    return await _proxy_coord_get(
        "/pr-merge/slo",
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/escalations/{alert_id}/decide")
async def post_pr_merge_escalation_decide(
    alert_id: int,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Resolve a pending merge escalation with an operator decision.

    Body shape:

        {
            "resolution_action": "approve_merge"
                                 | "reject"
                                 | "approve_with_modification"
                                 | "add_to_rulebook",
            "rationale": "<operator text>",
            "modification": {...},  // only if approve_with_modification
            "rulebook_addition": "<markdown>"  // only if add_to_rulebook
        }

    Coord:
    1. Verifies the alert belongs to the caller's tenant.
    2. Marks the alert resolved (``resolved_at``, ``resolution_action``,
       ``resolution_by``).
    3. Inserts a ``decided_by='operator'`` row in ``coord.merge_decisions``
       FK'd back to the alert.
    4. Dispatches the chosen action through the same channels Phase 4's
       executor uses (``coord.merge_proposals`` for approve_merge,
       App-token client for reject, per-tenant override write for
       add_to_rulebook).
    5. Stamps an ``auth_sso::audit_mutation`` row.
    """
    return await _proxy_coord_post(
        f"/pr-merge/escalations/{alert_id}/decide",
        body,
        tenant_id=tenant_id,
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


# ---- Coord agent-status proxy (coord-native MCP coordination surface) ----
#
# Plan `coord-native-coordination-mcp` Phase 2 (dashboard-render half).
# Proxies coord's `GET /coord/agent-status` — the work-unit-grain agent
# status read backed by `coord.agent_status` (the MCP coordination surface
# `coord_report_status` / `coord_orient` write into this table). The
# operator dashboard renders it as a *dual-read*: it prefers these
# structured rows and falls back to `/claims/list` metadata when the tenant
# has no agent_status rows yet (cutover robustness).
#
# Tenant scope differs from coord's claims proxy: coord's /coord/agent-status
# reads `tenant_id` as a *query param* (the table's tenant_id is NOT NULL),
# not the `X-Qontinui-Tenant-Id` header. We resolve the caller's tenant via
# `get_tenant_id` and forward it as the query param.


@router.get("/agent-status")
async def get_agent_status(
    correlation_topic: str | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """List active (non-expired) agent_status rows for the caller's tenant.

    Optional ``correlation_topic`` narrows to a single topic. The response
    envelope mirrors coord: ``{"agents": [...], "count": N}``.
    """
    params: dict[str, Any] = {"tenant_id": str(tenant_id)}
    if correlation_topic is not None:
        params["correlation_topic"] = correlation_topic
    return await _proxy_coord_get("/coord/agent-status", params=params)


# ---- Coord gates-dashboard proxy ------------------------------------------
#
# Plan `2026-05-18-agent-spawn-coordination.md` Phase 5 — first-class
# gates dashboard. Three proxy endpoints:
#
# - GET  /operations/gates/list              → coord `/coord/gates`
# - POST /operations/gates/{gate_id}/approve → coord `/coord/gates/{gate_id}/approve`
# - POST /operations/gates/{gate_id}/reject  → coord `/coord/gates/{gate_id}/reject`


@router.get("/gates/list")
async def get_gates_list(
    verdict: str | None = None,
    claim_kind: str | None = None,
    resource_key: str | None = None,
    limit: int | None = None,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """List gates, optionally filtered by verdict."""
    params: dict[str, Any] = {}
    if verdict is not None:
        params["verdict"] = verdict
    if claim_kind is not None:
        params["claim_kind"] = claim_kind
    if resource_key is not None:
        params["resource_key"] = resource_key
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get("/coord/gates", params=params)


@router.post("/gates/{gate_id}/approve")
async def approve_gate(
    gate_id: str,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Approve an OperatorApproval gate."""
    return await _proxy_coord_post(f"/coord/gates/{gate_id}/approve", {})


@router.post("/gates/{gate_id}/reject")
async def reject_gate(
    gate_id: str,
    reason: str | None = None,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Reject an OperatorApproval gate."""
    body: dict[str, Any] = {}
    if reason:
        body["reason"] = reason
    return await _proxy_coord_post(f"/coord/gates/{gate_id}/reject", body)


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
    body: MemoryUpsertRequest,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Upsert a memory entry (creates a new immutable version row).

    Body shape (coord): ``{"name", "content", "type"?, "description"?,
    "written_by_agent"?, "written_by_device"?}``. Coord stamps the
    monotonic version number + ``written_at``. Validated against the
    canonical wire-format schema
    (`qontinui_schemas.generated.per_type.memory_upsert_request`)
    promoted in plan
    ``2026-05-22-memories-on-coord-cross-machine.md`` Phase 6.
    """
    return await _proxy_coord_post(
        "/coord/memory/upsert",
        body.model_dump(exclude_none=True),
        tenant_id=tenant_id,
    )


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
    body: MemoryRestoreRequest,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Restore a memory entry to a previous version.

    Body shape: ``{"version": <int>, "written_by_agent"?, "written_by_device"?}``.
    Coord copies the selected version's content into a fresh write (new
    version number), so the history line stays append-only. Validated
    against the canonical wire-format schema
    (`qontinui_schemas.generated.per_type.memory_restore_request`).
    """
    return await _proxy_coord_post(
        f"/coord/memory/{name}/restore",
        body.model_dump(exclude_none=True),
        tenant_id=tenant_id,
    )


# ---- Memory federation reports proxy ------------------------------------
#
# Plan `2026-05-22-memories-on-coord-cross-machine.md` Phase 2 — the
# `/admin/coord/federation` dashboard backend. Two read-only proxy
# endpoints that forward to coord:
#
# - `/operations/federation/reports`           → coord `/coord/federation/reports`
# - `/operations/federation/reports/{report_id}` → coord `/coord/federation/reports/{report_id}`
#
# Reports are submitted by the runner's memory bridge directly to coord;
# these proxies only serve the dashboard read path.


@router.get("/federation/reports")
async def get_federation_reports(
    device_id: UUID | None = None,
    session_id: UUID | None = None,
    has_failures: bool | None = None,
    since: str | None = None,
    limit: int = Query(default=50, le=200),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List memory federation reports from coord (paginated, filterable)."""
    params: dict[str, str] = {}
    if device_id:
        params["device_id"] = str(device_id)
    if session_id:
        params["session_id"] = str(session_id)
    if has_failures is not None:
        params["has_failures"] = str(has_failures).lower()
    if since:
        params["since"] = since
    params["limit"] = str(limit)
    return await _proxy_coord_get(
        "/coord/federation/reports", tenant_id=tenant_id, params=params
    )


@router.get("/federation/reports/{report_id}")
async def get_federation_report_detail(
    report_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Single memory federation report detail from coord."""
    return await _proxy_coord_get(
        f"/coord/federation/reports/{report_id}", tenant_id=tenant_id
    )


# ---- GitOp federation feed proxy ----------------------------------------
#
# Plan `2026-05-24-federation-verify-and-gitop.md` Phase 7 — the
# `/admin/coord/git-ops` dashboard backend. Three read-only proxy
# endpoints that forward to coord's git-ops feed:
#
# - `/operations/git-ops/list`                  → coord `/coord/git-ops/list`
# - `/operations/git-ops/by-session/{session_id}` → coord `/coord/git-ops/by-session/{session_id}`
# - `/operations/git-ops/branches`              → coord `/coord/git-ops/branches`
#
# Git ops (commit/checkout/branch_create/merge/rebase/push/…) are
# observed by the runner's GitOpBridge (notify-watch + the pre-push hook)
# and submitted to coord directly; these proxies only serve the
# dashboard read path. Tenant resolution + the `X-Qontinui-Tenant-Id`
# header forwarding are identical to the memory-federation block above —
# `get_tenant_id` resolves the caller's tenant and `_proxy_coord_get`
# injects the header so coord scopes every SQL query on `coord.git_ops`.


@router.get("/git-ops/list")
async def get_git_ops_list(
    repo: str | None = None,
    branch: str | None = None,
    since: str | None = None,
    limit: int = Query(default=50, le=200),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List GitOp records from coord (paginated, filterable).

    Forwards the optional ``repo`` / ``branch`` / ``since`` filters and
    the ``limit`` cap to coord, which scopes the query to the caller's
    tenant via the injected ``X-Qontinui-Tenant-Id`` header.
    """
    params: dict[str, str] = {}
    if repo:
        params["repo"] = repo
    if branch:
        params["branch"] = branch
    if since:
        params["since"] = since
    params["limit"] = str(limit)
    return await _proxy_coord_get(
        "/coord/git-ops/list", tenant_id=tenant_id, params=params
    )


@router.get("/git-ops/by-session/{session_id}")
async def get_git_ops_by_session(
    session_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the GitOp records for a single runner session from coord."""
    return await _proxy_coord_get(
        f"/coord/git-ops/by-session/{session_id}", tenant_id=tenant_id
    )


@router.get("/git-ops/branches")
async def get_git_ops_branches(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the current branch-per-device summary from coord."""
    return await _proxy_coord_get("/coord/git-ops/branches", tenant_id=tenant_id)


# ---- Symbol-claims surface (Phase 4.4) ----------------------------------
#
# Plan: `D:/qontinui-root/plans/2026-05-21-coordination-improvements.md`
# Phase 4.4. Drives the "currently editing" sub-line on each
# `MachineCard`. The tree-sitter `symbol_watcher` daemon (Phase 4.1,
# qontinui-supervisor) posts `ClaimKind::Symbol` claims as agents edit
# local files; coord stores them in Redis with a 300s default TTL.
#
# This endpoint is a thin proxy to coord's `/coord/claims/list` with
# `kind=symbol` pinned. Optional `?machine_id` filter is forwarded so a
# future per-machine view can fan out without changing the proxy.
#
# Tenant scoping is intentionally absent here, mirroring the existing
# `/operations/claims/list` posture (Phase 5 of plan
# `2026-05-18-agent-spawn-coordination.md`). Per the Phase 4.3 design
# note: "tenant scoping on symbol claims is a follow-up; for now,
# render the full operator's view across all machines they have access
# to." When coord-side tenant scoping lands, the proxy + frontend can
# pivot to `tenant_id = Depends(get_tenant_id)` without breaking the
# wire shape.


@router.get("/symbol-claims")
async def get_symbol_claims(
    machine_id: str | None = Query(
        default=None,
        description="When set, return only claims held by this machine_id (UUID).",
    ),
    limit: int | None = Query(default=None, ge=1, le=500),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Proxy ``GET /coord/claims/list?kind=symbol`` for the dashboard.

    Response shape (coord ``ListResponse``):

        {
            "kind": "symbol",
            "prefix": "<echo>",
            "holders": [
                {
                    "kind": "symbol",
                    "resource_key": "<repo>:<file>:<symbol>",
                    "machine_id": "<uuid>",
                    "ttl_seconds": <int>
                },
                ...
            ],
            "truncated": <bool>
        }

    Optional ``machine_id`` filter is applied client-side after coord
    returns (coord's ``/coord/claims/list`` doesn't accept a machine
    filter directly — prefix matches on resource_key, not on holder).
    The dashboard groups client-side anyway; this filter is for
    targeted CLI / curl consumers.
    """
    params: dict[str, Any] = {"kind": "symbol", "prefix": ""}
    if limit is not None:
        params["limit"] = limit
    payload = await _proxy_coord_get("/coord/claims/list", params=params)

    if machine_id is not None and isinstance(payload, dict):
        holders = payload.get("holders", [])
        if isinstance(holders, list):
            payload = {
                **payload,
                "holders": [
                    h
                    for h in holders
                    if isinstance(h, dict)
                    and str(h.get("machine_id", "")) == machine_id
                ],
            }
    return payload


# ---- Device-status surface (Phase 1.3) ----------------------------------
#
# Plan: `D:/qontinui-root/plans/2026-05-21-coordination-improvements.md`
# Phase 1.3. Two endpoints back the live `currentActivity` sub-line on
# each `MachineCard` in the operations dashboard:
#
#   1. `GET /operations/device-status`       — tenant-scoped REST proxy.
#                                               Used for the initial
#                                               seed and as a polling
#                                               fallback when the WS
#                                               is offline.
#   2. `WS  /operations/device-status/ws`    — bridges browser to
#                                               coord's per-tenant
#                                               typed `/ws/device-status`.
#
# The WS bridge mints a coord service JWT carrying the operator's
# resolved tenant_id (see `app.services.coord_device_status`), opens
# the upstream WS, subscribes to `device_status:<tenant_uuid>`, and
# forwards `device_status.changed` frames to the browser.


@router.get("/device-status")
async def get_device_status(
    since: str | None = Query(
        default=None,
        description="RFC 3339 timestamp; only rows updated at-or-after are returned.",
    ),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return live ``coord.device_status`` rows scoped to the caller's tenant.

    Response shape::

        { "devices": [StatusRow, ...], "count": <int> }

    The list is unsorted from coord; clients render in arbitrary order
    (the `MachineCard` consumer keys on hostname). When the caller's
    tenant has no devices reporting, ``devices`` is an empty list and
    ``count`` is zero — never 4xx.
    """
    try:
        return await fetch_device_status(tenant_id=tenant_id, since=since)
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=502, detail="coord is not reachable") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504, detail="timeout waiting for coord"
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code, detail=exc.response.text
        ) from exc


@router.websocket("/device-status/ws")
async def websocket_device_status(
    websocket: WebSocket,
) -> None:
    """Bridge browser ↔ coord's typed `/ws/device-status` channel.

    Per-connection flow:

    1. Browser opens `WS /api/v1/operations/device-status/ws?token=<jwt>`.
       Auth: the same JWT used elsewhere on the operations surface
       (cookie-based session token; mirrors `runner_status_ws.py`).
    2. We resolve the caller's tenant_id (same path as
       `/operations/device-status`).
    3. We mint a tenant-scoped coord service JWT via
       `POST /coord/auth/service-token` (admin-secret-gated).
    4. We open the upstream WS at `wss://<coord>/ws/device-status?token=<minted>`
       and subscribe to `device_status:<tenant_id>`.
    5. Every `{"kind":"device_status.changed","row":...}` frame from
       coord is forwarded verbatim to the browser.

    Disconnect / failure handling:

    - Browser drops → close upstream, exit.
    - Coord upstream drops → close browser with 1011 so the browser-
      side hook can reconnect; client-side handles exponential backoff
      (see `useDeviceStatusStream` on the frontend).
    - Coord unreachable / mint failed → close browser with 1011 + an
      error frame so the frontend can fall back to polling.
    """
    await websocket.accept()

    # --- Browser-side auth ------------------------------------------------
    token = websocket.query_params.get("token")
    if not token:
        await websocket.send_json(
            {"type": "error", "error": "Missing authentication token"}
        )
        await websocket.close(code=1008, reason="Missing authentication token")
        return

    try:
        user = await get_current_user_from_ws(token)
    except Exception as exc:  # noqa: BLE001 — auth diagnostics live in deps
        logger.warning("device_status_ws_auth_failed", error=str(exc))
        await websocket.send_json({"type": "error", "error": "Authentication failed"})
        await websocket.close(code=1008, reason="Authentication failed")
        return

    # --- Tenant resolution + token mint ----------------------------------
    try:
        async with AsyncSessionLocal() as db:
            tenant_id = await resolve_tenant_for_user(user, db)
    except HTTPException as http_exc:
        await websocket.send_json({"type": "error", "error": http_exc.detail})
        await websocket.close(code=1008, reason=str(http_exc.detail))
        return
    except Exception as exc:  # noqa: BLE001
        logger.error("device_status_ws_tenant_lookup_failed", error=str(exc))
        await websocket.send_json({"type": "error", "error": "Tenant lookup failed"})
        await websocket.close(code=1011, reason="Tenant lookup failed")
        return

    try:
        coord_token = await mint_device_status_token(tenant_id=tenant_id)
    except CoordDeviceStatusDisabledError as exc:
        logger.warning(
            "device_status_ws_disabled",
            user_id=str(user.id),
            reason=str(exc),
        )
        await websocket.send_json(
            {
                "type": "error",
                "error": "Coord integration disabled — fall back to REST polling.",
            }
        )
        await websocket.close(code=1011, reason="Coord integration disabled")
        return
    except CoordDeviceStatusMintFailedError as exc:
        logger.error(
            "device_status_ws_mint_failed",
            user_id=str(user.id),
            error=str(exc),
        )
        await websocket.send_json({"type": "error", "error": "Token mint failed"})
        await websocket.close(code=1011, reason="Token mint failed")
        return

    upstream_url = build_device_status_ws_url(coord_token)
    subscribe_topic = f"device_status:{tenant_id}"

    # --- Upstream bridge --------------------------------------------------
    upstream: Any = None
    try:
        try:
            upstream = await websockets_connect(upstream_url, open_timeout=10)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "device_status_ws_upstream_connect_failed",
                user_id=str(user.id),
                error=str(exc),
            )
            await websocket.send_json(
                {"type": "error", "error": "Upstream coord WS unreachable"}
            )
            await websocket.close(code=1011, reason="Upstream WS unreachable")
            return

        # Send the typed subscribe message (coord won't push diffs
        # until it receives this).
        await upstream.send(
            json.dumps({"action": "subscribe", "topic": subscribe_topic})
        )

        # Forward both directions: upstream → browser is the hot path
        # (device_status.changed frames). Browser → upstream stays open
        # only so close-frames propagate; we don't forward arbitrary
        # browser payloads (the subscription is fixed per-connection).
        async def pump_upstream_to_browser() -> None:
            try:
                async for message in upstream:
                    if websocket.client_state != WebSocketState.CONNECTED:
                        break
                    # Coord sends Text frames; the websockets lib gives
                    # us str directly. Forward verbatim — the browser
                    # parses the JSON.
                    if isinstance(message, bytes):
                        message = message.decode("utf-8")
                    await websocket.send_text(message)
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "device_status_ws_upstream_pump_error",
                    user_id=str(user.id),
                    error=str(exc),
                )

        async def pump_browser_to_upstream() -> None:
            try:
                while True:
                    # We only need to detect disconnect; the subscription
                    # is fixed so any received frame is informational
                    # (likely a ping/pong from a JS WS lib).
                    await websocket.receive_text()
            except WebSocketDisconnect:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "device_status_ws_browser_pump_exit",
                    user_id=str(user.id),
                    error=str(exc),
                )

        # Race the two pumps — whichever side closes first ends the
        # bridge. asyncio.wait+FIRST_COMPLETED + cancel the rest.
        upstream_task = asyncio.create_task(pump_upstream_to_browser())
        browser_task = asyncio.create_task(pump_browser_to_upstream())
        done, pending = await asyncio.wait(
            {upstream_task, browser_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "device_status_ws_task_cancel_exception",
                    user_id=str(user.id),
                    error=str(exc),
                )
    finally:
        if upstream is not None:
            try:
                await upstream.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("device_status_ws_upstream_close_failed", error=str(exc))
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("device_status_ws_close_failed", error=str(exc))


# ---- CI Status Dashboard surface (Phase 3 + Phase 5) --------------------
#
# Plan: `D:/qontinui-root/qontinui-dev-notes/plans/2026-05-25-ci-status-dashboard-plan.md`
# Phases 3 + 5. Three endpoints back the per-tenant CI status panel on
# the operations dashboard:
#
#   1. `GET  /operations/ci-status`                  — tenant-scoped REST
#                                                      proxy (seed + the
#                                                      polling fallback).
#   2. `WS   /operations/ci-status/ws`               — bridges browser to
#                                                      coord's typed
#                                                      `/ws/device-status`
#                                                      channel, subscribing
#                                                      to the
#                                                      `ci_status:<tenant>`
#                                                      topic family.
#   3. `POST /operations/ci-status/notify-when-green` — register a
#                                                      `CiGreen` gate so an
#                                                      agent is informed
#                                                      when the repo goes
#                                                      green at a given SHA.
#
# The WS bridge reuses the same coord service-JWT mint + upstream WS URL
# as the device-status bridge (`app.services.coord_device_status`) —
# coord multiplexes its `/ws/device-status` channel by topic prefix, so
# the only difference from the device-status bridge is the subscribe
# topic (`ci_status:<tenant>`) and the relayed frame kind
# (`ci_status.changed`).


class RepoCiRow(BaseModel):
    """One repo's CI status, mirroring coord's ``RepoCiRow`` wire shape.

    ``main_verdict`` is coord's 3-state ``MainCiStatus`` rendering
    (``green`` / ``red`` / ``unknown``); any amber tone is a frontend
    derivation from ``open_pr_checks`` counts, not a backend value.
    """

    repo: str
    main_verdict: str = Field(..., description='"green" | "red" | "unknown"')
    open_pr_checks: dict[str, int] = Field(
        ..., description="counts keyed by 'success' | 'failure' | 'pending'"
    )
    latest_details_url: str | None = None
    main_head_sha: str | None = None


class CiStatusResponse(BaseModel):
    """Response wrapper for ``GET /operations/ci-status``."""

    repos: list[RepoCiRow]


class NotifyWhenGreenRequest(BaseModel):
    """Body for ``POST /operations/ci-status/notify-when-green``.

    Registers a ``CiGreen`` gate bound to ``(repo, head_sha)``. The
    optional ``continuation_prompt`` becomes the gate's continuation
    spawn ``initial_prompt`` so the gate engine can hand a follow-up
    prompt to an agent when the repo goes green.
    """

    repo: str
    head_sha: str
    continuation_prompt: str | None = None


class NotifyWhenGreenResponse(BaseModel):
    """Response for ``POST /operations/ci-status/notify-when-green``."""

    gate_id: UUID


@router.get("/ci-status", response_model=CiStatusResponse)
async def get_ci_status(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return per-repo CI status for the caller's tenant.

    Proxies coord's ``GET /coord/ci/status`` with the
    ``X-Qontinui-Tenant-Id`` header. Coord derives the repo set from
    ``coord.tenant_repos`` for the tenant, so an operator with no
    registered repos gets ``{"repos": []}`` — never 4xx.

    Wire shape (coord ``CiStatusResponse``)::

        { "repos": [RepoCiRow, ...] }
    """
    return await _proxy_coord_get("/coord/ci/status", tenant_id=tenant_id)


@router.post("/ci-status/notify-when-green", response_model=NotifyWhenGreenResponse)
async def post_ci_status_notify_when_green(
    body: NotifyWhenGreenRequest,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Register a ``CiGreen`` gate for ``(repo, head_sha)``.

    Builds coord's ``RegisterGateRequest`` (``gate_routes.rs``) with a
    claim anchor (``claim_kind="ci_notify"``,
    ``resource_key="ci-notify:<repo>"``) and the snake-case-tagged
    ``CiGreen`` predicate (``{"kind":"ci_green","repo":...,
    "head_sha":...}``). When ``continuation_prompt`` is set, it is
    carried as the continuation spawn's ``initial_prompt`` — coord's
    ``spawn_continuation`` reads that key (best-effort; it also wants a
    ``target_device_id`` which the dashboard does not supply today, so
    the prompt rides along for when a target is bound).

    Proxies to coord ``POST /coord/gates/register`` with the tenant
    header and returns ``{"gate_id": <uuid>}``.
    """
    register_body: dict[str, Any] = {
        "claim_kind": "ci_notify",
        "resource_key": f"ci-notify:{body.repo}",
        "predicate": {
            "kind": "ci_green",
            "repo": body.repo,
            "head_sha": body.head_sha,
        },
    }
    if body.continuation_prompt is not None:
        register_body["continuation_spawn"] = {
            "initial_prompt": body.continuation_prompt,
        }
    return await _proxy_coord_post(
        "/coord/gates/register", register_body, tenant_id=tenant_id
    )


@router.websocket("/ci-status/ws")
async def websocket_ci_status(
    websocket: WebSocket,
) -> None:
    """Bridge browser ↔ coord's typed `/ws/device-status` channel for CI.

    Mirrors :func:`websocket_device_status` exactly — coord multiplexes
    its WS by topic prefix, so the same minted service JWT + upstream WS
    URL are reused. The only differences are the subscribe topic
    (``ci_status:<tenant>`` instead of ``device_status:<tenant>``) and
    the frame kind relayed (``ci_status.changed``). Frames are forwarded
    verbatim; the browser parses the JSON.

    Per-connection flow:

    1. Browser opens `WS /api/v1/operations/ci-status/ws?token=<jwt>`.
    2. We resolve the caller's tenant_id (same path as `/ci-status`).
    3. We mint a tenant-scoped coord service JWT.
    4. We open coord's `/ws/device-status` and subscribe to
       `ci_status:<tenant_id>`.
    5. Every `{"kind":"ci_status.changed","row":...}` frame is forwarded
       to the browser.

    Disconnect / failure handling matches the device-status bridge:
    browser drop → close upstream; coord drop → close browser 1011 so
    the hook reconnects; mint/connect failure → 1011 + error frame so
    the frontend falls back to polling.
    """
    await websocket.accept()

    # --- Browser-side auth ------------------------------------------------
    token = websocket.query_params.get("token")
    if not token:
        await websocket.send_json(
            {"type": "error", "error": "Missing authentication token"}
        )
        await websocket.close(code=1008, reason="Missing authentication token")
        return

    try:
        user = await get_current_user_from_ws(token)
    except Exception as exc:  # noqa: BLE001 — auth diagnostics live in deps
        logger.warning("ci_status_ws_auth_failed", error=str(exc))
        await websocket.send_json({"type": "error", "error": "Authentication failed"})
        await websocket.close(code=1008, reason="Authentication failed")
        return

    # --- Tenant resolution + token mint ----------------------------------
    try:
        async with AsyncSessionLocal() as db:
            tenant_id = await resolve_tenant_for_user(user, db)
    except HTTPException as http_exc:
        await websocket.send_json({"type": "error", "error": http_exc.detail})
        await websocket.close(code=1008, reason=str(http_exc.detail))
        return
    except Exception as exc:  # noqa: BLE001
        logger.error("ci_status_ws_tenant_lookup_failed", error=str(exc))
        await websocket.send_json({"type": "error", "error": "Tenant lookup failed"})
        await websocket.close(code=1011, reason="Tenant lookup failed")
        return

    try:
        coord_token = await mint_device_status_token(tenant_id=tenant_id)
    except CoordDeviceStatusDisabledError as exc:
        logger.warning(
            "ci_status_ws_disabled",
            user_id=str(user.id),
            reason=str(exc),
        )
        await websocket.send_json(
            {
                "type": "error",
                "error": "Coord integration disabled — fall back to REST polling.",
            }
        )
        await websocket.close(code=1011, reason="Coord integration disabled")
        return
    except CoordDeviceStatusMintFailedError as exc:
        logger.error(
            "ci_status_ws_mint_failed",
            user_id=str(user.id),
            error=str(exc),
        )
        await websocket.send_json({"type": "error", "error": "Token mint failed"})
        await websocket.close(code=1011, reason="Token mint failed")
        return

    upstream_url = build_device_status_ws_url(coord_token)
    subscribe_topic = f"ci_status:{tenant_id}"

    # --- Upstream bridge --------------------------------------------------
    upstream: Any = None
    try:
        try:
            upstream = await websockets_connect(upstream_url, open_timeout=10)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "ci_status_ws_upstream_connect_failed",
                user_id=str(user.id),
                error=str(exc),
            )
            await websocket.send_json(
                {"type": "error", "error": "Upstream coord WS unreachable"}
            )
            await websocket.close(code=1011, reason="Upstream WS unreachable")
            return

        # Send the typed subscribe message (coord won't push diffs
        # until it receives this).
        await upstream.send(
            json.dumps({"action": "subscribe", "topic": subscribe_topic})
        )

        # Forward both directions: upstream → browser is the hot path
        # (ci_status.changed frames). Browser → upstream stays open only
        # so close-frames propagate; we don't forward arbitrary browser
        # payloads (the subscription is fixed per-connection).
        async def pump_upstream_to_browser() -> None:
            try:
                async for message in upstream:
                    if websocket.client_state != WebSocketState.CONNECTED:
                        break
                    # Coord sends Text frames; the websockets lib gives
                    # us str directly. Forward verbatim — the browser
                    # parses the JSON.
                    if isinstance(message, bytes):
                        message = message.decode("utf-8")
                    await websocket.send_text(message)
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ci_status_ws_upstream_pump_error",
                    user_id=str(user.id),
                    error=str(exc),
                )

        async def pump_browser_to_upstream() -> None:
            try:
                while True:
                    # We only need to detect disconnect; the subscription
                    # is fixed so any received frame is informational
                    # (likely a ping/pong from a JS WS lib).
                    await websocket.receive_text()
            except WebSocketDisconnect:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "ci_status_ws_browser_pump_exit",
                    user_id=str(user.id),
                    error=str(exc),
                )

        # Race the two pumps — whichever side closes first ends the
        # bridge. asyncio.wait+FIRST_COMPLETED + cancel the rest.
        upstream_task = asyncio.create_task(pump_upstream_to_browser())
        browser_task = asyncio.create_task(pump_browser_to_upstream())
        done, pending = await asyncio.wait(
            {upstream_task, browser_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "ci_status_ws_task_cancel_exception",
                    user_id=str(user.id),
                    error=str(exc),
                )
    finally:
        if upstream is not None:
            try:
                await upstream.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("ci_status_ws_upstream_close_failed", error=str(exc))
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("ci_status_ws_close_failed", error=str(exc))


# ---- Coord-Native Session Coordination — Phase 5 ------------------------
#
# Plan: `D:/qontinui-root/qontinui-dev-notes/plans/2026-05-22-coord-native-session-coordination.md`
# Phase 5. The dashboard `/sessions` panel reads from coord's
# `/sessions` REST + SSE surface (Phase 1 SHIPPED, LIVE at
# `coord.staging.qontinui.io`).
#
# We proxy from the web backend so the browser gets:
#   1. Same-origin requests (no CORS to coord required).
#   2. Tenant scoping via the resolved operator → tenant_id (the
#      header-driven dependency below).
#   3. A future hook for RBAC + audit if Phase 5/7 grows teeth.
#
# Endpoints:
#   GET    /api/v1/operations/sessions[?scope=active|all&since=...]
#   GET    /api/v1/operations/sessions/{id}
#   GET    /api/v1/operations/sessions/{id}/events                 (SSE)
#   POST   /api/v1/operations/sessions/{id}/steal { reason, machine_id }
#   DELETE /api/v1/operations/sessions/{id}
#   GET    /api/v1/operations/tenants                              (list)
#
# `GET /sessions/.../events` is an SSE proxy; the upstream coord stream
# is open until the browser disconnects. The proxy must NOT buffer —
# we use httpx streaming + StreamingResponse to keep the byte path
# tight.


@router.get("/sessions")
async def list_coord_sessions(
    scope: str | None = Query(
        default=None,
        description="`active` (default) | `all` — passthrough to coord.",
    ),
    since: str | None = Query(
        default=None,
        description="RFC 3339 timestamp; only rows updated at-or-after are returned.",
    ),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List active (default) or all sessions for the caller's tenant.

    Wire shape from coord::

        { "count": <int>, "scope": "<active|all>", "sessions": [SessionRow, ...] }

    Where ``SessionRow`` matches ``qontinui-coord/src/sessions.rs::SessionRow``.
    """
    params: dict[str, Any] = {"tenant_id": str(tenant_id)}
    if scope is not None:
        params["scope"] = scope
    if since is not None:
        params["since"] = since
    return await _proxy_coord_get("/sessions", params=params)


@router.get("/sessions/{session_id}")
async def get_coord_session(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Fetch a single session row by id (read-only).

    Coord's `GET /sessions/:id` is not separately exposed today; we
    derive the row from `GET /sessions?scope=all&tenant_id=...` and
    filter client-side. Cheap because the tenant list is small in
    pilot and the row is small.
    """
    payload = await _proxy_coord_get(
        "/sessions",
        params={"tenant_id": str(tenant_id), "scope": "all"},
    )
    sessions = payload.get("sessions", []) if isinstance(payload, dict) else []
    for row in sessions:
        if isinstance(row, dict) and str(row.get("id", "")) == str(session_id):
            return row
    raise HTTPException(status_code=404, detail="session not found")


@router.get("/sessions/{session_id}/output")
async def get_coord_session_output(
    session_id: UUID,
    tier: str | None = Query(
        default=None,
        description="`warm` (default) | `cold` — passthrough to coord.",
    ),
    limit: int | None = Query(
        default=None,
        description="Max warm-tier chunks to return (warm tier only).",
    ),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Fetch a session's recorded PTY output (Phase 8 read-only pane).

    Bridges to coord's ``GET /sessions/:id/output[?tier=warm|cold][&limit=N]``.
    The response envelope is::

        {
          "session_id": "<uuid>",
          "tier": "warm" | "cold",
          "chunks": [ { "chunk_offset": <i64>, "payload_b64": "<base64>" }, ... ],
          "count": <int>
        }

    Each chunk's ``payload_b64`` decodes to raw PTY bytes (already redacted
    runner-side when the session opted into redaction). The dashboard fetches
    the ``warm`` tier for the xterm bootstrap window then live-tails the
    ``/sessions/:id/events`` SSE stream (``output_chunk`` frames carry the
    same ``chunk_offset`` + ``payload_b64`` shape), de-duping by
    ``chunk_offset``.

    Gated on coord serving the Phase 8 output endpoints (PR #130). Until
    those are deployed, coord returns an error for this path and the pane
    renders its empty / unavailable state.
    """
    params: dict[str, Any] = {}
    if tier is not None:
        params["tier"] = tier
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        f"/sessions/{session_id}/output",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/sessions/{session_id}/events")
async def stream_coord_session_events(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Stream session events as Server-Sent Events.

    Bridges to coord's `GET /sessions/:id/events` (SSE). The upstream
    stream emits a replay of the last 100 events followed by a
    JetStream live-tail subscription for the same session.

    Tenant scoping: tenant_id is resolved server-side; coord ignores
    `X-Qontinui-Tenant-Id` on this route today (sessions endpoints
    are anonymous in pilot) but the header is forwarded for the
    Phase 6 hardening pass.
    """
    url = f"{settings.COORD_URL}/sessions/{session_id}/events"
    headers = _tenant_headers(tenant_id)

    async def _proxy() -> Any:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(None, connect=5.0),
        ) as client:
            async with client.stream("GET", url, headers=headers) as upstream:
                if upstream.status_code >= 400:
                    body = await upstream.aread()
                    raise HTTPException(
                        status_code=upstream.status_code,
                        detail=body.decode("utf-8", "ignore"),
                    )
                async for chunk in upstream.aiter_raw():
                    yield chunk

    return StreamingResponse(
        _proxy(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sessions/{session_id}/steal")
async def steal_coord_session(
    session_id: UUID,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Steal a session's claim (Phase 6 wires the dashboard UI; the
    proxy lives here so the byte-paths are stable from Phase 5)."""
    return await _proxy_coord_post(
        f"/sessions/{session_id}/steal", body, tenant_id=tenant_id
    )


@router.delete("/sessions/{session_id}")
async def close_coord_session(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Close a session (DELETE → `state='closed'`, releases claim)."""
    return await _proxy_coord_delete(f"/sessions/{session_id}", tenant_id=tenant_id)


@router.post("/sessions/{session_id}/handoff")
async def handoff_coord_session(
    session_id: UUID,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Hand a session off to another machine ("Continue elsewhere").

    Plan ``2026-05-23-coord-native-sessions-phase-7-10.md`` §Phase 7.
    Proxies coord's ``POST /sessions/:id/handoff {target_device_id}``,
    which records a durable ``handoff_request`` event on the source
    session and publishes the JetStream handoff subject scoped to the
    target machine. The target runner's receiver loop materializes a
    child session (``parent_session_id = source``) and closes this one —
    a one-way move (no live mirror; that's Phase 8).

    Body: ``{ "target_device_id": "<uuid>" }``.
    """
    return await _proxy_coord_post(
        f"/sessions/{session_id}/handoff", body, tenant_id=tenant_id
    )


@router.get("/tenants")
async def list_user_tenants(
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Return the tenants the current operator belongs to.

    Today the resolver yields a single tenant per user — see
    ``coord_operator_resolver.resolve_tenant_for_user``. The endpoint
    still returns a list so the frontend `TenantSwitcher` can render
    the multi-tenant UX uniformly when the resolver grows wider
    membership in Phase 7 / SSO.

    Wire shape::

        { "tenants": [ { "id": "<uuid>", "slug": "<str>", "name": "<str>" } ],
          "active_tenant_id": "<uuid>" }
    """
    tenant_id = await resolve_tenant_for_user(current_user, db)
    row = (
        await db.execute(
            text(
                """
                SELECT tenant_id, slug, display_name
                FROM coord.tenants
                WHERE tenant_id = :id
                LIMIT 1
                """
            ),
            {"id": str(tenant_id)},
        )
    ).first()
    if row is None:
        return {
            "tenants": [{"id": str(tenant_id), "slug": "personal", "name": "Personal"}],
            "active_tenant_id": str(tenant_id),
        }
    return {
        "tenants": [
            {
                "id": str(row[0]),
                "slug": str(row[1]) if row[1] is not None else "",
                "name": str(row[2]) if row[2] is not None else "",
            }
        ],
        "active_tenant_id": str(tenant_id),
    }
