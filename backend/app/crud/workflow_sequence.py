"""CRUD operations for workflow sequence management."""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow_sequence import WorkflowSequence
from app.schemas.workflow_sequence import (
    WorkflowSequenceCreate,
    WorkflowSequenceUpdate,
)

logger = structlog.get_logger(__name__)


async def create_workflow_sequence(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    data: WorkflowSequenceCreate,
) -> WorkflowSequence:
    """Create a new workflow sequence."""
    sequence = WorkflowSequence(
        project_id=project_id,
        created_by=user_id,
        name=data.name,
        description=data.description,
        workflow_ids=data.workflow_ids,
        stop_on_failure=data.stop_on_failure,
        schedule=data.schedule.model_dump() if data.schedule else None,
    )

    db.add(sequence)
    await db.commit()
    await db.refresh(sequence)

    logger.info(
        "workflow_sequence_created",
        sequence_id=str(sequence.id),
        project_id=str(project_id),
        user_id=str(user_id),
    )
    return sequence


async def get_by_id(db: AsyncSession, sequence_id: UUID) -> WorkflowSequence | None:
    """Get workflow sequence by ID."""
    result = await db.execute(
        select(WorkflowSequence).where(WorkflowSequence.id == sequence_id)
    )
    return result.scalar_one_or_none()


async def get_by_project_and_id(
    db: AsyncSession, project_id: UUID, sequence_id: UUID
) -> WorkflowSequence | None:
    """Get workflow sequence by project and ID."""
    result = await db.execute(
        select(WorkflowSequence).where(
            and_(
                WorkflowSequence.project_id == project_id,
                WorkflowSequence.id == sequence_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def list_by_project(
    db: AsyncSession,
    project_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[WorkflowSequence], int]:
    """List all workflow sequences for a project."""
    count_result = await db.execute(
        select(func.count(WorkflowSequence.id)).where(
            WorkflowSequence.project_id == project_id
        )
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(WorkflowSequence)
        .where(WorkflowSequence.project_id == project_id)
        .order_by(desc(WorkflowSequence.created_at))
        .offset(skip)
        .limit(limit)
    )
    sequences = list(result.scalars().all())

    return sequences, total


async def update_workflow_sequence(
    db: AsyncSession,
    sequence: WorkflowSequence,
    update_data: WorkflowSequenceUpdate,
) -> WorkflowSequence:
    """Update a workflow sequence."""
    update_dict = update_data.model_dump(exclude_unset=True)

    if "schedule" in update_dict and update_data.schedule is not None:
        update_dict["schedule"] = update_data.schedule.model_dump()

    for field, value in update_dict.items():
        setattr(sequence, field, value)

    sequence.updated_at = datetime.now(UTC)  # type: ignore[assignment]
    await db.commit()
    await db.refresh(sequence)

    logger.info("workflow_sequence_updated", sequence_id=str(sequence.id))
    return sequence


async def delete_workflow_sequence(
    db: AsyncSession, sequence: WorkflowSequence
) -> bool:
    """Delete a workflow sequence."""
    sequence_id = sequence.id
    await db.delete(sequence)
    await db.commit()

    logger.info("workflow_sequence_deleted", sequence_id=str(sequence_id))
    return True
