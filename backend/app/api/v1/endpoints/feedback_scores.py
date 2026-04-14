"""
Feedback Scores API endpoints.

This module provides REST API endpoints for the feedback score system,
supporting the Opik integration for tracking quality metrics on execution
runs and action executions.

Endpoints:
- POST /feedback-scores — create a feedback score
- GET /execution-runs/{run_id}/feedback-scores — list scores for a run
- GET /action-executions/{action_id}/feedback-scores — list scores for an action
- GET /execution-runs/{run_id}/feedback-scores/summary — aggregated summary
- DELETE /feedback-scores/{id} — delete a score
"""

from typing import Literal
from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.repositories.feedback_score import FeedbackScoreRepository
from fastapi import APIRouter, Depends, HTTPException, status
from qontinui_schemas.api.feedback import (
    FeedbackScoreBatchResponse,
    FeedbackScoreCreate,
    FeedbackScoreListResponse,
    FeedbackScoreResponse,
    FeedbackScoreSummary,
)
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


def _model_to_response(score) -> FeedbackScoreResponse:
    """Convert a FeedbackScore model to a FeedbackScoreResponse schema."""
    target_type: Literal["run", "action"]
    if score.run_id is not None:
        target_type = "run"
        target_id = score.run_id
    else:
        target_type = "action"
        target_id = score.action_execution_id

    return FeedbackScoreResponse(
        id=score.id,
        target_type=target_type,
        target_id=target_id,
        name=score.name,
        value=score.value,
        category_value=score.category_value,
        source=score.source,
        reason=score.reason,
        metadata=score.metadata_,
        created_at=score.created_at,
        created_by=score.created_by,
    )


# =============================================================================
# Feedback Score Endpoints
# =============================================================================


@router.post(
    "/feedback-scores",
    response_model=FeedbackScoreResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a feedback score",
    description="Create a new feedback score for an execution run or action execution.",
)
async def create_feedback_score(
    score_data: FeedbackScoreCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FeedbackScoreResponse:
    """Create a new feedback score."""
    # Build the model data from the schema
    data: dict = {
        "name": score_data.name,
        "value": score_data.value,
        "category_value": score_data.category_value,
        "source": score_data.source,
        "reason": score_data.reason,
        "metadata_": score_data.metadata,
        "created_by": str(current_user.id),
    }

    if score_data.target_type == "run":
        data["run_id"] = score_data.target_id
    else:
        data["action_execution_id"] = score_data.target_id

    score = await FeedbackScoreRepository.create(db, data)

    logger.info(
        "Created feedback score",
        score_id=str(score.id),
        target_type=score_data.target_type,
        target_id=str(score_data.target_id),
        name=score_data.name,
        user_id=str(current_user.id),
    )

    return _model_to_response(score)


@router.post(
    "/feedback-scores/batch",
    response_model=FeedbackScoreBatchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create feedback scores in batch",
    description="Create multiple feedback scores in a single request.",
)
async def create_feedback_scores_batch(
    scores: list[FeedbackScoreCreate],
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FeedbackScoreBatchResponse:
    """Create multiple feedback scores in a single transaction."""
    items: list[dict] = []
    for score_data in scores:
        data: dict = {
            "name": score_data.name,
            "value": score_data.value,
            "category_value": score_data.category_value,
            "source": score_data.source,
            "reason": score_data.reason,
            "metadata_": score_data.metadata,
            "created_by": str(current_user.id),
        }

        if score_data.target_type == "run":
            data["run_id"] = score_data.target_id
        else:
            data["action_execution_id"] = score_data.target_id

        items.append(data)

    created = await FeedbackScoreRepository.create_batch(db, items)

    logger.info(
        "Batch created feedback scores",
        count=created,
        user_id=str(current_user.id),
    )

    return FeedbackScoreBatchResponse(created=created)


@router.get(
    "/execution-runs/{run_id}/feedback-scores",
    response_model=FeedbackScoreListResponse,
    summary="List feedback scores for a run",
    description="List all feedback scores associated with an execution run.",
)
async def list_run_feedback_scores(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FeedbackScoreListResponse:
    """List feedback scores for an execution run."""
    scores, total = await FeedbackScoreRepository.list_by_run_id(db, run_id)

    return FeedbackScoreListResponse(
        items=[_model_to_response(s) for s in scores],
        total=total,
    )


@router.get(
    "/action-executions/{action_id}/feedback-scores",
    response_model=FeedbackScoreListResponse,
    summary="List feedback scores for an action",
    description="List all feedback scores associated with an action execution.",
)
async def list_action_feedback_scores(
    action_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FeedbackScoreListResponse:
    """List feedback scores for an action execution."""
    scores, total = await FeedbackScoreRepository.list_by_action_id(db, action_id)

    return FeedbackScoreListResponse(
        items=[_model_to_response(s) for s in scores],
        total=total,
    )


@router.get(
    "/execution-runs/{run_id}/feedback-scores/summary",
    response_model=list[FeedbackScoreSummary],
    summary="Get feedback score summary for a run",
    description="Get aggregated summary of feedback scores grouped by name for an execution run.",
)
async def get_run_feedback_summary(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> list[FeedbackScoreSummary]:
    """Get aggregated feedback score summary for an execution run."""
    summaries = await FeedbackScoreRepository.get_summary_by_run_id(db, run_id)

    return [FeedbackScoreSummary(**s) for s in summaries]


@router.delete(
    "/feedback-scores/{score_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a feedback score",
    description="Delete a feedback score by its ID.",
)
async def delete_feedback_score(
    score_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """Delete a feedback score."""
    deleted = await FeedbackScoreRepository.delete(db, score_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feedback score {score_id} not found",
        )

    logger.info(
        "Deleted feedback score",
        score_id=str(score_id),
        user_id=str(current_user.id),
    )
