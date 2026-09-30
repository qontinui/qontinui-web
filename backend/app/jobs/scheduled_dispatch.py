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

**One unreachable coord does not stall the sweep.** A ``target="auto"`` row
asks coord which runner to use, and a coord that answers nothing costs that
row its request timeouts. The rows are fired one at a time under the sweep's
600 s cap, each with ``next_fire_at`` already advanced, so rows the sweep
never reached would record nothing at all. The sweep therefore carries a
:class:`SweepState`: once TWO CONSECUTIVE ``target="auto"`` rows are refused
because coord could not be reached, every later ``target="auto"`` row in that
same sweep is recorded ``failed`` — saying so — without asking coord again.
One such row is not enough (a single failed request is ``coord_unreachable``
too), and a row coord answers in between starts the count over. Rows that
name a runner do not ask coord: they still fire, and neither count nor reset.

The ``run-now`` endpoint calls :func:`fire_scheduled_run` directly to fire a single
row immediately, bypassing the poll (and with no sweep state: it always asks).

Both entry points take an optional ``engine`` keyword. Production leaves it unset
and gets the process-global pooled engine; tests pass their own engine so the
sweep runs against the test database **without** rebinding
``app.db.session.async_engine``, which would also redirect the real cron sweeper.

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

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import structlog
from croniter import croniter  # type: ignore[import-untyped]
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models.scheduled_workflow_run import ScheduledWorkflowRun
from app.services.coord_device_resolve import CoordCaller
from app.services.workflow_dispatcher import (
    DispatchError,
    dispatch_workflow_to_runner,
)

logger = structlog.get_logger(__name__)

COORD_UNREACHABLE_IN_SWEEP_CODE = "coord_unreachable_in_sweep"
"""The ``code`` of a ``target="auto"`` row a sweep did not attempt because
coord could not be reached for two consecutive ``target="auto"`` rows earlier
in that same sweep."""

CoordContact = Literal["unreachable", "answered", "not_asked"]
"""What one ``target="auto"`` fire learned about reaching coord."""

UNREACHABLE_ROWS_TO_SHORT_CIRCUIT = 2
"""How many consecutive ``target="auto"`` rows must be refused
``coord_unreachable`` before a sweep stops asking coord."""


@dataclass
class SweepState:
    """What one due-rows sweep has learned, shared by the rows it fires.

    ``unreachable_in_a_row`` counts the consecutive ``target="auto"`` rows of
    the sweep that were refused because coord could not be reached: the
    resolver outcome ``unavailable`` / ``coord_unreachable``, which is any
    ``httpx`` error that left one of the coord requests an automatic pick
    makes without an HTTP answer — a single read timeout or reset connection
    included. One such row therefore proves little, and the sweep stops
    asking only at :data:`UNREACHABLE_ROWS_TO_SHORT_CIRCUIT` in a row:
    ``coord_unreachable`` is then true, and every ``target="auto"`` row fired
    with the same state afterwards is recorded ``failed`` without asking
    coord again.

    A ``target="auto"`` row that coord ANSWERED — a runner named, a refusal,
    a door that is not deployed, a 5xx — sets the count back to zero. A row
    that did not ask coord leaves it as it is: one that names its runner, and
    a ``target="auto"`` row that failed before coord was asked (its workflow
    is gone, or web has no credential or configuration to ask with).

    It is one sweep's knowledge and no more: :func:`poll_and_dispatch_due`
    makes a new one each time, so the next sweep asks coord afresh.
    """

    unreachable_in_a_row: int = 0

    @property
    def coord_unreachable(self) -> bool:
        """Whether the sweep has stopped asking coord."""
        return self.unreachable_in_a_row >= UNREACHABLE_ROWS_TO_SHORT_CIRCUIT

    def note(self, contact: CoordContact) -> None:
        """Take in what one ``target="auto"`` row learned about coord."""
        if contact == "unreachable":
            self.unreachable_in_a_row += 1
        elif contact == "answered":
            self.unreachable_in_a_row = 0


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


def _resolve_engine(engine: AsyncEngine | None) -> AsyncEngine:
    """Return ``engine``, falling back to the process-global pooled engine.

    The import is deliberately late and *inside* the fallback: importing
    ``app.db.session`` at module scope would build the engine at import time.
    """
    if engine is not None:
        return engine
    from app.db.session import async_engine

    return async_engine


