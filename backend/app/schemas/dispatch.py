"""Fleet-fresh P4 dispatcher schemas — freshness-aware test-host routing."""

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class DispatchStrategyEnum(StrEnum):
    """Fresh-host selection strategy."""

    FRESH_ONLY = "fresh_only"  # 503 if no fresh host
    BEST_EFFORT = "best_effort"  # fall back to any healthy owned runner


class FreshHostResponse(BaseModel):
    """A resolved test host for an app."""

    device_id: UUID = Field(..., description="Selected runner device")
    device_name: str = Field(..., description="Device display name")
    hostname: str = Field(..., description="Device hostname")
    port: int | None = Field(None, description="Runner HTTP port (if published)")
    freshness_status: str = Field(
        ...,
        description="'fresh' (deployed_sha == upstream HEAD) or 'fallback' "
        "(best_effort landed on a non-fresh healthy host)",
    )


class DispatchStatusResponse(BaseModel):
    """Dispatch diagnostics for an app (dashboard / debugging)."""

    app_id: str
    fresh_hosts_count: int = Field(..., description="Owned healthy hosts with fresh deployment")
    can_dispatch_fresh: bool
