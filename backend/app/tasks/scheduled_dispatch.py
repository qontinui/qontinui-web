"""Celery task — Phase 3D scheduled workflow dispatch.

Redbeat fires :func:`fire_scheduled_run` at the configured cron time, passing
the ``ScheduledWorkflowRun.id`` as the only argument. The task:

1. Loads the row (sync, via ``SessionLocal`` — Celery workers are sync).
2. Short-circuits if the row is deleted or disabled (no retry).
3. Calls :func:`app.services.workflow_dispatcher.dispatch_workflow_to_runner`
   against a throwaway async session (the dispatcher is async-native).
4. Updates ``last_fired_at`` + ``last_execution_id`` + ``last_status`` on the
   row.
5. On DispatchError, records ``last_status="failed"`` + ``last_error`` and
   re-raises so Celery's ``autoretry_for=(Exception,)`` kicks in.

Running an async function from inside a sync Celery worker uses
``asyncio.run`` — the codebase doesn't have a pre-existing pattern for this
(clipboard_cleanup is asyncio-only, not Celery-driven), so we roll one here.
Flagged in the final report.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.celery_app import celery_app
from app.models.scheduled_workflow_run import ScheduledWorkflowRun
from app.services.workflow_dispatcher import (
    DispatchError,
    dispatch_workflow_to_runner,
)

logger = structlog.get_logger(__name__)


async def _async_fire(scheduled_run_id: str) -> dict[str, Any]:
    """Async core. See :func:`fire_scheduled_run` for the public surface."""
    # Lazy import to avoid a module-load-time DB engine handshake in tests
    # that never trigger the Celery path.
    from app.db.session import async_engine

    run_uuid = UUID(scheduled_run_id)
    session_maker = async_sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )

    async with session_maker() as db:
        row = await db.get(ScheduledWorkflowRun, run_uuid)
        if row is None:
            logger.warning(
                "scheduled_run_missing_at_fire",
                scheduled_run_id=scheduled_run_id,
            )
            return {"status": "skipped", "reason": "row_missing"}

        if not row.enabled:
            logger.info(
                "scheduled_run_disabled_at_fire",
                scheduled_run_id=scheduled_run_id,
            )
            return {"status": "skipped", "reason": "disabled"}

        # Parse target back into the dispatcher's expected shape.
        target_str = row.target
        target: str | UUID
        if target_str == "auto":
            target = "auto"
        else:
            try:
                target = UUID(target_str)
            except ValueError:
                # Corrupt row — record and surface an error.
                row.last_fired_at = utc_now()
                row.last_status = "failed"
                row.last_error = f"Invalid target value: {target_str!r}"
                await db.commit()
                logger.error(
                    "scheduled_run_invalid_target",
                    scheduled_run_id=scheduled_run_id,
                    target=target_str,
                )
                return {"status": "failed", "reason": "invalid_target"}

        fired_at: datetime = utc_now()
        try:
            result = await dispatch_workflow_to_runner(
                db,
                user_id=row.user_id,
                workflow_id=row.workflow_id,
                target=target,
                parent_task_run_id=None,
            )
        except DispatchError as err:
            row.last_fired_at = fired_at
            row.last_status = "failed"
            # ``detail`` can be a dict or a string; serialise consistently.
            row.last_error = _format_dispatch_error(err)
            await db.commit()
            logger.warning(
                "scheduled_run_dispatch_failed",
                scheduled_run_id=scheduled_run_id,
                status_code=err.status_code,
                code=err.code,
            )
            # Re-raise so Celery's autoretry sees it as a failure.
            raise

        row.last_fired_at = fired_at
        row.last_status = "dispatched"
        row.last_execution_id = result.execution_id
        row.last_error = None
        await db.commit()

        logger.info(
            "scheduled_run_dispatched",
            scheduled_run_id=scheduled_run_id,
            execution_id=result.execution_id,
            runner_id=str(result.runner_id),
        )
        return {
            "status": "dispatched",
            "execution_id": result.execution_id,
            "runner_id": str(result.runner_id),
        }


def _format_dispatch_error(err: DispatchError) -> str:
    """Render a DispatchError in a readable form for ``last_error``."""
    if isinstance(err.detail, dict):
        msg = err.detail.get("message") or err.detail.get("code") or str(err.detail)
        return f"[{err.status_code} {err.code}] {msg}"
    return f"[{err.status_code} {err.code}] {err.detail}"


@celery_app.task(
    bind=True,
    name="app.tasks.scheduled_dispatch.fire",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def fire_scheduled_run(self: Any, scheduled_run_id: str) -> dict[str, Any]:
    """Redbeat fires this at cron time.

    Args:
        scheduled_run_id: The ``ScheduledWorkflowRun.id`` (as a string, since
            Celery JSON-serialises args).

    Returns:
        A small status dict, mostly for test assertions.
    """
    return asyncio.run(_async_fire(scheduled_run_id))
