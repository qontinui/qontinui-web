"""Wire models for "which of my devices should this work run on?".

Plan ``2026-09-20-runner-selector-drives-a-transport-not-a-target`` Phase 3.
The web backend's ``POST /api/v1/devices/resolve`` forwards to coord's
``POST /coord/devices/resolve`` (qontinui-coord ``device_resolve.rs``) and
answers with the same typed outcome, plus ONE outcome coord never sends:
``unavailable`` — the resolver could not be asked or did not answer (coord
unreachable, the door not deployed yet, a refused credential, a 5xx, a body
that is not the contract). ``unavailable`` is UNKNOWN: it names no device, and
a caller must never turn it into a pick of its own.

The request mirrors coord's body exactly and deliberately has NO ``user_id``:
coord derives the user from the forwarded bearer (plan D3), and refuses a body
carrying one ``400 user_id_not_accepted``. ``extra="forbid"`` keeps a browser
from smuggling one through this door either.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, RootModel

WorkClass = Literal["machine_bound", "placeable"]
"""``machine_bound`` — an ineligible pin is refused, never re-targeted (plan D2).
``placeable`` — an ineligible pin is released and the pool pick says so."""

PinIneligibility = Literal[
    "not_a_paired_device", "offline", "missing_capabilities", "drained"
]


class DeviceResolveRequest(BaseModel):
    """The body the browser (and the dispatcher) sends; forwarded verbatim."""

    model_config = ConfigDict(extra="forbid")

    required_capabilities: list[str] = Field(
        ...,
        max_length=64,
        description="Capability tokens every candidate must advertise. "
        "Required (may be empty) so no caller is capability-blind by omission.",
    )
    preferred_device: UUID | None = Field(
        default=None, description="The user's pin; still has to pass eligibility."
    )
    work_class: WorkClass


class ResolvedOutcome(BaseModel):
    outcome: Literal["resolved"] = "resolved"
    device_id: UUID
    via: Literal["pin", "pool"]
    pin_released_reason: PinIneligibility | None = None
    pin_released_detail: str | None = None


class PinIneligibleOutcome(BaseModel):
    outcome: Literal["pin_ineligible"] = "pin_ineligible"
    device_id: UUID
    reason: PinIneligibility
    detail: str
    missing_capabilities: list[str] = Field(default_factory=list)


class NoCapableDeviceOutcome(BaseModel):
    outcome: Literal["no_capable_device"] = "no_capable_device"
    missing: list[str] = Field(default_factory=list)
    online_devices: int
    pin_released_reason: PinIneligibility | None = None
    pin_released_detail: str | None = None


class AllCapableDrainedOutcome(BaseModel):
    outcome: Literal["all_capable_drained"] = "all_capable_drained"
    pin_released_reason: PinIneligibility | None = None
    pin_released_detail: str | None = None


class DrainUnreadableOutcome(BaseModel):
    outcome: Literal["drain_unreadable"] = "drain_unreadable"


UnavailableReason = Literal[
    "no_credential",
    "coord_unreachable",
    "not_deployed",
    "refused",
    "upstream_error",
    "malformed_response",
    "misconfigured",
]


class UnavailableOutcome(BaseModel):
    """The resolver was not answered — UNKNOWN, never a pick.

    - ``no_credential``      — no caller bearer to forward (e.g. a scheduled
                               job with no request behind it).
    - ``coord_unreachable``  — connect error or timeout.
    - ``not_deployed``       — coord answered 404/405: the door is not on the
                               running coord build yet.
    - ``refused``            — coord refused the principal (401/403) or the
                               body (400); ``code`` carries coord's error code.
    - ``upstream_error``     — coord answered 5xx.
    - ``malformed_response`` — a 200 that is not the contract.
    - ``misconfigured``      — the coord base URL is unset or not a URL.
    """

    outcome: Literal["unavailable"] = "unavailable"
    reason: UnavailableReason
    status: int | None = Field(default=None, description="Coord's HTTP status, if any.")
    code: str | None = Field(default=None, description="Coord's error code, if any.")


CoordResolveOutcome = Annotated[
    ResolvedOutcome
    | PinIneligibleOutcome
    | NoCapableDeviceOutcome
    | AllCapableDrainedOutcome
    | DrainUnreadableOutcome,
    Field(discriminator="outcome"),
]
"""Exactly what coord answers with a 200."""

DeviceResolveResult = (
    ResolvedOutcome
    | PinIneligibleOutcome
    | NoCapableDeviceOutcome
    | AllCapableDrainedOutcome
    | DrainUnreadableOutcome
    | UnavailableOutcome
)
"""Any answer the web door can give (for typing service code)."""

DeviceResolveOutcome = Annotated[DeviceResolveResult, Field(discriminator="outcome")]
"""What the web door answers — coord's outcomes plus ``unavailable``."""


class CoordResolveBody(RootModel[CoordResolveOutcome]):
    """Parser for coord's 200 body."""


class DeviceResolveResponse(RootModel[DeviceResolveOutcome]):
    """``POST /api/v1/devices/resolve`` — always 200, switch on ``outcome``."""
