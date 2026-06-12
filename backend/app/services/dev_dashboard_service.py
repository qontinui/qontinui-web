"""
In-memory fleet registry for the dev dashboard.

Tracks runner instances across machines via heartbeats and provides
aggregation of running tasks and Claude Code sessions. No database
needed — this is ephemeral dev data.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from app.schemas.dev_dashboard import (
    ClaudeSessionInfo,
    ClaudeSessionReport,
    FleetStatus,
    RegisteredRunner,
    RunnerHeartbeat,
)

logger = structlog.get_logger(__name__)


class FleetRegistry:
    """In-memory registry of runner instances across machines."""

    def __init__(self) -> None:
        self._runners: dict[str, RegisteredRunner] = {}  # id -> runner
        self._claude_sessions: dict[
            str, list[ClaudeSessionInfo]
        ] = {}  # hostname -> sessions
        self._lock = asyncio.Lock()

    async def register_heartbeat(self, heartbeat: RunnerHeartbeat) -> RegisteredRunner:
        """Register or update a runner from heartbeat."""
        runner_id = f"{heartbeat.hostname}:{heartbeat.port}"
        async with self._lock:
            runner = RegisteredRunner(
                id=runner_id,
                hostname=heartbeat.hostname,
                ip=heartbeat.ip,
                port=heartbeat.port,
                instance_name=heartbeat.instance_name,
                os=heartbeat.os,
                os_version=heartbeat.os_version,
                running_task_count=heartbeat.running_task_count,
                running_task_ids=heartbeat.running_task_ids,
                lan_reachable=heartbeat.lan_reachable,
                last_heartbeat=datetime.now(UTC),
                is_healthy=True,
            )
            self._runners[runner_id] = runner
            return runner

    async def report_claude_sessions(self, report: ClaudeSessionReport) -> None:
        """Store Claude Code session report for a hostname."""
        async with self._lock:
            self._claude_sessions[report.hostname] = report.sessions

    async def get_fleet_status(self) -> FleetStatus:
        """Get full fleet overview, marking stale runners as unhealthy."""
        async with self._lock:
            now = datetime.now(UTC)
            for runner in self._runners.values():
                age = (now - runner.last_heartbeat).total_seconds()
                runner.is_healthy = age < 90

            runners = list(self._runners.values())
            return FleetStatus(
                runners=runners,
                claude_sessions=dict(self._claude_sessions),
                total_runners=len(runners),
                total_healthy=sum(1 for r in runners if r.is_healthy),
                total_running_tasks=sum(r.running_task_count for r in runners),
                total_claude_sessions=sum(
                    len(s) for s in self._claude_sessions.values()
                ),
            )

    async def remove_runner(self, runner_id: str) -> bool:
        """Remove a runner from the registry. Returns True if found."""
        async with self._lock:
            return self._runners.pop(runner_id, None) is not None

    async def get_runner(self, runner_id: str) -> RegisteredRunner | None:
        """Get a specific runner by ID."""
        async with self._lock:
            return self._runners.get(runner_id)

    async def proxy_runner_request(
        self,
        runner_id: str,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Proxy an HTTP GET request to a specific runner."""
        runner = await self.get_runner(runner_id)
        if not runner:
            return None

        url = f"http://{runner.ip}:{runner.port}{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                logger.warning(
                    "runner_proxy_failed",
                    runner_id=runner_id,
                    url=url,
                    error=str(e),
                )
                return None

    async def get_all_running_tasks(self) -> list[dict[str, Any]]:
        """Fetch running tasks from all healthy runners concurrently."""
        async with self._lock:
            runners = [r for r in self._runners.values() if r.is_healthy]

        if not runners:
            return []

        async def _fetch_tasks(
            client: httpx.AsyncClient, runner: RegisteredRunner
        ) -> list[dict[str, Any]]:
            url = f"http://{runner.ip}:{runner.port}/task-runs/running"
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
                # The runner returns a list of task runs
                runs: list[Any] = (
                    data
                    if isinstance(data, list)
                    else data.get("data", data.get("task_runs", []))
                )
                return [
                    {
                        "id": run.get("id", ""),
                        "runner_id": runner.id,
                        "runner_hostname": runner.hostname,
                        "runner_port": runner.port,
                        "status": run.get("status", "unknown"),
                        "prompt": run.get("prompt"),
                        "started_at": run.get("started_at"),
                        "workflow_name": run.get("workflow_name"),
                    }
                    for run in runs
                ]
            except Exception as e:
                logger.warning(
                    "fetch_tasks_failed",
                    runner_id=runner.id,
                    error=str(e),
                )
                return []

        async with httpx.AsyncClient(timeout=10.0) as client:
            results = await asyncio.gather(
                *[_fetch_tasks(client, runner) for runner in runners],
                return_exceptions=True,
            )

        all_tasks: list[dict[str, Any]] = []
        for result in results:
            if isinstance(result, list):
                all_tasks.extend(result)
            elif isinstance(result, BaseException):
                logger.warning(
                    "fetch_tasks_exception",
                    error=str(result),
                )
        return all_tasks


# Singleton
_fleet_registry: FleetRegistry | None = None


def get_fleet_registry() -> FleetRegistry:
    """Get or create the singleton FleetRegistry instance."""
    global _fleet_registry
    if _fleet_registry is None:
        _fleet_registry = FleetRegistry()
    return _fleet_registry
