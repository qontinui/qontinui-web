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

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_deps import require_admin
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
from app.services.dev_dashboard_service import get_fleet_registry

# Timeout for coord proxy reads. The merge queue is a small JSON payload
# served from PG; if coord takes longer than 5s something is wrong.
_COORD_TIMEOUT = httpx.Timeout(5.0)

logger = structlog.get_logger(__name__)
router = APIRouter()


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


async def _proxy_coord_get(path: str, *, params: dict[str, Any] | None = None) -> Any:
    """Proxy a GET request to coord and return the JSON body.

    ``params`` is forwarded as the query string when set — the merge
    queue endpoint takes none, but the claims dashboard endpoints
    (Phase 5 of plan 2026-05-18-agent-spawn-coordination.md) take
    ``kind``, ``prefix``, ``limit``, ``since`` filters.
    """
    url = f"{settings.COORD_URL}{path}"
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, params=params)
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


async def _proxy_coord_post(path: str, body: Any) -> Any:
    """Proxy a POST request to coord and return the JSON body."""
    url = f"{settings.COORD_URL}{path}"
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.post(url, json=body)
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


# ---- Coord readiness dashboard proxy (Wave 2 — admin-gated) --------------
#
# Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 2. Adds
# the browser-side operator console at ``/admin/coord/*``. ALL endpoints
# in this section are admin-gated (``require_admin``) — the operator
# console is fleet-mutating and read-amplifying surface, not user-scoped.
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
# - GET    /operations/memory/list                       — Wave-3 prep
# - GET    /operations/memory/{name}                     — Wave-3 prep


# ---- Plans (Phase 2 substrate — coord.plans is canonical per Q7) --------


@router.get("/plans")
async def list_coord_plans(
    status: str | None = Query(default=None, description="Filter by status."),
    limit: int | None = Query(default=None, ge=1, le=500),
    _admin: Any = Depends(require_admin),
) -> Any:
    """List entries from ``coord.plans`` via coord."""
    params: dict[str, Any] = {}
    if status is not None:
        params["status"] = status
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get("/coord/plans", params=params or None)


