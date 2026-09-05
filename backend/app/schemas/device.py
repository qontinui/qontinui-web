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
from qontinui_schemas.generated.per_type.runner import Runner as RunnerWire

from app.schemas.base import IsoDatetime


class DeviceTenantBinding(BaseModel):
    """One tenant a device is paired to, as coord reports it.

    Mirrors one element of the ``tenant_bindings`` array on coord's
    ``GET /coord/devices/by-user`` rows (``coord.tenant_devices``).
    """

    tenant_id: str = Field(..., description="Tenant identifier (UUID as a string).")
    tenant_slug: str | None = Field(
        default=None,
        description="Tenant slug when coord resolved one; ``null`` otherwise.",
    )
    last_active_at: str | None = Field(
        default=None,
        description=(
            "RFC 3339 timestamp of the binding's last activity; ``null`` when "
            "coord holds none."
        ),
    )


class DeviceResponse(RunnerWire):
    """Response shape for ``GET /api/v1/devices`` and ``GET /api/v1/devices/{id}``.

    The canonical ``Runner`` wire entity from ``qontinui_schemas`` (which
    forbids extra keys, so it cannot be extended in place) plus the web's own
    per-device tenant-binding presentation, sourced from coord's
    ``GET /coord/devices/by-user``.

    ``tenant_bindings`` is **tri-state** and every consumer must keep it so:

    * ``null`` — UNKNOWN. Coord did not hydrate bindings (its
      ``coord.tenant_devices`` table is absent, or it predates the field).
      Never render this as "no tenants".
    * ``[]`` — coord measured ZERO bindings for this device.
    * a non-empty list — the tenants the device is paired to.
    """

    tenant_bindings: list[DeviceTenantBinding] | None = Field(
        default=None,
        description=(
            "Tenants this device is paired to. ``null`` means coord did not "
            "report bindings (UNKNOWN, never zero); ``[]`` means coord measured "
            "zero bindings."
        ),
    )


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


class DeviceIdentityResponse(BaseModel):
    """Response shape for ``GET /api/v1/devices/me``.

    The device-principal identity resolved from a coord-issued device-token
    JWT: the device's own id, the paired operator (owning user), and the
    tenant the device belongs to. All three are emitted as UUID strings so
    the relay's ``_auth.ts`` can use them directly as a principal.
    """

    device_id: str
    user_id: str
    tenant_id: str


class PairConfirmRequest(BaseModel):
    """Request body for ``POST /api/v1/devices/pair-confirm``.

    Issued by the ``/connect-runner`` page after the user clicks
    "Connect". The web backend forwards ``(state, device_id)`` to coord's
    ``POST /coord/devices/pair-complete`` under its service token plus
    ``X-Qontinui-User-Id`` (the signed-in user), and coord returns the
    device-token JWT once it has verified that user's membership in the
    flow's tenant.
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
    device_machine_key: str | None = Field(
        default=None,
        description=(
            "Long-lived device machine key (``dmk_<token>``) auto-minted at "
            "pairing so a runner offline past its Cognito refresh window can "
            "still exchange for a device JWT with no user session (4b "
            "cold-start recovery). Returned ONCE — the plaintext is "
            "unrecoverable thereafter. ``None`` when auto-mint is unavailable "
            "(the runner falls back to the interactive re-login path)."
        ),
    )


class DeviceMachineCredentialMintResponse(BaseModel):
    """Response body for ``POST /api/v1/devices/{id}/machine-credential/mint``.

    Delivers the freshly minted plaintext ``dmk_`` key exactly ONCE (only its
    hash + prefix are persisted; the plaintext is unrecoverable after this
    response). The ``prefix`` is a non-secret display fragment the owner can
    use to recognize the key; ``expires_at`` is when the key lapses (renewed
    opportunistically on each successful exchange).
    """

    device_id: UUID
    device_machine_key: str = Field(
        ..., description="Plaintext ``dmk_`` key — returned ONCE, never again."
    )
    prefix: str = Field(..., description="Non-secret display prefix (first 14 chars).")
    expires_at: IsoDatetime | None = Field(
        default=None, description="When the key lapses (UTC), or null if none."
    )


class DeviceMachineCredentialExchangeResponse(BaseModel):
    """Response body for ``POST /api/v1/devices/{id}/machine-credential/exchange``.

    The device JWT minted by coord (via web's trusted service token) in
    exchange for a valid ``dmk_``. Shape mirrors the ``token`` the runner
    already stores from the pairing flow, so the runner reuses its existing
    device-JWT handling.
    """

    token: str = Field(..., description="Coord-issued device-token JWT.")
