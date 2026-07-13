"""CRUD operations for scheduled workflow runs — Phase 3D.

The DB row is the *whole* schedule: ``cron_expression`` says when, and
``next_fire_at`` says when next. There is no second system to keep in lockstep
(this replaced RedBeat, whose entries lived in Redis and had to be reconciled on
every create/update/delete — and were lost on a Redis flush).

So each function here just writes the row and (re)computes ``next_fire_at``:

* create  → insert row; compute next_fire_at if enabled.
* update  → apply fields; recompute next_fire_at when cron changes or the row is
            enabled; clear it to NULL when disabled (so the due-row poll skips it).
* delete  → delete row. Nothing else to tear down.

:mod:`app.core.scheduler` polls ``enabled AND next_fire_at <= now()`` every 30s.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import structlog
from croniter import croniter  # type: ignore[import-untyped]
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_workflow_run import ScheduledWorkflowRun
from app.models.unified_workflow import UnifiedWorkflow
from app.schemas.scheduled_workflow_run import (
    ScheduledWorkflowRunCreate,
    ScheduledWorkflowRunUpdate,
)

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


def compute_next_fire_at(
    cron_expression: str, *, enabled: bool, now: datetime | None = None
) -> datetime | None:
    """Next fire time for ``cron_expression``, or ``None`` if it never fires.

    A disabled row gets ``NULL`` so the due-row poll (``enabled AND
    next_fire_at <= now()``) skips it on the index rather than the predicate.

    Raises 422 on a cron that is *syntactically* valid but can never occur.
    ``croniter.is_valid`` — all the schema layer checks — accepts ``"0 0 30 2 *"``
    (Feb 30th), but ``get_next()`` then raises ``CroniterBadDateError``. The old
    RedBeat path built a Celery ``crontab`` object and never evaluated it, so it
    swallowed this; evaluating it here would 500 on an ordinary user typo.
    """
    if not enabled:
        return None
    base = now or datetime.now(UTC)
    try:
        nxt: datetime = croniter(cron_expression, base).get_next(datetime)
    except Exception as err:  # noqa: BLE001 - croniter raises several types
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"cron_expression {cron_expression!r} is syntactically valid but "
                f"never occurs, so this schedule would never fire: {err}"
            ),
        ) from err
    return nxt


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def create_scheduled_run(
    db: AsyncSession,
    user_id: UUID,
    payload: ScheduledWorkflowRunCreate,
) -> ScheduledWorkflowRun:
    """Create a scheduled run, seeding its first ``next_fire_at``."""
    await _assert_workflow_owned(db, payload.workflow_id, user_id)

    row = ScheduledWorkflowRun(
        user_id=user_id,
        workflow_id=payload.workflow_id,
        name=payload.name,
        description=payload.description,
        cron_expression=payload.cron_expression,
        target=_serialise_target(payload.target),
        enabled=payload.enabled,
        next_fire_at=compute_next_fire_at(
            payload.cron_expression, enabled=payload.enabled
        ),
    )
    db.add(row)
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
    """Apply a partial update, recomputing ``next_fire_at`` when the schedule moves."""
    row = await get_scheduled_run(db, user_id, run_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scheduled run not found: {run_id}",
        )

    data = payload.model_dump(exclude_unset=True)
    cron_changed = (
        "cron_expression" in data and data["cron_expression"] != row.cron_expression
    )
    enabled_changed = "enabled" in data and data["enabled"] != row.enabled

    for field, value in data.items():
        if field == "target":
            row.target = _serialise_target(value)
        else:
            setattr(row, field, value)

    # Recompute when the cron moved or the row was just (re-)enabled; clear to
    # NULL when it was just disabled. Note `target` does NOT affect timing, so a
    # target-only edit leaves next_fire_at alone — the pending fire stays pending.
    if cron_changed or enabled_changed:
        row.next_fire_at = compute_next_fire_at(
            row.cron_expression, enabled=row.enabled
        )

    await db.commit()
    await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def delete_scheduled_run(db: AsyncSession, user_id: UUID, run_id: UUID) -> None:
    """Delete the row. The row IS the schedule — nothing else to tear down."""
    row = await get_scheduled_run(db, user_id, run_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scheduled run not found: {run_id}",
        )

    await db.delete(row)
    await db.commit()
