"""
In-memory fleet registry for the dev dashboard.

Tracks runner instances across machines via heartbeats and provides
aggregation of running tasks and Claude Code sessions. No database
needed — this is ephemeral dev data.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Collection
from datetime import UTC, datetime
from typing import Any, NamedTuple

import httpx
import psutil
import structlog

from app.schemas.dev_dashboard import (
    ClaudeSessionInfo,
    ClaudeSessionReport,
    FleetStatus,
    RegisteredRunner,
    RunnerHeartbeat,
)

logger = structlog.get_logger(__name__)


def _runner_url(runner: RegisteredRunner, path: str) -> httpx.URL:
    """The URL of ``path`` on ``runner``, composed from its parts.

    Never an f-string. The address comes from the unauthenticated beacon, and
    ``f"http://{ip}:{port}{path}"`` let an ``ip`` such as
    ``127.0.0.1:9876/apps#`` choose the port and the path too (the ``#`` made
    the real port and path a fragment). Composed, the host can only be a host:
    an IPv6 literal is bracketed, and a value that is not a host is refused by
    httpx (``InvalidURL``) or percent-encoded into a name nothing resolves,
    never read as a port or a path. ``RunnerHeartbeat`` also refuses a
    non-literal ``ip`` at the door; this keeps the registry's other readers
    honest whatever it holds. ``path`` is still the caller's to keep clean:
    httpx resolves ``.`` and ``..`` segments in it.
    """
    return httpx.URL(scheme="http", host=runner.ip, port=runner.port, path=path)


def _own_addresses() -> frozenset[str]:
    """The addresses of this backend's own network interfaces.

    Read from the interfaces, not by resolving the hostname, so it asks no DNS
    and covers every interface. A read that fails leaves the loopback and
    unspecified checks in :func:`_is_co_located` standing, and logs why.
    """
    try:
        interfaces = psutil.net_if_addrs()
    except OSError as e:
        logger.warning("own_addresses_unreadable", error=str(e))
        return frozenset()
    return frozenset(
        address.address.split("%", 1)[0]
        for addresses in interfaces.values()
        for address in addresses
        if address.family in (socket.AF_INET, socket.AF_INET6)
    )


def _is_co_located(ip: str, own_addresses: Collection[str]) -> bool:
    """Whether a beacon's address names this backend's own host.

    Anyone can file any address: the beacon takes no credential. Dialling a
    loopback address reaches whichever runner listens on this host, and that
    runner admits the hop with full local trust, so it is the runner the
    co-located arm of ``device_bridge_ws.runner_proxy`` keeps for platform admins
    (coord finding ``e66c681f-ee4a-4056-aaa7-0212814aafcc``, item 2(d)). Another
    of this host's addresses reaches it only where the runner was configured to
    listen there and to accept that ``Host``; a default runner binds loopback and
    refuses it. It is held to the same rule because nothing here can tell which
    runner it is. A value that is not an address cannot be judged, so it counts
    as this host.
    """
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return True
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return (
        address.is_loopback or address.is_unspecified or str(address) in own_addresses
    )


class CoLocatedRunnerRefused(Exception):
    """A beacon names this backend's own host, and the caller may not dial it."""


class RunningTasks(NamedTuple):
    """What one task fan-out found, and how many runners it did not dial."""

    tasks: list[dict[str, Any]]
    withheld_co_located: int


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
                relay=heartbeat.relay,
                ui_thread=heartbeat.ui_thread,
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
        *,
        may_reach_co_located: bool,
    ) -> Any:
        """Proxy an HTTP GET request to a specific runner.

        ``may_reach_co_located`` says whether the caller may reach a runner on
        this backend's own host; one who may not gets
        :class:`CoLocatedRunnerRefused`. It is judged on the same snapshot of
        the entry the request then dials: an unauthenticated beacon can re-file
        the entry at any moment, so a check on an earlier read would prove
        nothing about the address dialled.
        """
        runner = await self.get_runner(runner_id)
        if not runner:
            return None
        if not may_reach_co_located and _is_co_located(runner.ip, _own_addresses()):
            raise CoLocatedRunnerRefused(runner_id)

        try:
            url = _runner_url(runner, path)
        except httpx.InvalidURL as e:
            logger.warning(
                "runner_proxy_bad_address",
                runner_id=runner_id,
                error=str(e),
            )
            return None
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                logger.warning(
                    "runner_proxy_failed",
                    runner_id=runner_id,
                    url=str(url),
                    error=str(e),
                )
                return None

    async def get_all_running_tasks(
        self, *, hostnames: Collection[str], may_reach_co_located: bool
    ) -> RunningTasks:
        """Fetch running tasks concurrently from the caller's healthy runners.

        The scope is applied BEFORE dialling, so a stranger's entry is never
        dialled for this caller. It does not make an entry trustworthy: an entry
        filed under the caller's own host can still name any address, which stays
        open until a beacon is bound to a proven device (coord finding
        ``e66c681f-ee4a-4056-aaa7-0212814aafcc``, items 2(a) and 2(c)).
        ``hostnames`` are the lower-cased hosts the caller owns a device on.
        ``may_reach_co_located`` says whether the caller may reach a runner on
        this backend's own host; the owned-host filter alone cannot keep one
        out, because the task is labelled with the hostname the beacon claimed.
        """
        async with self._lock:
            runners = [
                r
                for r in self._runners.values()
                if r.is_healthy and r.hostname.lower() in hostnames
            ]
        withheld = 0
        if not may_reach_co_located:
            own_addresses = _own_addresses()
            dialled = [r for r in runners if not _is_co_located(r.ip, own_addresses)]
            withheld = len(runners) - len(dialled)
            runners = dialled

        if not runners:
            return RunningTasks([], withheld)

        async def _fetch_tasks(
            client: httpx.AsyncClient, runner: RegisteredRunner
        ) -> list[dict[str, Any]]:
            try:
                resp = await client.get(_runner_url(runner, "/task-runs/running"))
                resp.raise_for_status()
                data = resp.json()
                # The runner returns an envelope: {"scope": ..., "task_runs": [...]}.
                # `scope` states that the list covers workflow task-runs on one
                # API port and is NOT a census of live agent sessions. Indexing
                # rather than .get() keeps a future shape change loud (it lands
                # in the except below with the KeyError named) instead of
                # silently reporting zero running tasks.
                runs: list[Any] = data["task_runs"]
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
        return RunningTasks(all_tasks, withheld)


# Singleton
_fleet_registry: FleetRegistry | None = None


def get_fleet_registry() -> FleetRegistry:
    """Get or create the singleton FleetRegistry instance."""
    global _fleet_registry
    if _fleet_registry is None:
        _fleet_registry = FleetRegistry()
    return _fleet_registry
