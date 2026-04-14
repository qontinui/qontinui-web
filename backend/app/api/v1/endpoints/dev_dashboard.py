"""
Dev Dashboard API — Fleet monitoring across machines.

These endpoints are unauthenticated (dev-only, LAN access).
"""

import structlog
from app.schemas.dev_dashboard import (
    AggregatedTaskRuns,
    ClaudeSessionReport,
    FleetStatus,
    RegisteredRunner,
    RunnerHeartbeat,
    RunnerTaskRun,
)
from app.services.dev_dashboard_service import get_fleet_registry
from fastapi import APIRouter, HTTPException, Query

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.post("/heartbeat", response_model=RegisteredRunner)
async def runner_heartbeat(heartbeat: RunnerHeartbeat) -> RegisteredRunner:
    """Receive heartbeat from a runner. Called every 30s by each runner."""
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


@router.get("/fleet", response_model=FleetStatus)
async def get_fleet_status() -> FleetStatus:
    """Get full fleet status - all runners, health, tasks, claude sessions."""
    registry = get_fleet_registry()
    return await registry.get_fleet_status()


@router.get("/fleet/tasks", response_model=AggregatedTaskRuns)
async def get_all_tasks() -> AggregatedTaskRuns:
    """Get all running tasks across all runners."""
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
async def remove_runner(runner_id: str) -> dict:
    """Manually remove a runner from the registry."""
    registry = get_fleet_registry()
    removed = await registry.remove_runner(runner_id)
    if not removed:
        raise HTTPException(
            status_code=404,
            detail=f"Runner {runner_id} not found",
        )
    return {"status": "removed", "runner_id": runner_id}
