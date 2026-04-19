"""Schemas for phase-result ingestion and retrieval.

Mirrors the runner-side ``PhaseResult`` / ``StepResultRecord`` structs in
``qontinui-runner/src-tauri/src/unified_workflow_executor/types.rs`` and
adds the shapes used by the web API read endpoints.
"""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field
from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import BeforeValidator

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

UuidAsString = Annotated[
    str,
    BeforeValidator(lambda v: str(v) if v is not None else None),
    PlainSerializer(lambda v: str(v) if v is not None else None, return_type=str),
]


PhaseLiteral = Literal["setup", "verification", "agentic", "completion"]


class StepResultRecord(BaseSchema):
    """Per-step record embedded inside a :class:`PhaseResultIngestRequest`.

    Intentionally permissive on the identifier fields — the runner-side
    ``StepResultRecord`` uses ``step_index`` (usize) and ``step_name`` (Option),
    while this schema additionally accepts a ``step_id`` string for workflows
    that identify steps by id. All three are optional to keep forward/backward
    compatibility.
    """

    step_id: str | None = None
    step_index: int | None = None
    step_type: str
    step_name: str | None = None
    success: bool | None = None
    error: str | None = None
    output_data: dict[str, Any] | None = None
    duration_ms: int = Field(..., ge=0)
    # Runner emits this as ``Vec<(String, String)>`` which serializes to
    # ``list[list[str]]`` in JSON. Accept either list-of-pairs or dict form.
    variables_set: list[list[str]] | dict[str, Any] | None = None


class PhaseResultIngestRequest(BaseSchema):
    """Request body for ``POST /api/v1/events/phase-completed``.

    ``runner_id`` is optional: when set, the ingest handler attributes the
    row to that specific runner (after verifying the authenticated token's
    user owns it); when absent, the handler falls back to the legacy
    "most-recently-heartbeated" selection for back-compat.
    """

    runner_id: UUID | None = None
    execution_id: str = Field(..., min_length=1, max_length=255)
    phase: PhaseLiteral
    iteration: int | None = None
    stage_index: int | None = None
    success: bool
    all_passed: bool
    duration_ms: int = Field(..., ge=0)
    failure_context: str | None = None
    commit_hash: str | None = Field(None, max_length=64)
    step_results: list[StepResultRecord] = Field(default_factory=list)
    variables_set: list[list[str]] | dict[str, Any] | None = None


class PhaseResultResponse(BaseORMSchema):
    """Full phase-result record for read APIs."""

    id: UuidAsString
    runner_id: UuidAsString | None = None
    execution_id: str
    phase: str
    iteration: int | None = None
    stage_index: int | None = None
    success: bool
    all_passed: bool
    duration_ms: int
    failure_context: str | None = None
    commit_hash: str | None = None
    step_results: list[dict[str, Any]]
    variables_set: list[list[str]] | dict[str, Any] | None = None
    created_at: IsoDatetime
