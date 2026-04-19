"""
Pydantic schemas for the server-mode runner fleet registry.

Kept separate from :mod:`app.schemas.runner` (which owns the older
``RunnerConnection`` websocket-history API) to avoid conflating the two
models.
"""

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


class RunnerHeartbeatRequest(BaseSchema):
    """Request body for ``POST /runners/{runner_id}/heartbeat``."""

    restate_healthy: bool
    status: str = Field(
        ...,
        min_length=1,
        max_length=32,
        description="Runner status — typically one of: healthy, unhealthy, offline",
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
    created_at: IsoDatetime
