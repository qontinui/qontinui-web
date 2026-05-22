"""Pydantic schemas for the single-use pair-code surface.

Phase 2a.1 of plan
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.

Two endpoints back these schemas:

* ``POST /api/v1/devices/pair-codes`` (operator JWT required) — mints a
  fresh 6-char code with a 5-minute TTL. Request body is empty; tenant +
  issuer are resolved server-side from the auth context.
* ``POST /api/v1/devices/pair-codes/{code}/redeem`` (no operator JWT) —
  the runner posts ``(device_id, hostname)`` and gets back the canonical
  ``PairCompleteResponse`` shape (``user_id, tenant_id, device_id,
  expires_at, device_token_jwt``). The response mirrors what
  ``pair-cli`` returns so the runner can use the same decoder for both
  paths.
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime


class PairCodeMintIn(BaseModel):
    """Request body for ``POST /api/v1/devices/pair-codes``.

    No fields — tenant and issuer come from the authenticated user's
    JWT. The shape is reserved for forward-compat (e.g. future "label"
    or "ttl_override" fields).
    """

    model_config = ConfigDict(extra="forbid")


class PairCodeMintOut(BaseModel):
    """Response body for ``POST /api/v1/devices/pair-codes``."""

    code: str = Field(
        ...,
        min_length=6,
        max_length=6,
        description=("Uppercase 6-char code from the 32-char unambiguous alphabet."),
    )
    expires_at: IsoDatetime = Field(
        ...,
        description="UTC expiry; 5 minutes after mint.",
    )


class PairCodeRedeemIn(BaseModel):
    """Request body for ``POST /api/v1/devices/pair-codes/{code}/redeem``.

    The runner asserts the ``device_id`` it has on disk (from
    ``~/.qontinui/machine.json``) plus its hostname. The web backend
    verifies the code is valid, single-use, and unexpired, then forwards
    through to coord's ``pair-cli`` with ``tenant_id`` injected from the
    code row.
    """

    model_config = ConfigDict(extra="forbid")

    device_id: UUID = Field(
        ...,
        description=("Stable device UUID the runner generated on first launch."),
    )
    hostname: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Runner hostname (display + audit).",
    )


class PairCodeRedeemOut(BaseModel):
    """Response body for ``POST /api/v1/devices/pair-codes/{code}/redeem``.

    Mirrors the canonical ``PairCompleteResponse`` shape that the
    runner's ``pair.rs::PairCompleteResponse`` decoder consumes:
    ``{ user_id, tenant_id, device_id, expires_at, device_token_jwt }``.
    The runner uses the same decoder for both the paste-pair and the
    headless ``pair-cli`` paths.
    """

    user_id: UUID = Field(..., description="Operator who minted the code.")
    tenant_id: UUID = Field(..., description="Tenant burned in at mint time.")
    device_id: UUID = Field(..., description="The runner's device UUID.")
    expires_at: IsoDatetime | None = Field(
        default=None,
        description="Device JWT expiry (unix-seconds-precision ISO 8601).",
    )
    device_token_jwt: str = Field(
        ...,
        description="Coord-issued device-token JWT.",
    )
