"""
Pydantic schemas for the Phase 3D scheduled-workflow-runs API.

Shapes:

* :class:`ScheduledWorkflowRunCreate`  — body for ``POST /scheduled-runs``.
* :class:`ScheduledWorkflowRunUpdate`  — body for ``PATCH /scheduled-runs/{id}``.
  All fields optional — callers send only the fields that change.
* :class:`ScheduledWorkflowRunResponse` — read shape returned by all endpoints.

Cron validation: every ``cron_expression`` field is validated with
``croniter.is_valid`` (5-field classic cron, UTC-based). We do *not* accept
the 6-field "with seconds" variant — Celery's own ``crontab`` object only
supports minute-granularity, and silently promoting a 6-field expression to
a 5-field one would be confusing.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from croniter import croniter  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field, field_validator


def _validate_cron_expression(value: str) -> str:
    """Raise ValueError unless ``value`` is a valid 5-field cron expression.

    Accepts trimmed strings; a 5-field split is required (rejects the
    6-field "seconds" variant that some croniter callers use).
    """
    stripped = value.strip()
    if not stripped:
        raise ValueError("cron_expression must not be empty")
    fields = stripped.split()
    if len(fields) != 5:
        raise ValueError(
            "cron_expression must have exactly 5 fields "
            "(minute hour day-of-month month day-of-week)"
        )
    if not croniter.is_valid(stripped):
        raise ValueError(f"cron_expression is not a valid cron: {stripped!r}")
    return stripped


class ScheduledWorkflowRunBase(BaseModel):
    """Fields shared by create/update/response shapes."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    cron_expression: str = Field(
        ...,
        description=(
            "5-field cron expression (minute hour dom month dow), evaluated "
            "in UTC by redbeat."
        ),
    )
    target: Literal["auto"] | UUID = Field(
        default="auto",
        description=(
            "Either 'auto' (pick the healthiest owned runner at fire time) "
            "or the UUID of an owned runner."
        ),
    )
    enabled: bool = True

    @field_validator("cron_expression")
    @classmethod
    def _check_cron(cls, v: str) -> str:
        return _validate_cron_expression(v)


class ScheduledWorkflowRunCreate(ScheduledWorkflowRunBase):
    """POST body: create a new scheduled run for ``workflow_id``."""

    workflow_id: UUID


class ScheduledWorkflowRunUpdate(BaseModel):
    """PATCH body: every field optional, only supplied fields mutate.

    Not a subclass of :class:`ScheduledWorkflowRunBase` because we need every
    field to be optional without redefining the base.
    """

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    cron_expression: str | None = None
    target: Literal["auto"] | UUID | None = None
    enabled: bool | None = None

    @field_validator("cron_expression")
    @classmethod
    def _check_cron(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _validate_cron_expression(v)


class ScheduledWorkflowRunResponse(ScheduledWorkflowRunBase):
    """Response shape — ORM-populated, plus last-fire bookkeeping.

    ``target`` is returned as a string: the DB column is a ``VARCHAR`` that
    holds either ``"auto"`` or a UUID string, so the type here widens from
    ``Literal["auto"] | UUID`` (the input shape) to ``str`` on the way out
    — callers that need to interpret it can parse.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workflow_id: UUID
    target: str  # type: ignore[assignment]
    last_fired_at: datetime | None
    last_execution_id: str | None
    last_status: str | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime
