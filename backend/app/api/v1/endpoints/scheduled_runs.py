"""Scheduled workflow runs API — Phase 3D.

Routes under ``/api/v1/scheduled-runs``:

* ``POST   /scheduled-runs``        — create
* ``GET    /scheduled-runs``        — list (query param ``workflow_id=<uuid>``)
* ``GET    /scheduled-runs/{id}``   — detail
* ``PATCH  /scheduled-runs/{id}``   — partial update
* ``DELETE /scheduled-runs/{id}``   — delete
* ``POST   /scheduled-runs/{id}/run-now`` — fire immediately

All endpoints are user-authenticated. CRUD ownership is enforced in the
service layer (:mod:`app.crud.scheduled_workflow_run_crud`).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import scheduled_workflow_run_crud as crud
from app.models.user import User
from app.schemas.scheduled_workflow_run import (
    ScheduledWorkflowRunCreate,
    ScheduledWorkflowRunResponse,
    ScheduledWorkflowRunUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "",
    response_model=ScheduledWorkflowRunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new scheduled workflow run",
)
async def create_scheduled_run(
    *,
    payload: ScheduledWorkflowRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a cron-driven dispatch for a workflow."""
    return await crud.create_scheduled_run(db, current_user.id, payload)


@router.get(
    "",
    response_model=list[ScheduledWorkflowRunResponse],
    summary="List scheduled workflow runs",
)
async def list_scheduled_runs(
    *,
    workflow_id: UUID | None = Query(
        default=None,
        description="Optional: filter to schedules for a single workflow.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all scheduled runs owned by the caller."""
    return await crud.list_scheduled_runs(db, current_user.id, workflow_id=workflow_id)


@router.get(
    "/{run_id}",
    response_model=ScheduledWorkflowRunResponse,
    summary="Get a scheduled workflow run",
)
async def get_scheduled_run(
    *,
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Return a single scheduled run by id."""
    row = await crud.get_scheduled_run(db, current_user.id, run_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scheduled run not found: {run_id}",
        )
    return row


@router.patch(
    "/{run_id}",
    response_model=ScheduledWorkflowRunResponse,
    summary="Update a scheduled workflow run",
)
async def update_scheduled_run(
    *,
    run_id: UUID,
    payload: ScheduledWorkflowRunUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Partially update a scheduled run."""
    return await crud.update_scheduled_run(db, current_user.id, run_id, payload)


@router.delete(
    "/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a scheduled workflow run",
)
async def delete_scheduled_run(
    *,
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete a scheduled run. The row IS the schedule — nothing else to tear down."""
    await crud.delete_scheduled_run(db, current_user.id, run_id)


@router.post(
    "/{run_id}/run-now",
    status_code=status.HTTP_200_OK,
    summary="Fire a scheduled run immediately (bypasses the cron schedule)",
)
async def run_scheduled_run_now(
    *,
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> dict[str, Any]:
    """Run the same dispatch the scheduler fires at cron time — synchronously.

    Dispatch is one HTTP call to a runner, so we await it and return the REAL
    outcome. The previous implementation enqueued a Celery task and returned a
    ``task_id`` for work that — with no worker ever deployed — never executed.

    A failed dispatch is an HTTP ERROR, not a 200 with ``status: "failed"`` in the
    body. The caller asked us to run the workflow; if the runner is offline we
    have not run it, and saying "200 OK" would be a lie the client cannot even
    parse (it expects a dispatch payload and would dereference a missing
    ``execution_id``). We surface the dispatcher's own status code instead.

    Does NOT touch ``next_fire_at``: an out-of-band manual fire must not shift
    the cron schedule.
    """
    from app.jobs.scheduled_dispatch import fire_scheduled_run

    row = await crud.get_scheduled_run(db, current_user.id, run_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scheduled run not found: {run_id}",
        )

    result = await fire_scheduled_run(str(row.id))
    outcome = result.get("status")
    logger.info(
        "scheduled_run_run_now_complete", run_id=str(run_id), status=outcome
    )

    if outcome == "dispatched":
        return {"scheduled_run_id": str(row.id), **result}

    if outcome == "skipped":
        # The row vanished or is disabled — we did not run it, and won't pretend to.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Scheduled run {run_id} was not fired: "
                f"{result.get('reason', 'unavailable')}"
            ),
        )

    # Dispatch failed. Re-raise with the dispatcher's own status where we have it
    # (e.g. 503 runner_offline) so the client sees the true cause.
    raise HTTPException(
        status_code=int(
            result.get("status_code") or status.HTTP_502_BAD_GATEWAY
        ),
        detail=result.get("error")
        or f"Dispatch failed: {result.get('reason', 'unknown')}",
    )
