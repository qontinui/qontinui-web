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
from qontinui_schemas.generated.per_type.runner import (
    Runner as RunnerWire,
)

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


class DeviceWire(RunnerWire):
    """Device list/detail wire shape — the canonical ``Runner`` payload
    plus an explicit live-reachability projection.

    Additive over :class:`qontinui_schemas...Runner`: every existing field
    (``id``, ``derivedStatus``, ``wsConnected``, ``lastHeartbeat``, …) is
    inherited unchanged. The three fields below are appended so the mobile
    app (and any UI) can show whether a *registered* runner is actually
    *reachable* via the runner-proxy relay, not merely paired:

    * ``online`` — ``True`` iff the device currently holds a live runner WS
      session (``coord.devices.ws_session_id IS NOT NULL`` — the exact
      predicate the runner-proxy relay checks before dispatching, see
      ``device_bridge_ws._runner_proxy_relay``). Falls back to
      heartbeat-freshness when no live WS session id is recorded.
    * ``connectionStatus`` — coarse string projection of ``online``:
      ``"connected"`` | ``"stale"`` | ``"offline"`` for display.
    * ``lastSeen`` — ISO 8601 timestamp of the most recent liveness signal
      (``ws_connected_at`` / ``last_heartbeat`` / ``last_seen_at``,
      whichever is newest), or ``None`` if the device was never seen.
    """

    model_config = ConfigDict(extra="forbid")

    online: bool = Field(
        ...,
        description=(
            "Whether the runner currently holds a live device-bridge / "
            "runner WebSocket session and is therefore reachable via the "
            "runner-proxy relay. Sourced from `ws_session_id IS NOT NULL`, "
            "with a heartbeat-freshness fallback."
        ),
    )
    connectionStatus: str = Field(
        ...,
        description=(
            'Coarse connection state for display: "connected" (live WS), '
            '"stale" (recent heartbeat but no live WS), or "offline".'
        ),
    )
    lastSeen: str | None = Field(
        default=None,
        description=(
            "ISO 8601 timestamp of the most recent liveness signal "
            "(WS connect / heartbeat / last_seen), or null if never seen."
        ),
    )


class PairConfirmRequest(BaseModel):
    """Request body for ``POST /api/v1/devices/pair-confirm``.

    Issued by the ``/connect-runner`` page after the user clicks
    "Connect". The web backend forwards ``(state, user_id, device_id,
    web_session_token)`` to coord's ``POST /coord/devices/pair-complete``,
    which returns the device-token JWT.
    """

    state: str = Field(
        ...,
        min_length=8,
        max_length=128,
        description="Pairing-flow nonce minted by coord's pair-start endpoint.",
    )
    device_id: str = Field(
        ...,
        description="Device UUID from machine.json, forwarded by the runner via the redirect URL.",
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


class PairCliRequest(BaseModel):
    """Request body for ``POST /api/v1/devices/pair-cli``.

    Headless analogue of the browser-mediated pair-confirm flow: the
    runner authenticates with its existing user access token (no browser
    redirect) and asks the web backend to mint a device-token JWT via
    coord. The backend resolves the calling user's ``tenant_id`` and
    proxies the request to coord's ``POST /coord/devices/pair-cli``.

    The runner sends the same ``(device_id, hostname, name)`` triple it
    used to send directly to coord; ``tenant_id`` and ``user_id`` are
    injected server-side so the runner never has to know about tenancy.
    """

    device_id: UUID = Field(
        ...,
        description="Stable device UUID the runner generated on first launch.",
    )
    hostname: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Runner's hostname (used for display + audit).",
    )
    name: str | None = Field(
        default=None,
        max_length=255,
        description="Optional display name; defaults to hostname server-side.",
    )


class PairCliResponse(BaseModel):
    """Response body for ``POST /api/v1/devices/pair-cli``.

    Mirrors :class:`PairConfirmResponse` minus the ``state`` echo
    (headless flow has no pairing nonce), plus a ``user_id`` echo so the
    runner-side ``PairCompleteResponse`` decoder (which has been
    ``{token, user_id, device_id?}`` shaped since the unify-devices
    migration) doesn't need a new variant. The runner stores the
    returned ``token`` as its device-JWT and uses it on the
    ``/api/v1/devices/ws`` connection.
    """

    device_id: UUID
    token: str = Field(..., description="Coord-issued device-token JWT.")
    user_id: UUID = Field(
        ..., description="Calling user's UUID, echoed for the runner's decoder."
    )
