"""CRUD operations for scheduled workflow runs — Phase 3D.

Each async function here keeps the DB row and the redbeat entry (in Redis)
in lockstep:

* create → insert row, then install entry.
* update → if cron or target changed, refresh the entry; if enabled flipped,
  install or tear down accordingly.
* delete → tear down entry, then delete row.

The redbeat side is best-effort: a failure to install an entry rolls back
the DB write so the caller sees a single atomic success/failure. Failures on
*disable* / *delete* are logged but not raised — the DB row is the source
of truth, and an orphan redbeat entry is harmless (the Celery task itself
checks the row's ``enabled`` flag before dispatching).
"""

from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_workflow_run import ScheduledWorkflowRun
from app.models.unified_workflow import UnifiedWorkflow
from app.schemas.scheduled_workflow_run import (
    ScheduledWorkflowRunCreate,
    ScheduledWorkflowRunUpdate,
)
from app.services import redbeat_manager

logger = structlog.get_logger(__name__)

__all__ = [
    "create_scheduled_run",
    "list_scheduled_runs",
    "get_scheduled_run",
    "update_scheduled_run",
    "delete_scheduled_run",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _assert_workflow_owned(
    db: AsyncSession, workflow_id: UUID, user_id: UUID
) -> UnifiedWorkflow:
    """Load ``workflow_id`` and raise 404 unless the user owns it.

    Collapses not-found and not-owned into 404 to avoid leaking existence.
    """
    query = select(UnifiedWorkflow).where(UnifiedWorkflow.id == workflow_id)
    result = await db.execute(query)
    workflow = result.scalar_one_or_none()
    if workflow is None or (
        workflow.created_by_user_id is not None
        and workflow.created_by_user_id != user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )
    return workflow


def _serialise_target(target: str | UUID) -> str:
    """Convert the schema target (``"auto"`` | UUID) to the DB string column."""
    if isinstance(target, UUID):
        return str(target)
    return target


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def create_scheduled_run(
    db: AsyncSession,
    user_id: UUID,
    payload: ScheduledWorkflowRunCreate,
) -> ScheduledWorkflowRun:
    """Create a scheduled run and install the redbeat entry."""
    await _assert_workflow_owned(db, payload.workflow_id, user_id)

    row = ScheduledWorkflowRun(
        user_id=user_id,
        workflow_id=payload.workflow_id,
        name=payload.name,
        description=payload.description,
        cron_expression=payload.cron_expression,
        target=_serialise_target(payload.target),
        enabled=payload.enabled,
    )
    db.add(row)
    await db.flush()  # materialise row.id so redbeat can key on it
    await db.refresh(row)

    if row.enabled:
        try:
            entry_name = redbeat_manager.upsert_schedule(row)
            row.redbeat_entry_id = entry_name
        except Exception:
            # Redbeat/Redis is down — roll back so we don't leave an
            # orphan DB row without a schedule.
            await db.rollback()
            logger.error(
                "scheduled_run_create_redbeat_failed",
                user_id=str(user_id),
                workflow_id=str(payload.workflow_id),
                exc_info=True,
            )
            raise

    await db.commit()
    await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


async def list_scheduled_runs(
    db: AsyncSession,
    user_id: UUID,
    *,
    workflow_id: UUID | None = None,
) -> list[ScheduledWorkflowRun]:
    """Return all scheduled runs owned by ``user_id``, optionally filtered
    by ``workflow_id``."""
    query = (
        select(ScheduledWorkflowRun)
        .where(ScheduledWorkflowRun.user_id == user_id)
        .order_by(ScheduledWorkflowRun.created_at.desc())
    )
    if workflow_id is not None:
        query = query.where(ScheduledWorkflowRun.workflow_id == workflow_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_scheduled_run(
    db: AsyncSession, user_id: UUID, run_id: UUID
) -> ScheduledWorkflowRun | None:
    """Return the scheduled run with ``run_id`` if owned by ``user_id``."""
    query = select(ScheduledWorkflowRun).where(
        ScheduledWorkflowRun.id == run_id,
        ScheduledWorkflowRun.user_id == user_id,
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


async def update_scheduled_run(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    payload: ScheduledWorkflowRunUpdate,
) -> ScheduledWorkflowRun:
    """Apply a partial update. Re-syncs the redbeat entry as needed."""
    row = await get_scheduled_run(db, user_id, run_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scheduled run not found: {run_id}",
        )

    data = payload.model_dump(exclude_unset=True)
    cron_or_target_changed = (
        "cron_expression" in data and data["cron_expression"] != row.cron_expression
    ) or ("target" in data and _serialise_target(data["target"]) != row.target)
    enabled_changed = "enabled" in data and data["enabled"] != row.enabled

    # Apply simple column mutations on the row first so upsert_schedule
    # picks up the new cron_expression.
    for field, value in data.items():
        if field == "target":
            row.target = _serialise_target(value)
        else:
            setattr(row, field, value)

    # Redbeat reconciliation.
    if enabled_changed and row.enabled:
        # false→true: install a fresh entry.
        entry_name = redbeat_manager.upsert_schedule(row)
        row.redbeat_entry_id = entry_name
    elif enabled_changed and not row.enabled:
        # true→false: tear down entry, keep row.
        redbeat_manager.disable_schedule(row)
        row.redbeat_entry_id = None
    elif row.enabled and cron_or_target_changed:
        # Same enabled-state, but schedule shape changed → overwrite entry.
        entry_name = redbeat_manager.upsert_schedule(row)
        row.redbeat_entry_id = entry_name

    await db.commit()
    await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def delete_scheduled_run(db: AsyncSession, user_id: UUID, run_id: UUID) -> None:
    """Remove the redbeat entry (best-effort) and delete the DB row."""
    row = await get_scheduled_run(db, user_id, run_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scheduled run not found: {run_id}",
        )

    try:
        redbeat_manager.delete_schedule(row)
    except Exception:
        # Redis might be down — log and continue; the DB row is truth.
        logger.warning(
            "scheduled_run_delete_redbeat_failed",
            run_id=str(run_id),
            exc_info=True,
        )

    await db.delete(row)
    await db.commit()
