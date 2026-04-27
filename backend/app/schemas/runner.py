"""
Pydantic schemas for the unified runner API surface (Phase 2B).

The canonical wire shape — a runner row as seen by every consumer (web,
mobile, runner UI) — comes from the generated
``qontinui_schemas.generated.per_type.runner.Runner`` model. Importing
the canonical type rather than redefining it keeps web, mobile, and
runner type-coherent without manual sync.

This module only defines slim *request* schemas (dispatch, session
history filters) — the response side simply returns the canonical
``Runner``.
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime


class DispatchRunnerRequest(BaseModel):
    """Request body for ``POST /api/v1/runners/{id}/dispatch``."""

    workflow_id: UUID = Field(..., description="Workflow to dispatch to the runner.")
    payload: dict | None = Field(
        default=None,
        description="Optional opaque payload forwarded verbatim to the runner.",
    )


class DispatchRunnerResponse(BaseModel):
    """Response body for ``POST /api/v1/runners/{id}/dispatch``."""

    run_id: str = Field(..., description="Server-side identifier for this dispatch.")
    dispatched_at: IsoDatetime
    transport: str = Field(
        ...,
        description="Transport used: ``ws`` (preferred) or ``http`` (fallback).",
    )


class RunnerSessionResponse(BaseModel):
    """Slim response shape for one row in the runner sessions audit log."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    runner_id: UUID
    user_id: UUID
    connected_at: IsoDatetime
    disconnected_at: IsoDatetime | None
    duration_seconds: int | None
    ip_address: str | None
    project_id: UUID | None
    session_id: str | None
