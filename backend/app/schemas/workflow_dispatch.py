"""
Pydantic schemas for the user-triggered workflow dispatch API.

``POST /api/v1/runners/{runner_id}/dispatch`` accepts a
:class:`WorkflowDispatchRequest`, sends a typed ``dispatch`` message
over the runner's WebSocket, and returns a
:class:`WorkflowDispatchResponse` describing where it was dispatched.
"""

from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IsoDatetime


class WorkflowDispatchRequest(BaseSchema):
    """Request body for ``POST /api/v1/runners/{runner_id}/dispatch``.

    ``target`` is either the literal string ``"auto"`` (pick the healthiest
    runner owned by the current user) or the UUID of a specific runner the
    user owns.
    """

    target: Literal["auto"] | UUID = Field(
        default="auto",
        description=(
            "Either 'auto' to pick the healthiest owned runner, or an "
            "explicit runner UUID."
        ),
    )
    parent_task_run_id: str | None = Field(
        default=None,
        description=(
            "Opaque parent task-run id forwarded to the runner, for nested "
            "dispatch trees."
        ),
    )


class WorkflowDispatchResponse(BaseSchema):
    """Response to a successful workflow dispatch."""

    execution_id: str
    runner_id: UUID
    runner_hostname: str
    runner_port: int
    dispatched_at: IsoDatetime
    task_run_id: UUID | None = Field(
        default=None,
        description=(
            "Locally-created task_run row, if the current schema allows "
            "storing the external execution id. Currently always None — "
            "TaskRun lacks an external_execution_id column. Kept in the "
            "response shape for forward-compatibility."
        ),
    )
