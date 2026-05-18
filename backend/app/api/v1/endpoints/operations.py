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

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.runners import _runner_to_wire
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


async def _proxy_coord_get(
    path: str, *, params: dict[str, Any] | None = None
) -> Any:
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
    return await _proxy_coord_get(
        "/coord/claims/recent-conflicts", params=params
    )


@router.get("/claims/recent-expirations")
async def get_recent_expirations(
    limit: int | None = None,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return the recent-expirations ring buffer from coord."""
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/claims/recent-expirations", params=params
    )


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
        a for a in rows
        if isinstance(a, dict) and str(a.get("alert_key", "")).startswith("claim-")
    ]
    if is_dict:
        return {"alerts": filtered}
    return filtered
