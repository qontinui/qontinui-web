"""Scheduled job — cron-driven workflow dispatch via due-row polling.

The scheduler's ``scheduled_dispatch`` cadence (every ~30s) calls
:func:`poll_and_dispatch_due`, which claims every
``project.scheduled_workflow_runs`` row whose ``next_fire_at <= now()``
(``FOR UPDATE SKIP LOCKED``), advances each row's ``next_fire_at`` to the
next croniter fire, then dispatches each claimed row via :func:`fire_scheduled_run`.

**At-most-once-per-window.** ``next_fire_at`` is advanced from ``now()``, NOT
from the missed slot. After downtime, a row with several missed windows fires
exactly once and resumes on-cadence, rather than replaying every skipped slot.
The advance is committed BEFORE the dispatch runs, so a crash mid-dispatch
skips that window rather than re-firing it.

:func:`fire_scheduled_run` records ``last_fired_at`` / ``last_status`` /
``last_error`` on the row and dispatches. On ``DispatchError`` it records
``failed`` and returns — it does NOT re-raise (there is no autoretry layer;
the next cron window is the retry). The caller advances ``next_fire_at``
regardless of dispatch outcome.

The ``run-now`` endpoint calls :func:`fire_scheduled_run` directly to fire a single
row immediately, bypassing the poll.

.. warning::

   **Dispatch is replica-local; the rest of the scheduler is not.** The advisory
   lock guarantees exactly ONE replica polls, but ``dispatch_workflow_to_runner``
   can only reach a runner whose WebSocket is held **in this process**
   (``RunnerWebSocketManager.is_connected`` is an in-process memory check). On a
   multi-replica deploy the polling winner may not be the replica holding the
   target runner's socket, and the dispatch then fails ``503 runner_offline`` —
   recorded on the row, visible, but not delivered.

   This is not a regression (a Celery worker process held *zero* WebSockets, so
   dispatch could never have worked from there either), and prod today runs a
   single uvicorn process, so it does not bite. But it DOES bound the
   "multi-replica safe" property to the non-dispatch tasks. Scaling the web tier
   out requires routing the dispatch to the socket-holding replica first (a Redis
   pub/sub fanout — ``is_connected_redis`` already tracks *which* replica has it).
   Tracked as a follow-up to plan 2026-07-12-backend-inprocess-scheduler.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from croniter import croniter  # type: ignore[import-untyped]
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.scheduled_workflow_run import ScheduledWorkflowRun
from app.services.workflow_dispatcher import (
    DispatchError,
    dispatch_workflow_to_runner,
)

logger = structlog.get_logger(__name__)


def _disable_for_bad_cron(row: ScheduledWorkflowRun, err: Exception) -> None:
    """Kill a schedule whose cron cannot be advanced — VISIBLY.

    The obvious move is to null out ``next_fire_at`` so the poll stops picking the
    row up. That is a silent death: the poll's ``next_fire_at IS NOT NULL``
    predicate excludes the row forever while the API still reports
    ``enabled: true``, so the user sees a live schedule that will never fire again
    — the precise class of invisible-no-op this whole change exists to abolish.
    (It also collides with NULL's other meaning: "not yet anchored".)

    So we disable the row and record the reason, which the API already surfaces.
    """
    row.enabled = False
    row.next_fire_at = None
    row.last_status = "failed"
    row.last_error = f"Invalid cron {row.cron_expression!r}: {err}. Schedule disabled."
    logger.error(
        "scheduled_run_disabled_invalid_cron",
        scheduled_run_id=str(row.id),
        cron_expression=row.cron_expression,
        error=str(err),
    )


async def _anchor_unscheduled_rows(db: AsyncSession, now: datetime) -> int:
    """Give every enabled row with a NULL ``next_fire_at`` its next cron slot.

    NULL means "enabled but unscheduled" — the state left by the migration that
    introduced this column (it deliberately does NOT backfill ``now()``, which
    would make every dormant schedule due at once and dispatch the lot off-cron
    on the first tick after deploy).

    Anchoring computes the next slot; it never fires the row. So a schedule that
    lay dormant through the whole RedBeat era resumes on its own cron rather than
    all of them stampeding at deploy time.
    """
    result = await db.execute(
        select(ScheduledWorkflowRun)
        .where(
            ScheduledWorkflowRun.enabled.is_(True),
            ScheduledWorkflowRun.next_fire_at.is_(None),
        )
        .with_for_update(skip_locked=True)
    )
    anchored = 0
    for row in result.scalars().all():
        try:
            row.next_fire_at = croniter(row.cron_expression, now).get_next(datetime)
            anchored += 1
        except Exception as err:  # noqa: BLE001 - bad cron: disable, don't loop
            _disable_for_bad_cron(row, err)
    if anchored:
        logger.info("scheduled_runs_anchored", count=anchored)
    return anchored


async def poll_and_dispatch_due(*, now: datetime | None = None) -> dict[str, int]:
    """Dispatch every due scheduled run; advance ``next_fire_at`` first.

    Returns a stats dict (``due`` / ``dispatched`` / ``failed`` / ``skipped``)
    for observability and test assertions. ``skipped`` counts rows that vanished
    or were disabled between the claim and the fire — a benign race, kept out of
    ``failed`` so that metric stays alertable.
    """
    from app.db.session import async_engine

    now = now or utc_now()
    session_maker = async_sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )

    # 0. Anchor any enabled-but-unscheduled row onto its cron (without firing it).
    async with session_maker() as db:
        await _anchor_unscheduled_rows(db, now)
        await db.commit()

    # 1. Claim due rows and advance next_fire_at, committing before we
    #    dispatch so a mid-dispatch crash skips (not replays) the window.
    claimed: list[str] = []
    async with session_maker() as db:
        result = await db.execute(
            select(ScheduledWorkflowRun)
            .where(
                ScheduledWorkflowRun.enabled.is_(True),
                ScheduledWorkflowRun.next_fire_at.is_not(None),
                ScheduledWorkflowRun.next_fire_at <= now,
            )
            .with_for_update(skip_locked=True)
        )
        rows = list(result.scalars().all())
        for row in rows:
            try:
                row.next_fire_at = croniter(row.cron_expression, now).get_next(
                    datetime
                )
            except Exception as err:  # noqa: BLE001 - bad cron: disable, don't fire
                _disable_for_bad_cron(row, err)
                continue
            claimed.append(str(row.id))
        await db.commit()

    # 2. Dispatch each claimed row. One bad row must not abort the batch.
    #
    # `skipped` is its OWN bucket, not folded into `failed`: a row deleted or
    # disabled in the window between the poll's commit above and its fire below
    # is a benign race, not a dispatch failure. Folding it into `failed` would
    # contaminate the very metric an operator alerts on.
    stats = {"due": len(claimed), "dispatched": 0, "failed": 0, "skipped": 0}
    for run_id in claimed:
        try:
            result_dict = await fire_scheduled_run(run_id)
        except Exception:  # noqa: BLE001 - defensive; core is already guarded
            stats["failed"] += 1
            logger.exception(
                "scheduled_run_fire_unexpected_error", scheduled_run_id=run_id
            )
            continue
        outcome = result_dict.get("status")
        if outcome == "dispatched":
            stats["dispatched"] += 1
        elif outcome == "skipped":
            stats["skipped"] += 1
        else:
            stats["failed"] += 1

    if stats["due"]:
        logger.info("scheduled_dispatch_batch", **stats)
    return stats


async def fire_scheduled_run(scheduled_run_id: str) -> dict[str, Any]:
    """Fire one scheduled run by id. Records the outcome on the row.

    Opens its own committed session over the shared pooled engine. On
    ``DispatchError`` it records ``failed`` + ``last_error`` and returns a
    status dict — it does NOT re-raise.
    """
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
            # No re-raise: the next cron window is the retry. But carry the
            # dispatcher's own status/code out so an interactive caller (run-now)
            # can surface the real failure to the user rather than dressing it up
            # as a 200. The scheduler's poll ignores these extra keys.
            return {
                "status": "failed",
                "reason": "dispatch_error",
                "status_code": err.status_code,
                "code": err.code,
                "error": row.last_error,
            }

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
