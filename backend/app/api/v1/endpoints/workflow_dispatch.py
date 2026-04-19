"""
Workflow dispatch API — user-triggered routing of workflows to server-mode
runners.

``POST /api/v1/workflows/{workflow_id}/dispatch``

After Phase 3D this endpoint is a thin HTTP shell around
:func:`app.services.workflow_dispatcher.dispatch_workflow_to_runner`. The
runner-resolution, ownership-check, and outbound HTTP POST logic live in
that service so the Phase 3D Celery task (scheduled dispatch) can call the
same code path.

The endpoint still owns:

* FastAPI plumbing (auth dependency, path parameter binding).
* Translation of :class:`DispatchError` into ``HTTPException`` with the
  exact shape Phase 3C's tests assert on (404 / 409 / 502 / 503 / 504
  with ``detail["code"]``).
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.workflow_dispatch import (
    WorkflowDispatchRequest,
    WorkflowDispatchResponse,
)
from app.services.workflow_dispatcher import (
    DispatchError,
    dispatch_workflow_to_runner,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/{workflow_id}/dispatch",
    response_model=WorkflowDispatchResponse,
    status_code=status.HTTP_200_OK,
    summary="Dispatch a workflow to a server-mode runner",
)
async def dispatch_workflow(
    *,
    workflow_id: UUID,
    payload: WorkflowDispatchRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Route ``workflow_id`` to a server-mode runner and return the result.

    See :mod:`app.services.workflow_dispatcher` for the target-resolution
    and health rules — this function only handles HTTP plumbing.
    """
    try:
        return await dispatch_workflow_to_runner(
            db,
            user_id=current_user.id,
            workflow_id=workflow_id,
            target=payload.target,
            parent_task_run_id=payload.parent_task_run_id,
        )
    except DispatchError as err:
        raise HTTPException(status_code=err.status_code, detail=err.detail)
