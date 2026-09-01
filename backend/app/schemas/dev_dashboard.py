"""
Pydantic schemas for the dev dashboard fleet registry.

These schemas handle runner fleet monitoring across multiple machines.
No authentication required — dev-only, LAN-accessible.
"""

from pydantic import BaseModel, Field

from app.schemas.base import IsoDatetime


class RunnerRelay(BaseModel):
    """Cloud-relay state a runner reports about itself.

    RT6 of plan
    ``2026-08-30-mobile-account-usage-relay-503-runner-runtime-starvation``.

    A mobile relay 503 is ``coord.devices.ws_session_id IS NULL``, and the two
    faults that produce it need opposite remedies:

    * the runner never registered (unpaired, wrong tier, switched off, or
      pointed at the wrong backend), and
    * the runner registers and drops every few seconds.

    ``connected`` alone cannot separate them — a flapping relay reports ``True``
    in whichever heartbeat lands inside a connection — so the operator sees one
    error message for two problems. These fields separate them:

    * ``consecutive_quick_disconnects > 0`` means churning, whatever
      ``connected`` says.
    * ``last_connected_at_ms is None`` means never registered in that runner
      process's lifetime.
    * a set ``last_connected_at_ms`` with ``connected is False`` means
      registered, then dropped — the fault actually observed on 2026-08-30.

    Every field is optional because a runner predating the change omits the
    whole block. Absent is UNKNOWN, never "healthy" and never "never paired".
    """

    # Tri-state. ``None`` = the relay is legitimately parked (wrong tier,
    # switched off, unpaired) — unconfigured, NOT broken. Consumers must not
    # render it as a fault.
    connected: bool | None = None
    last_error: str | None = None
    # ``0`` = not flapping. ``>= 5`` is the threshold at which the runner's own
    # relay loop extends its backoff to 120s.
    consecutive_quick_disconnects: int | None = None
    last_connected_at_ms: int | None = None


class RunnerHeartbeat(BaseModel):
    """Sent by runners every 30s."""

    hostname: str
    ip: str
    port: int
    instance_name: str | None = None
    os: str  # "windows", "macos", "linux"
    os_version: str | None = None
    running_task_count: int = 0
    running_task_ids: list[str] = Field(default_factory=list)
    # Whether the advertised ``ip`` is actually served by the runner's HTTP
    # bind (runners that bind loopback-only advertise a LAN IP they never
    # listen on). Optional end-to-end: old runners omit it → None (unknown),
    # which consumers must treat as "assume reachable" for back-compat.
    lan_reachable: bool | None = None
    # Cloud-relay state — see ``RunnerRelay``. ``None`` when the runner predates
    # the field, which is UNKNOWN and must not be rendered as "no relay".
    relay: RunnerRelay | None = None


class RegisteredRunner(BaseModel):
    """A runner in the fleet."""

    id: str = Field(..., description='"{hostname}:{port}"')
    hostname: str
    ip: str
    port: int
    instance_name: str | None = None
    os: str
    os_version: str | None = None
    running_task_count: int = 0
    running_task_ids: list[str] = Field(default_factory=list)
    # Pass-through of ``RunnerHeartbeat.lan_reachable`` — None when the
    # runner predates the field (treat as "assume reachable").
    lan_reachable: bool | None = None
    # Pass-through of ``RunnerHeartbeat.relay``.
    #
    # DELIBERATELY NOT CLEARED when a runner goes stale. A runner whose
    # heartbeat has stopped is exactly the case RT6 was written for — the box is
    # unreachable, so nothing can be asked of it — and the LAST relay state it
    # managed to report is the only evidence anyone will get about why. Read it
    # together with ``is_healthy`` and ``last_heartbeat``: on an unhealthy
    # runner this is a last-known reading of that age, not a current one.
    relay: RunnerRelay | None = None
    last_heartbeat: IsoDatetime
    is_healthy: bool = True  # False if heartbeat missed > 90s


class ClaudeSessionInfo(BaseModel):
    """Info about a single Claude Code session."""

    pid: int
    working_directory: str | None = None
    started_at: IsoDatetime | None = None


class ClaudeSessionReport(BaseModel):
    """Sent by CC session scanner."""

    hostname: str
    sessions: list[ClaudeSessionInfo]


class FleetStatus(BaseModel):
    """Full fleet overview."""

    runners: list[RegisteredRunner]
    claude_sessions: dict[str, list[ClaudeSessionInfo]]  # hostname -> sessions
    total_runners: int
    total_healthy: int
    total_running_tasks: int
    total_claude_sessions: int


class RunnerTaskRun(BaseModel):
    """A task run from a runner."""

    id: str
    runner_id: str  # Which runner it's on
    runner_hostname: str
    runner_port: int
    status: str
    prompt: str | None = None
    started_at: str | None = None
    workflow_name: str | None = None


class AggregatedTaskRuns(BaseModel):
    """All running tasks across fleet."""

    task_runs: list[RunnerTaskRun]
    total: int
