"""API endpoints for workflow sequence management."""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.crud import workflow_sequence as crud
from app.models.project import Project
from app.models.user import User
from app.schemas.workflow_sequence import (
    WorkflowSequenceCreate,
    WorkflowSequenceListResponse,
    WorkflowSequenceResponse,
    WorkflowSequenceSummary,
    WorkflowSequenceUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


async def verify_project_access(
    db: AsyncSession, project_id: UUID, user: User
) -> Project:
    """Verify user has access to a project."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project",
        )

    return project


@router.get(
    "/projects/{project_id}/workflow-sequences",
    response_model=WorkflowSequenceListResponse,
)
async def list_workflow_sequences(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all workflow sequences for a project."""
    await verify_project_access(db, project_id, current_user)

    sequences, total = await crud.list_by_project(
        db, project_id, skip=offset, limit=limit
    )

    summaries = []
    for seq in sequences:
        summary_dict = {
            "id": seq.id,
            "project_id": seq.project_id,
            "name": seq.name,
            "description": seq.description,
            "workflow_count": len(seq.workflow_ids or []),
            "has_schedule": bool(seq.schedule and seq.schedule.get("enabled")),
            "created_at": seq.created_at,
        }
        summaries.append(WorkflowSequenceSummary.model_validate(summary_dict))

    return WorkflowSequenceListResponse(
        sequences=summaries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.post(
    "/projects/{project_id}/workflow-sequences",
    response_model=WorkflowSequenceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow_sequence(
    project_id: UUID,
    data: WorkflowSequenceCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new workflow sequence."""
    await verify_project_access(db, project_id, current_user)

    sequence = await crud.create_workflow_sequence(
        db, project_id, current_user.id, data
    )

    logger.info(
        "workflow_sequence_created",
        sequence_id=str(sequence.id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return WorkflowSequenceResponse.model_validate(sequence)


@router.get(
    "/projects/{project_id}/workflow-sequences/{sequence_id}",
    response_model=WorkflowSequenceResponse,
)
async def get_workflow_sequence(
    project_id: UUID,
    sequence_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get a workflow sequence by ID."""
    await verify_project_access(db, project_id, current_user)

    sequence = await crud.get_by_project_and_id(db, project_id, sequence_id)
    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow sequence not found",
        )

    return WorkflowSequenceResponse.model_validate(sequence)


@router.put(
    "/projects/{project_id}/workflow-sequences/{sequence_id}",
    response_model=WorkflowSequenceResponse,
)
async def update_workflow_sequence(
    project_id: UUID,
    sequence_id: UUID,
    update_data: WorkflowSequenceUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update a workflow sequence."""
    await verify_project_access(db, project_id, current_user)

    sequence = await crud.get_by_project_and_id(db, project_id, sequence_id)
    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow sequence not found",
        )

    sequence = await crud.update_workflow_sequence(db, sequence, update_data)

    logger.info(
        "workflow_sequence_updated",
        sequence_id=str(sequence_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return WorkflowSequenceResponse.model_validate(sequence)


@router.delete(
    "/projects/{project_id}/workflow-sequences/{sequence_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_workflow_sequence(
    project_id: UUID,
    sequence_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a workflow sequence."""
    await verify_project_access(db, project_id, current_user)

    sequence = await crud.get_by_project_and_id(db, project_id, sequence_id)
    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow sequence not found",
        )

    await crud.delete_workflow_sequence(db, sequence)

    logger.info(
        "workflow_sequence_deleted",
        sequence_id=str(sequence_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return None