async def poll_and_dispatch_due(
    *, now: datetime | None = None, engine: AsyncEngine | None = None
) -> dict[str, int]:
    """Dispatch every due scheduled run; advance ``next_fire_at`` first.

    Returns a stats dict (``due`` / ``dispatched`` / ``failed`` / ``skipped``)
    for observability and test assertions. ``skipped`` counts rows that vanished
    or were disabled between the claim and the fire — a benign race, kept out of
    ``failed`` so that metric stays alertable.

    ``engine`` is an explicit seam for tests: pass an engine and BOTH halves of
    the sweep (the claim here and the fire in :func:`fire_scheduled_run`) run on
    it. The alternative — rebinding ``app.db.session.async_engine`` — repoints a
    process global, which also redirects the REAL cron sweeper at whatever the
    test handed it (web#901). Note this must be threaded into the fire call
    below: injecting it only here would split the claim onto the caller's engine
    while the fire stayed on the global one.
    """
    resolved_engine = _resolve_engine(engine)

    now = now or utc_now()
    session_maker = async_sessionmaker(
        resolved_engine, class_=AsyncSession, expire_on_commit=False
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
                row.next_fire_at = croniter(row.cron_expression, now).get_next(datetime)
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
    #
    # One `SweepState` for the whole batch: a coord that cannot be reached is
    # found out by two consecutive `target="auto"` rows that ask it, and not
    # again by every auto row behind them.
    stats = {"due": len(claimed), "dispatched": 0, "failed": 0, "skipped": 0}
    sweep = SweepState()
    for run_id in claimed:
        try:
            result_dict = await fire_scheduled_run(
                run_id, engine=resolved_engine, sweep=sweep
            )
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


async def fire_scheduled_run(
    scheduled_run_id: str,
    *,
    engine: AsyncEngine | None = None,
    sweep: SweepState | None = None,
) -> dict[str, Any]:
    """Fire one scheduled run by id. Records the outcome on the row.

    Opens its own committed session over ``engine``, defaulting to the shared
    pooled engine. On ``DispatchError`` it records ``failed`` + ``last_error``
    and returns a status dict — it does NOT re-raise.

    ``sweep`` is the due-rows sweep this fire belongs to, if any. A
    ``target="auto"`` row is not attempted once the sweep has stopped asking
    coord (it is recorded ``failed``, saying so). Otherwise the row tells the
    sweep what it learned — coord could not be reached, or coord answered —
    before its own outcome is committed, so a failing commit does not make
    the next row find it out again. A row that names its runner tells the
    sweep nothing. A single fire (run-now) passes none and always asks coord.
    """
    run_uuid = UUID(scheduled_run_id)
    session_maker = async_sessionmaker(
        _resolve_engine(engine), class_=AsyncSession, expire_on_commit=False
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
                failed = await _record_failed_without_dispatch(
                    db,
                    row,
                    fired_at=utc_now(),
                    error=f"Invalid target value: {target_str!r}",
                    reason="invalid_target",
                )
                logger.error(
                    "scheduled_run_invalid_target",
                    scheduled_run_id=scheduled_run_id,
                    target=target_str,
                )
                return failed

        fired_at: datetime = utc_now()
        if target == "auto" and sweep is not None and sweep.coord_unreachable:
            # Coord could not be reached for the last rows of this sweep
            # that asked it. Asking again would spend this row's coord
            # timeouts to learn the same thing, and enough such rows would
            # run the sweep into its cap before the rows behind them
            # recorded anything.
            failed = await _record_failed_without_dispatch(
                db,
                row,
                fired_at=fired_at,
                error=(
                    f"[503 {COORD_UNREACHABLE_IN_SWEEP_CODE}] Coord could not "
                    f"be reached for {UNREACHABLE_ROWS_TO_SHORT_CIRCUIT} "
                    "consecutive automatic runs earlier in this sweep, so this "
                    "run was not attempted and coord was not asked again for "
                    "it. The next scheduled window is the retry."
                ),
                reason=COORD_UNREACHABLE_IN_SWEEP_CODE,
                status_code=503,
                code=COORD_UNREACHABLE_IN_SWEEP_CODE,
            )
            logger.warning(
                "scheduled_run_not_attempted_coord_unreachable_in_sweep",
                scheduled_run_id=scheduled_run_id,
                error=row.last_error,
            )
            return failed

        try:
            result = await dispatch_workflow_to_runner(
                db,
                user_id=row.user_id,
                workflow_id=row.workflow_id,
                target=target,
                # A scheduled fire has no request and so no caller bearer.
                # It names the schedule's owner instead: for ``target="auto"``
                # a bearer acting for that user is minted from coord, and
                # coord's device resolver — capability-checked and
                # drain-aware — names the runner. There is no web-side pick:
                # a failed mint or an unanswered resolver is a refused
                # dispatch, recorded in ``last_error``.
                caller=CoordCaller.background_for(row.user_id),
                parent_task_run_id=None,
            )
        except DispatchError as err:
            refusal = _coord_refusal_fields(err)
            if sweep is not None and target == "auto":
                # Before the commit: what this row learned about coord holds
                # whether or not its own outcome gets recorded.
                sweep.note(_coord_contact(err))
            # No re-raise: the next cron window is the retry. But carry the
            # dispatcher's own status/code out so an interactive caller (run-now)
            # can surface the real failure to the user rather than dressing it up
            # as a 200. The scheduler's poll ignores these extra keys.
            failed = await _record_failed_without_dispatch(
                db,
                row,
                fired_at=fired_at,
                # ``detail`` can be a dict or a string; serialise consistently.
                error=_format_dispatch_error(err),
                reason="dispatch_error",
                status_code=err.status_code,
                code=err.code,
            )
            logger.warning(
                "scheduled_run_dispatch_failed",
                scheduled_run_id=scheduled_run_id,
                status_code=err.status_code,
                code=err.code,
                error=row.last_error,
                **refusal,
            )
            return failed

        if sweep is not None and target == "auto":
            # Coord named the runner this went to. Noted before the commit,
            # like a refusal.
            sweep.note("answered")
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


async def _record_failed_without_dispatch(
    db: AsyncSession,
    row: ScheduledWorkflowRun,
    *,
    fired_at: datetime,
    error: str,
    reason: str,
    status_code: int | None = None,
    code: str | None = None,
) -> dict[str, Any]:
    """Record on ``row`` a fire that dispatched nothing, commit, and return
    the status dict :func:`fire_scheduled_run` answers with.

    ``reason`` says which kind of failure it was. ``status_code`` and
    ``code`` are given together, when the failure has an HTTP status an
    interactive caller should surface; the dict then carries them and
    ``error``, and otherwise only ``status`` and ``reason``.
    """
    row.last_fired_at = fired_at
    row.last_status = "failed"
    row.last_error = error
    await db.commit()
    failed: dict[str, Any] = {"status": "failed", "reason": reason}
    if status_code is not None:
        failed.update(status_code=status_code, code=code, error=error)
    return failed


_UNASKED_REASONS = frozenset({"no_credential", "misconfigured"})
"""The ``unavailable`` reasons that mean web had nothing to ask coord with or
nowhere to ask it — unless the outcome carries an HTTP status, which is coord
answering (its refusal to give web a service token)."""


def _coord_contact(err: DispatchError) -> CoordContact:
    """Whether coord was reached by a ``target="auto"`` dispatch that ended
    in ``err``.

    ``unreachable`` is the resolver outcome ``unavailable`` /
    ``coord_unreachable`` and nothing else. ``not_asked`` is a dispatch that
    failed before the pick (``workflow_not_found``) or whose pick had no
    credential or configuration to ask coord with. Everything else came
    after an answer from coord — its refusal, a door it does not have, a 5xx,
    a body that is not the contract, an outcome naming no device, or a named
    runner the dispatch then failed to reach.
    """
    if err.code == "workflow_not_found":
        return "not_asked"
    refusal = _coord_refusal_fields(err)
    reason = refusal.get("resolver_reason")
    if reason == "coord_unreachable":
        return "unreachable"
    if reason in _UNASKED_REASONS and refusal.get("coord_status") is None:
        return "not_asked"
    return "answered"


def _coord_refusal_fields(err: DispatchError) -> dict[str, Any]:
    """Coord's own reason, ``error`` string and HTTP status for a refused
    auto-pick.

    ``err.code`` is the dispatcher's code, and for every way coord's resolver
    was not answered it is the same ``device_resolver_unavailable``. What
    tells an operator WHICH (``refused`` / ``tenant_ambiguous`` / 409, say)
    is in the resolver outcome the refusal carries. Empty for any other
    failure.
    """
    if not isinstance(err.detail, dict):
        return {}
    outcome = err.detail.get("resolver_outcome")
    if not isinstance(outcome, dict) or outcome.get("outcome") != "unavailable":
        return {}
    return {
        "resolver_reason": outcome.get("reason"),
        "coord_code": outcome.get("code"),
        "coord_status": outcome.get("status"),
    }


def _format_dispatch_error(err: DispatchError) -> str:
    """Render a DispatchError in a readable form for ``last_error``."""
    if isinstance(err.detail, dict):
        msg = err.detail.get("message") or err.detail.get("code") or str(err.detail)
        return f"[{err.status_code} {err.code}] {msg}"
    return f"[{err.status_code} {err.code}] {err.detail}"
