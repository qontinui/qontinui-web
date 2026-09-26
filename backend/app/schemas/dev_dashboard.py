"""
Pydantic schemas for the dev dashboard fleet registry.

These schemas handle runner fleet monitoring across multiple machines.
No authentication required — dev-only, LAN-accessible.
"""

from pydantic import BaseModel, ConfigDict, Field

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


class RunnerUiThread(BaseModel):
    """Native UI-thread liveness a runner reports about itself.

    Plan ``2026-09-09-the-runner-ui-thread-liveness-block-is-emitted-to-three-sinks-and-read-by-none``.

    The runner has published this block on every heartbeat since 2026-08-19
    (``qontinui-runner`` ``src-tauri/src/heartbeat.rs``, ``HeartbeatUiThread`` —
    the single serializer for all three heartbeat sinks). Until this model the
    backend dropped it at the door: ``RunnerHeartbeat`` is a plain
    ``BaseModel``, so pydantic's default ``extra='ignore'`` discarded the key and
    a wedged UI thread was never visible off-box.

    ``derived_status`` collapses several faults into one word; this block is
    what separates them:

    * ``wedged is True`` — the 2026-08-19 failure (window frozen, X button dead)
      which every other heartbeat field reports as healthy.
    * ``wedged is None`` vs ``False`` — the deliberate UNKNOWN / not-wedged
      split. ``None`` means nothing was established (non-Windows, no window
      handle cached yet, monitor stopped) and must NEVER render as "not wedged".
    * ``ping_delivery`` / ``false_death_suppressed`` — separate "the UI is dead"
      from "the runner could not reach it and is deliberately declining to
      recreate it", a suppression that can hold for hours while
      ``derived_status`` reads ``errored`` throughout.

    Every field is optional: a runner predating a field omits it, and absent is
    UNKNOWN. ``extra='allow'`` keeps keys a newer runner adds (e.g. the
    pong-receive liveness of plan
    ``2026-09-09-the-pong-receive-path-has-no-liveness-signal-so-fd-exhaustion-still-reads-as-ui-death``)
    instead of dropping them at the door the way the whole block used to be.

    The wire keys are snake_case and read BY NAME. ``backend_relay.rs`` records
    the incident where camelCase keys were silently dropped and
    ``heartbeat_device`` fell back to writing a literal ``"healthy"`` every
    30 s; ``tests/test_dev_dashboard_ui_thread.py`` pins the ten-key snake_case
    shape the Rust test ``payload_carries_the_native_ui_thread_block`` pins on
    the other side.
    """

    model_config = ConfigDict(extra="allow")

    # Tri-state verdict that fed ``derived_status``. ``None`` = UNKNOWN.
    wedged: bool | None = None
    # "pumping" | "unknown" | "native_probe_wedged" |
    # "window_getter_unresponsive" | "events_undelivered".
    reason: str | None = None
    # The Win32 SendMessageTimeoutW rung. ``None`` = could not ask (UNKNOWN).
    probe_wedged: bool | None = None
    # Renderer alive, but the message loop stopped delivering events to it.
    events_undelivered: bool | None = None
    # Age of the last event-provenance pong; ``None`` if none has landed.
    event_pong_age_ms: int | None = None
    # "ping_delivered" | "ping_undeliverable" | "unknown".
    ping_delivery: str | None = None
    # Monotonic count of ``ui-bridge-ping`` emits that returned Err.
    ping_emit_failures: int | None = None
    # Age of the last successful / failed ping emit; ``None`` = never recorded.
    last_ping_emit_ok_age_ms: int | None = None
    last_ping_emit_fail_age_ms: int | None = None
    # Recreates NOT performed because the ping was undeliverable.
    false_death_suppressed: int | None = None


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
    # Native UI-thread liveness — see ``RunnerUiThread``. ``None`` when the
    # runner predates the block, which is UNKNOWN and never "not wedged".
    ui_thread: RunnerUiThread | None = None


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
    # Pass-through of ``RunnerHeartbeat.ui_thread``. Like ``relay``,
    # DELIBERATELY NOT CLEARED when a runner goes stale: a runner whose
    # heartbeat stopped is exactly the wedged case, and its last report is the
    # only evidence anyone will get. Read it with ``is_healthy`` and
    # ``last_heartbeat`` — on an unhealthy runner it is a last-known reading.
    ui_thread: RunnerUiThread | None = None
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
