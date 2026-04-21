"""
Pydantic schemas for the server-mode runner fleet registry.

Kept separate from :mod:`app.schemas.runner` (which owns the older
``RunnerConnection`` websocket-history API) to avoid conflating the two
models.
"""

from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime


class RunnerRegistrationRequest(BaseSchema):
    """Request body for ``POST /runners/register`` (runner-authenticated)."""

    name: str = Field(..., min_length=1, max_length=255)
    hostname: str = Field(..., min_length=1, max_length=255)
    port: int = Field(..., ge=1, le=65535)
    capabilities: list[str] = Field(default_factory=list)
    server_mode: bool = True
    restate_enabled: bool = False
    restate_healthy: bool = False


class RunnerRegistrationResponse(BaseSchema):
    """Response to a successful ``POST /runners/register``.

    ``dispatch_secret`` is a per-runner machine-to-machine credential web
    signs workflow-dispatch requests with. The runner captures and stores it
    in memory (``ServerModeState.dispatch_secret``) and accepts it as a
    bearer on its own ``POST /api/workflows/run`` endpoint.

    The secret rotates on every successful registration. It is only returned
    here — the runner is expected to persist it for the session lifetime of
    the process.
    """

    runner_id: UUID
    registered_at: IsoDatetime
    dispatch_secret: str


class UiErrorPayload(BaseSchema):
    """Structured UI error reported by a runner's React error boundary.

    Mirrors the object the runner POSTs inside a heartbeat when its error
    boundary is currently holding a rendered-error state. ``None`` on the
    heartbeat means "no outstanding UI error"; sending ``None`` explicitly
    clears whatever was previously stored on the runner row.
    """

    message: str
    stack: str | None = None
    component_stack: str | None = None
    digest: str | None = None
    first_seen: IsoDatetime
    reported_at: IsoDatetime
    count: int


class RunnerHeartbeatRequest(BaseSchema):
    """Request body for ``POST /runners/{runner_id}/heartbeat``.

    Phase 3J.5 extended this payload with ``derived_status`` (the runner's
    computed overall health) and ``ui_error`` (the last outstanding React
    error boundary payload, if any). Both new fields are optional so
    pre-Phase-3J runners that still post the minimal shape continue to
    heartbeat successfully.
    """

    restate_healthy: bool
    status: str = Field(
        ...,
        min_length=1,
        max_length=32,
        description="Runner status — typically one of: healthy, unhealthy, offline",
    )
    derived_status: str | None = Field(
        default=None,
        max_length=32,
        description=(
            "Runner-derived overall status "
            "(healthy|degraded|errored|offline|starting). "
            "Optional — pre-Phase-3J runners omit it."
        ),
    )
    ui_error: UiErrorPayload | None = Field(
        default=None,
        description=(
            "Most recent outstanding UI error, or ``null`` to clear any "
            "previously stored error. Optional — pre-Phase-3J runners omit it."
        ),
    )


class RunnerResponse(BaseORMSchema):
    """Safe view of a registered runner."""

    id: UUID
    user_id: UUID
    name: str
    hostname: str
    port: int
    capabilities: list[str]
    server_mode: bool
    restate_enabled: bool
    restate_healthy: bool
    last_heartbeat: IsoDatetime | None = None
    status: str
    derived_status: str | None = None
    ui_error: dict[str, Any] | None = None
    created_at: IsoDatetime
