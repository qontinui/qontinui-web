"""Pydantic schemas for the unified device API surface.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
replaces the previous ``schemas/runner.py`` + ``schemas/runner_token.py``.

The canonical wire shape for a device row continues to come from
``qontinui_schemas`` (Phase 7 of the plan will rename the generated
module from ``per_type/runner.py`` → ``per_type/device.py``; until that
ships, the legacy ``Runner`` types are reused here for the response
payload).
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime


class DispatchDeviceRequest(BaseModel):
    """Request body for ``POST /api/v1/devices/{id}/dispatch``."""

    workflow_id: UUID = Field(..., description="Workflow to dispatch to the device.")
    payload: dict | None = Field(
        default=None,
        description="Optional opaque payload forwarded verbatim to the device.",
    )


class DispatchDeviceResponse(BaseModel):
    """Response body for ``POST /api/v1/devices/{id}/dispatch``."""

    run_id: str = Field(..., description="Server-side identifier for this dispatch.")
    dispatched_at: IsoDatetime
    transport: str = Field(
        ...,
        description="Transport used: ``ws`` (preferred) or ``http`` (fallback).",
    )


class DeviceConnectionResponse(BaseModel):
    """Slim response shape for one row in the device connections audit log."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: UUID
    user_id: UUID
    connected_at: IsoDatetime
    disconnected_at: IsoDatetime | None
    duration_seconds: int | None
    ip_address: str | None
    project_id: UUID | None
    session_id: str | None


class PairConfirmRequest(BaseModel):
    """Request body for ``POST /api/v1/devices/pair-confirm``.

    Issued by the ``/connect-runner`` page after the user clicks
    "Connect". The web backend forwards ``(state, user_id)`` to coord's
    ``POST /coord/devices/pair-complete``, which returns the
    device-token JWT.
    """

    state: str = Field(
        ...,
        min_length=8,
        max_length=128,
        description="Pairing-flow nonce minted by coord's pair-start endpoint.",
    )
    device_name: str | None = Field(
        default=None,
        max_length=255,
        description="User-supplied display name (defaults to runner hostname).",
    )


class PairConfirmResponse(BaseModel):
    """Response body for ``POST /api/v1/devices/pair-confirm``.

    The browser receives this and redirects the runner's local callback
    server to
    ``callback?state=<state>&token=<jwt>&token_id=<device_id>``.
    """

    device_id: UUID
    token: str = Field(..., description="Coord-issued device-token JWT.")
    state: str = Field(..., description="Echoed pairing-flow nonce.")
