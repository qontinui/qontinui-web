"""Pydantic schemas for the UI Bridge co-pilot activity API (§4.8).

The activity feed surfaces one row per write command the relay route
inserts (``web.bridge_audit_log``). Two operations:

* ``POST`` — relay-internal insert. Called server-to-server by the
  ``/api/ui-bridge/*`` Next.js handler after the auth gate verified the
  caller; payload carries only SAFE summaries (never raw text).
* ``GET``  — user-facing read. Scoped to the calling user; cursor-paginated
  by ``occurred_at DESC``.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime


class BridgeAuditLogCreate(BaseModel):
    """Server-to-server insert payload from the Next.js relay route."""

    session_id: str | None = Field(
        None,
        max_length=128,
        description="JWT jti when available; null on legacy tokens.",
    )
    tab_id: str | None = Field(
        None,
        max_length=128,
        description="SDK-side tab id the command targeted, when present.",
    )
    command_name: str = Field(
        ...,
        max_length=128,
        description=(
            "Canonical command name extracted from the path "
            "(e.g. element.action, page.navigate, ai.find, batch.execute)."
        ),
    )
    target_element_id: str | None = Field(
        None,
        max_length=256,
        description="The UI Bridge element id, when the command names one.",
    )
    path: str = Field(
        ..., max_length=512, description="The full /api/ui-bridge/<path> requested."
    )
    method: str = Field(..., max_length=16, description="HTTP method.")
    origin: str | None = Field(
        None, max_length=256, description="Request Origin header (browser-set)."
    )
    status_code: int = Field(..., description="HTTP status the relay returned.")
    execution_status: Literal["received", "executed", "failed"] = Field(
        "received",
        description=(
            "Execution outcome distinct from receipt (Bug 3b). `status_code` "
            "is the relay-delivery HTTP status (200 on delivery); this records "
            "whether the target tab actually RAN the command: `received` "
            "(delivered, outcome unknown — the default), `executed` (tab "
            "confirmed it ran), or `failed` (tab reported it did NOT run, even "
            "if status_code is 200)."
        ),
    )
    payload_summary: dict[str, Any] | None = Field(
        None,
        description=(
            "SAFE summary of the request body. NEVER the raw payload — "
            "the middleware logs the fact, not the secret."
        ),
    )


class BridgeAuditLogResponse(BaseModel):
    """Single row in the user-facing activity feed."""

    id: UUID
    session_id: str | None
    tab_id: str | None
    command_name: str
    target_element_id: str | None
    path: str
    method: str
    origin: str | None
    status_code: int
    execution_status: str
    occurred_at: IsoDatetime
    payload_summary: dict[str, Any] | None

    model_config = ConfigDict(from_attributes=True)


class BridgeAuditLogListResponse(BaseModel):
    """Cursor-paginated activity feed response."""

    items: list[BridgeAuditLogResponse]
    next_before: datetime | None = Field(
        None,
        description=(
            "Cursor for the next page: pass back as `?before=` to fetch "
            "older rows. Null when no further rows exist."
        ),
    )
