"""User-authenticated read endpoints for phase results.

The companion ingestion endpoint lives in
:mod:`app.api.v1.endpoints.events` (``POST /api/v1/events/phase-completed``)
and is runner-authenticated. The routes here are for the web UI / owner of
the runner, and use JWT user auth.

Ownership rule: a user can only read phase results emitted by runners they
own. The join is ``runners.user_id == current_user.id``. Rows whose
``runner_id`` is NULL (e.g. a phase result ingested before any runner had
registered) are not returned, because we cannot prove ownership.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.middleware.rate_limit import user_limiter
from app.models.phase_result import PhaseResult
from app.models.runner import Runner
from app.models.user import User
from app.schemas.phase_result import PhaseResultResponse

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get(
    "",
    response_model=list[PhaseResultResponse],
    responses={
        200: {"description": "List of phase results for the execution"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("120 per minute")
async def list_phase_results(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    execution_id: str = Query(..., min_length=1, max_length=255),
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> Any:
    """List phase results for an execution, ordered by ``created_at ASC``.

    Only returns rows whose ``runner_id`` is owned by the caller.
    """
    query = (
        select(PhaseResult)
        .join(Runner, Runner.id == PhaseResult.runner_id)
        .where(
            PhaseResult.execution_id == execution_id,
            Runner.user_id == current_user.id,
        )
        .order_by(PhaseResult.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    rows = result.scalars().all()

    logger.info(
        "phase_results_listed",
        user_id=str(current_user.id),
        execution_id=execution_id,
        count=len(rows),
    )

    return [PhaseResultResponse.model_validate(r) for r in rows]


@router.get(
    "/{phase_result_id}",
    response_model=PhaseResultResponse,
    responses={
        200: {"description": "Phase result"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        404: {
            "description": "Phase result not found or not owned by user",
            "content": {
                "application/json": {"example": {"detail": "Phase result not found"}}
            },
        },
    },
)
@user_limiter.limit("120 per minute")
async def get_phase_result(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    phase_result_id: UUID,
) -> Any:
    """Fetch a single phase result by id. Owner of the runner only."""
    query = (
        select(PhaseResult)
        .join(Runner, Runner.id == PhaseResult.runner_id)
        .where(
            PhaseResult.id == phase_result_id,
            Runner.user_id == current_user.id,
        )
    )
    result = await db.execute(query)
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Phase result not found",
        )
    return PhaseResultResponse.model_validate(row)
