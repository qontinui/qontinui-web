"""Tests for scheduled workflow runs — the in-process-scheduler semantics.

RedBeat is gone. The DB row IS the schedule: ``cron_expression`` says when, and
``next_fire_at`` says when next. There is no second system to keep in lockstep,
so these tests assert on ``next_fire_at`` where they previously asserted on
redbeat entry ids.

The invariants under test:

* create   → ``next_fire_at`` seeded from croniter (or NULL when disabled).
* update   → recomputed iff cron changed OR enabled flipped. A **target-only**
  (or name-only) edit must NOT shift the pending fire — that's the regression
  that would silently reschedule every workflow on a cosmetic edit.
* delete   → the row goes; nothing external to tear down.
* run-now  → 200 OK, awaits :func:`fire_scheduled_run`, returns the REAL result
  dict (not a Celery ``task_id``), and leaves ``next_fire_at`` alone.

Pattern follows ``tests/test_workflow_dispatch.py``: drive CRUD / endpoint
handlers directly against the transactional ``async_db_session`` fixture. No
live FastAPI app, no Redis.

``fire_scheduled_run`` itself opens its own committed session over the shared
engine, so it is *not* observable through this rollback-scoped fixture — its
real behaviour (dispatch, DispatchError recording, missing-row skip) is covered
in ``tests/test_scheduler_db.py`` against committed rows.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from croniter import croniter  # type: ignore[import-untyped]
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.scheduled_runs import (
    create_scheduled_run as create_scheduled_run_endpoint,
)
from app.api.v1.endpoints.scheduled_runs import (
    delete_scheduled_run as delete_scheduled_run_endpoint,
)
from app.api.v1.endpoints.scheduled_runs import (
    list_scheduled_runs as list_scheduled_runs_endpoint,
)
from app.api.v1.endpoints.scheduled_runs import (
    run_scheduled_run_now as run_scheduled_run_now_endpoint,
)
from app.api.v1.endpoints.scheduled_runs import (
    update_scheduled_run as update_scheduled_run_endpoint,
)
from app.crud import scheduled_workflow_run_crud as crud
from app.models.unified_workflow import UnifiedWorkflow
from app.models.user import User
from app.schemas.scheduled_workflow_run import (
    ScheduledWorkflowRunCreate,
    ScheduledWorkflowRunUpdate,
)

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def _workflow(async_db_session: AsyncSession, test_user: User) -> UnifiedWorkflow:
    """Create a minimal workflow owned by ``test_user``."""
    wf = UnifiedWorkflow(
        created_by_user_id=test_user.id,
        name="wf-for-scheduled-runs",
    )
    async_db_session.add(wf)
    await async_db_session.commit()
    await async_db_session.refresh(wf)
    return wf


def _expected_next(cron: str, *, around: datetime) -> datetime:
    """The croniter fire the CRUD layer should have computed.

    CRUD calls ``croniter(cron, now).get_next()`` with its *own* ``now``, which
    we cannot observe. For every cron used here the next fire is at least a
    minute away, so any ``now`` within our few-millisecond test window yields the
    same answer — we recompute from a timestamp captured around the call.
    """
    nxt: datetime = croniter(cron, around).get_next(datetime)
    return nxt


async def _make_run(
    db: AsyncSession,
    user: User,
    workflow: UnifiedWorkflow,
    *,
    name: str = "sched",
    cron: str = "0 9 * * *",
    enabled: bool = True,
):
    """Create a scheduled run via CRUD with sensible defaults."""
    return await crud.create_scheduled_run(
        db,
        user.id,
        ScheduledWorkflowRunCreate(
            name=name,
            cron_expression=cron,
            target="auto",
            workflow_id=workflow.id,
            enabled=enabled,
        ),
    )


# ---------------------------------------------------------------------------
# compute_next_fire_at — the pure helper CRUD is built on
# ---------------------------------------------------------------------------


class TestComputeNextFireAt:
    """The schedule maths, isolated from the DB."""

    def test_enabled_returns_next_croniter_fire(self):
        now = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)  # Monday
        assert crud.compute_next_fire_at("*/15 * * * *", enabled=True, now=now) == (
            datetime(2026, 7, 13, 12, 15, tzinfo=UTC)
        )

    def test_disabled_returns_none(self):
        """A disabled row never fires — NULL keeps it off the due-row index."""
        now = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)
        assert crud.compute_next_fire_at("*/15 * * * *", enabled=False, now=now) is None

    def test_result_is_strictly_after_now(self):
        """Sitting exactly on a boundary yields the NEXT slot, not this one."""
        now = datetime(2026, 7, 13, 12, 15, tzinfo=UTC)
        nxt = crud.compute_next_fire_at("*/15 * * * *", enabled=True, now=now)
        assert nxt == datetime(2026, 7, 13, 12, 30, tzinfo=UTC)
        assert nxt is not None and nxt > now


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


class TestCrud:
    """CRUD lifecycle: create → list → get → update → delete."""

    @pytest.mark.asyncio
    async def test_create_then_list_then_get(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        before = datetime.now(UTC)
        row = await _make_run(
            async_db_session, test_user, _workflow, name="daily", cron="0 9 * * *"
        )

        assert row.id is not None
        assert row.name == "daily"
        assert row.cron_expression == "0 9 * * *"
        assert row.target == "auto"
        assert row.enabled is True
        # The row IS the schedule: next_fire_at is seeded on create.
        assert row.next_fire_at is not None
        assert row.next_fire_at == _expected_next("0 9 * * *", around=before)
        assert row.next_fire_at > before

        rows = await crud.list_scheduled_runs(async_db_session, test_user.id)
        assert len(rows) == 1
        assert rows[0].id == row.id

        fetched = await crud.get_scheduled_run(async_db_session, test_user.id, row.id)
        assert fetched is not None
        assert fetched.id == row.id
        assert fetched.next_fire_at == row.next_fire_at

    @pytest.mark.asyncio
    async def test_create_disabled_has_no_next_fire_at(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """A schedule created disabled must never enter the due-row poll."""
        row = await _make_run(async_db_session, test_user, _workflow, enabled=False)

        assert row.enabled is False
        assert row.next_fire_at is None

    @pytest.mark.asyncio
    async def test_update_cron_recomputes_next_fire_at(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """Changing the cron moves the pending fire to the new cron's next slot."""
        row = await _make_run(async_db_session, test_user, _workflow, cron="0 9 * * *")
        original = row.next_fire_at
        assert original is not None

        before = datetime.now(UTC)
        updated = await crud.update_scheduled_run(
            async_db_session,
            test_user.id,
            row.id,
            ScheduledWorkflowRunUpdate(cron_expression="*/15 * * * *"),
        )

        assert updated.cron_expression == "*/15 * * * *"
        assert updated.next_fire_at is not None
        assert updated.next_fire_at != original
        assert updated.next_fire_at == _expected_next("*/15 * * * *", around=before)

    @pytest.mark.asyncio
    async def test_update_name_only_leaves_next_fire_at_untouched(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """A cosmetic rename must not reschedule the pending fire."""
        row = await _make_run(async_db_session, test_user, _workflow, name="initial")
        original = row.next_fire_at
        assert original is not None

        updated = await crud.update_scheduled_run(
            async_db_session,
            test_user.id,
            row.id,
            ScheduledWorkflowRunUpdate(name="renamed"),
        )

        assert updated.name == "renamed"
        assert updated.next_fire_at == original

    @pytest.mark.asyncio
    async def test_update_target_only_leaves_next_fire_at_untouched(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """Regression: re-targeting a schedule must not shift its timing.

        ``target`` says *where* the workflow dispatches, never *when*. If a
        target edit recomputed ``next_fire_at``, editing a schedule shortly
        before its slot would silently push the fire a whole cron window out.
        """
        row = await _make_run(async_db_session, test_user, _workflow, cron="0 9 * * *")
        original = row.next_fire_at
        assert original is not None

        new_target = uuid4()
        updated = await crud.update_scheduled_run(
            async_db_session,
            test_user.id,
            row.id,
            ScheduledWorkflowRunUpdate(target=new_target),
        )

        assert updated.target == str(new_target)
        assert updated.next_fire_at == original

    @pytest.mark.asyncio
    async def test_disable_clears_then_reenable_recomputes(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """enabled=False → NULL (row + history kept); re-enable → recomputed."""
        row = await _make_run(async_db_session, test_user, _workflow, cron="0 9 * * *")
        assert row.next_fire_at is not None

        disabled = await crud.update_scheduled_run(
            async_db_session,
            test_user.id,
            row.id,
            ScheduledWorkflowRunUpdate(enabled=False),
        )
        assert disabled.enabled is False
        assert disabled.next_fire_at is None

        # The row survives a disable — only the schedule stops.
        still_there = await crud.get_scheduled_run(
            async_db_session, test_user.id, row.id
        )
        assert still_there is not None

        before = datetime.now(UTC)
        reenabled = await crud.update_scheduled_run(
            async_db_session,
            test_user.id,
            row.id,
            ScheduledWorkflowRunUpdate(enabled=True),
        )
        assert reenabled.enabled is True
        assert reenabled.next_fire_at is not None
        assert reenabled.next_fire_at == _expected_next("0 9 * * *", around=before)

    @pytest.mark.asyncio
    async def test_delete_removes_row(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """Delete just deletes — the row was the whole schedule."""
        row = await _make_run(async_db_session, test_user, _workflow)

        await crud.delete_scheduled_run(async_db_session, test_user.id, row.id)

        gone = await crud.get_scheduled_run(async_db_session, test_user.id, row.id)
        assert gone is None

    @pytest.mark.asyncio
    async def test_create_rejects_foreign_workflow(
        self,
        async_db_session: AsyncSession,
        test_user: User,
    ):
        """Creating a schedule for a workflow you don't own → 404."""
        other = User(
            email=f"other_{uuid4()}@x.com",
            username=f"other_{uuid4().hex[:8]}",
            full_name="Other",
            is_active=True,
            is_verified=True,
        )
        async_db_session.add(other)
        await async_db_session.commit()
        await async_db_session.refresh(other)
        wf = UnifiedWorkflow(created_by_user_id=other.id, name="theirs")
        async_db_session.add(wf)
        await async_db_session.commit()
        await async_db_session.refresh(wf)

        with pytest.raises(HTTPException) as exc_info:
            await _make_run(async_db_session, test_user, wf)
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


class TestSchemaValidation:
    """Invalid cron expressions are rejected at the schema layer."""

    def test_invalid_cron_rejected(self):
        """Malformed cron → ValidationError (→ FastAPI 422)."""
        with pytest.raises(Exception) as exc_info:
            ScheduledWorkflowRunCreate(
                name="x",
                cron_expression="not a cron",
                workflow_id=uuid4(),
            )
        # Pydantic validation errors have "validation" in the repr.
        assert "cron" in str(exc_info.value).lower()

    def test_valid_cron_accepted(self):
        c = ScheduledWorkflowRunCreate(
            name="x", cron_expression="*/5 * * * *", workflow_id=uuid4()
        )
        assert c.cron_expression == "*/5 * * * *"

    def test_6_field_cron_rejected(self):
        """We deliberately reject 6-field (with seconds) crons."""
        with pytest.raises(Exception):
            ScheduledWorkflowRunCreate(
                name="x",
                cron_expression="0 0 9 * * *",
                workflow_id=uuid4(),
            )


# ---------------------------------------------------------------------------
# run-now endpoint
# ---------------------------------------------------------------------------


class TestRunNow:
    """``POST /scheduled-runs/{id}/run-now`` fires synchronously and returns
    the REAL outcome (no Celery task_id for work that never ran)."""

    @pytest.mark.asyncio
    async def test_run_now_awaits_fire_and_returns_real_result(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        row = await _make_run(async_db_session, test_user, _workflow)

        fire = AsyncMock(
            return_value={
                "status": "dispatched",
                "execution_id": "exec-123",
                "runner_id": "runner-abc",
            }
        )
        # The endpoint imports the symbol lazily inside the handler, so patching
        # it on the job module is what the call site actually resolves.
        with patch("app.jobs.scheduled_dispatch.fire_scheduled_run", fire):
            result = await run_scheduled_run_now_endpoint(
                run_id=row.id,
                db=async_db_session,
                current_user=test_user,
            )

        fire.assert_awaited_once_with(str(row.id))
        # The real dispatch outcome is surfaced — not a task_id.
        assert result["scheduled_run_id"] == str(row.id)
        assert result["status"] == "dispatched"
        assert result["execution_id"] == "exec-123"
        assert result["runner_id"] == "runner-abc"
        assert "task_id" not in result

    @pytest.mark.asyncio
    async def test_run_now_raises_the_dispatchers_status_on_failure(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """A failed dispatch is an HTTP ERROR carrying the dispatcher's status.

        Returning 200 with ``{"status": "failed"}`` would tell the caller "OK" for
        a workflow we did not run, and the frontend — which expects a dispatch
        payload — would then dereference a missing ``execution_id``. The user must
        see the real cause (the runner is offline), so we re-raise 503.
        """
        row = await _make_run(async_db_session, test_user, _workflow)

        fire = AsyncMock(
            return_value={
                "status": "failed",
                "reason": "dispatch_error",
                "status_code": 503,
                "code": "runner_offline",
                "error": "[503 runner_offline] no runners online",
            }
        )
        with (
            patch("app.jobs.scheduled_dispatch.fire_scheduled_run", fire),
            pytest.raises(HTTPException) as exc,
        ):
            await run_scheduled_run_now_endpoint(
                run_id=row.id,
                db=async_db_session,
                current_user=test_user,
            )

        assert exc.value.status_code == 503
        assert "runner_offline" in str(exc.value.detail)

    @pytest.mark.asyncio
    async def test_run_now_raises_409_when_skipped(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """A skipped fire (row disabled/vanished) is a 409, not a fake 200."""
        row = await _make_run(async_db_session, test_user, _workflow)

        fire = AsyncMock(return_value={"status": "skipped", "reason": "disabled"})
        with (
            patch("app.jobs.scheduled_dispatch.fire_scheduled_run", fire),
            pytest.raises(HTTPException) as exc,
        ):
            await run_scheduled_run_now_endpoint(
                run_id=row.id,
                db=async_db_session,
                current_user=test_user,
            )

        assert exc.value.status_code == 409
        assert "disabled" in str(exc.value.detail)

    @pytest.mark.asyncio
    async def test_run_now_does_not_shift_next_fire_at(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """A manual out-of-band fire must not move the cron schedule."""
        row = await _make_run(async_db_session, test_user, _workflow, cron="0 9 * * *")
        original = row.next_fire_at
        assert original is not None

        fire = AsyncMock(return_value={"status": "dispatched", "execution_id": "e"})
        with patch("app.jobs.scheduled_dispatch.fire_scheduled_run", fire):
            await run_scheduled_run_now_endpoint(
                run_id=row.id,
                db=async_db_session,
                current_user=test_user,
            )

        await async_db_session.refresh(row)
        assert row.next_fire_at == original

    @pytest.mark.asyncio
    async def test_run_now_404_on_foreign_row(
        self, async_db_session: AsyncSession, test_user: User
    ):
        with pytest.raises(HTTPException) as exc_info:
            await run_scheduled_run_now_endpoint(
                run_id=uuid4(),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Endpoint plumbing — verify the handlers wire CRUD correctly
# ---------------------------------------------------------------------------


class TestEndpointWiring:
    """Smoke tests for the route handlers themselves."""

    @pytest.mark.asyncio
    async def test_create_endpoint(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        result = await create_scheduled_run_endpoint(
            payload=ScheduledWorkflowRunCreate(
                name="endpoint",
                cron_expression="0 9 * * *",
                target="auto",
                workflow_id=_workflow.id,
            ),
            db=async_db_session,
            current_user=test_user,
        )
        assert result.name == "endpoint"
        # The response shape carries next_fire_at so the UI can show "next run".
        assert result.next_fire_at is not None
        assert result.next_fire_at > datetime.now(UTC) - timedelta(seconds=5)

    @pytest.mark.asyncio
    async def test_list_endpoint_empty(
        self, async_db_session: AsyncSession, test_user: User
    ):
        result = await list_scheduled_runs_endpoint(
            workflow_id=None,
            db=async_db_session,
            current_user=test_user,
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_update_endpoint_404_on_missing(
        self, async_db_session: AsyncSession, test_user: User
    ):
        with pytest.raises(HTTPException) as exc_info:
            await update_scheduled_run_endpoint(
                run_id=uuid4(),
                payload=ScheduledWorkflowRunUpdate(name="nope"),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_endpoint_404_on_missing(
        self, async_db_session: AsyncSession, test_user: User
    ):
        with pytest.raises(HTTPException) as exc_info:
            await delete_scheduled_run_endpoint(
                run_id=uuid4(),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Unsatisfiable cron — valid syntax, but never occurs
# ---------------------------------------------------------------------------


class TestUnsatisfiableCron:
    """A cron that parses but can never fire must 422, not 500.

    ``croniter.is_valid("0 0 30 2 *")`` is True (the schema layer's only check),
    but ``get_next()`` then raises ``CroniterBadDateError`` — February has no
    30th. The old RedBeat path built a Celery ``crontab`` object and never
    evaluated it, so this typo was silently accepted; now that we actually
    compute ``next_fire_at`` on write, an unguarded call would 500 on the user.
    """

    def test_compute_next_fire_at_raises_422_on_impossible_cron(self):
        with pytest.raises(HTTPException) as exc:
            crud.compute_next_fire_at("0 0 30 2 *", enabled=True)

        assert exc.value.status_code == 422
        assert "never occurs" in str(exc.value.detail)

    def test_disabled_impossible_cron_is_not_evaluated(self):
        """A disabled row short-circuits to NULL before croniter ever runs."""
        assert crud.compute_next_fire_at("0 0 30 2 *", enabled=False) is None

    @pytest.mark.asyncio
    async def test_create_with_impossible_cron_is_422_not_500(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        payload = ScheduledWorkflowRunCreate(
            workflow_id=_workflow.id,
            name="feb-30",
            cron_expression="0 0 30 2 *",
            target="auto",
            enabled=True,
        )
        with pytest.raises(HTTPException) as exc:
            await crud.create_scheduled_run(async_db_session, test_user.id, payload)

        assert exc.value.status_code == 422
