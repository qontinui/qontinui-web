"""
Pydantic schemas for the user-triggered workflow dispatch API.

``POST /api/v1/workflows/{workflow_id}/dispatch`` accepts a
:class:`WorkflowDispatchRequest`, routes the workflow to a server-mode runner
the authenticated user owns, and returns a :class:`WorkflowDispatchResponse`
describing where it was dispatched. The per-runner ``dispatch_secret`` is
never included in the response — leak-risk scoping.
"""

from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IsoDatetime


class WorkflowDispatchRequest(BaseSchema):
    """Request body for ``POST /api/v1/workflows/{workflow_id}/dispatch``.

    ``target`` is either the literal string ``"auto"`` (pick the healthiest
    server-mode runner owned by the current user) or the UUID of a specific
    runner the user owns.
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
    """Response to a successful workflow dispatch.

    Does NOT include ``dispatch_secret`` — the secret is internal to the
    web ↔ runner link and must not be surfaced to the end user.
    """

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
