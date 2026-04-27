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

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.runners import _runner_to_wire
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
