"""
Pydantic schemas for the dev dashboard fleet registry.

These schemas handle runner fleet monitoring across multiple machines.
No authentication required — dev-only, LAN-accessible.
"""

from pydantic import BaseModel, Field

from app.schemas.base import IsoDatetime


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