@router.get("/plans/{slug}")
async def get_coord_plan(
    slug: str,
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return a single plan from ``coord.plans``."""
    return await _proxy_coord_get(f"/coord/plans/{slug}")


@router.get("/plans/{slug}/history")
async def get_coord_plan_history(
    slug: str,
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return the status history timeline for a plan."""
    return await _proxy_coord_get(f"/coord/plans/{slug}/history")


@router.post("/plans/{slug}/transition")
async def post_coord_plan_transition(
    slug: str,
    body: dict[str, Any],
    _admin: Any = Depends(require_admin),
) -> Any:
    """Transition a plan to a new status.

    Body shape (coord): ``{"status": "<new_status>", "note": "<optional>"}``.
    Audit trail lives in ``coord.plan_status_history``.
    """
    return await _proxy_coord_post(f"/coord/plans/{slug}/transition", body)


# ---- Primary trees (Phase 1 substrate) -----------------------------------


@router.get("/trees/by-device/{device_id}")
async def get_trees_by_device(
    device_id: str,
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return primary-tree rows for a device from ``coord.primary_trees``."""
    return await _proxy_coord_get(f"/coord/trees/by-device/{device_id}")


@router.get("/trees/contention")
async def get_trees_contention(
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return primary-tree contention view across the fleet."""
    return await _proxy_coord_get("/coord/trees/contention")


# ---- Alerts (full rollup; sibling of /claims/alerts) ---------------------


@router.get("/alerts")
async def get_coord_alerts(
    include_resolved: bool = Query(default=False),
    severity: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return the full ``coord.alerts`` rollup with optional filters.

    Sibling of ``/operations/claims/alerts`` (which filters to
    ``alert_key`` prefix ``claim-``). This endpoint exposes ALL alert
    kinds (claim / conflict / stale_wip / health) for the dashboard's
    Alerts page.
    """
    params: dict[str, Any] = {"include_resolved": include_resolved}
    if severity is not None:
        params["severity"] = severity
    if kind is not None:
        params["kind"] = kind
    return await _proxy_coord_get("/coord/alerts", params=params)


# ---- Fleet health --------------------------------------------------------


@router.get("/fleet/health")
async def get_fleet_health(
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return the fleet-health rollup from coord (`coord.fleet_health`)."""
    return await _proxy_coord_get("/coord/fleet/health")


# ---- Wave-3 prep (decision queue + agent-logs + memory) ------------------
#
# These endpoints are added now so the Wave-3 frontend (decision queue
# inbox, per-agent log tail, memory browser) doesn't need to re-touch
# operations.py. Backed by the Phase 3/5/6 coord routes — the substrate
# is shipped; the operator UI for them lands in Wave-3.


@router.get("/agent-questions/pending")
async def get_pending_agent_questions(
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return pending agent questions awaiting an operator response."""
    return await _proxy_coord_get("/coord/agent-questions/pending")


@router.get("/agent-questions/answered")
async def get_answered_agent_questions(
    limit: int | None = Query(default=None, ge=1, le=500),
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return recently-answered agent questions.

    Wave 3a — surfaces the "answered" tab on the questions inbox so
    operators can audit prior decisions without leaving the page.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/agent-questions/answered", params=params or None
    )


@router.get("/agent-questions/by-session/{session_id}")
async def get_agent_questions_by_session(
    session_id: str,
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return all questions tied to a single ``agent_session_id``.

    Cross-link target from ``/admin/agent-sessions/{session_id}``. Returns
    pending + answered rows so the session-lineage view can show the
    operator-decision arm in line with the other UNION arms.
    """
    return await _proxy_coord_get(
        f"/coord/agent-questions/by-session/{session_id}"
    )


@router.get("/agent-questions/{question_id}")
async def get_agent_question(
    question_id: str,
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return a single agent-question row (pending or answered).

    Backs the ``/admin/coord/questions/[id]`` detail page so the operator
    can render the full question + context + options without first
    fetching the pending list.
    """
    return await _proxy_coord_get(f"/coord/agent-questions/{question_id}")


@router.post("/agent-questions/{question_id}/respond")
async def post_agent_question_response(
    question_id: str,
    body: dict[str, Any],
    _admin: Any = Depends(require_admin),
) -> Any:
    """Operator answers an agent question."""
    return await _proxy_coord_post(
        f"/coord/agent-questions/{question_id}/respond", body
    )


@router.get("/agent-logs/by-agent/{agent_id}")
async def get_agent_logs_by_agent(
    agent_id: str,
    limit: int | None = Query(default=None, ge=1, le=2000),
    since: str | None = Query(default=None),
    _admin: Any = Depends(require_admin),
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
    )


@router.get("/memory/list")
async def get_memory_list(
    _admin: Any = Depends(require_admin),
) -> Any:
    """List entries from the canonical memory substrate."""
    return await _proxy_coord_get("/coord/memory/list")


@router.get("/memory/{name}")
async def get_memory_entry(
    name: str,
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return a single memory entry (latest version) by name."""
    return await _proxy_coord_get(f"/coord/memory/{name}")


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
    _admin: Any = Depends(require_admin),
) -> Any:
    """Proxy ``POST /agents/spawn`` to coord (Wave 4 spawn-from-plan).

    Operator-driven spawn from the ``/admin/coord/spawn`` page. Coord
    handles claim acquisition, device pinning, agent JWT mint, and
    first-tick initial-prompt delivery. The browser doesn't consume
    the agent JWT directly — the receiving runner picks up the new
    agent through the ``events.agent.spawned`` event coord publishes.
    """
    return await _proxy_coord_post("/agents/spawn", body)


@router.get("/agents/{agent_id}")
async def get_agent(
    agent_id: str,
    _admin: Any = Depends(require_admin),
) -> Any:
    """Return a single spawned agent's status row from coord.

    Backs the spawn-confirmation surface so the operator can see
    "spawn succeeded; agent X is now allocated to device Y" without
    leaving the page. Read-only — mutating routes (steal, kill, ...)
    stay agent→coord direct.
    """
    return await _proxy_coord_get(f"/agents/{agent_id}")
