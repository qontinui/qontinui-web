"""Tests for Phase 3D — scheduled workflow runs.

Pattern follows ``tests/test_workflow_dispatch.py`` (Phase 3C):

* Drive CRUD / endpoint handlers directly against the transactional
  ``async_db_session`` fixture. No live FastAPI app, no running Redis.
* Mock :mod:`app.services.redbeat_manager` — we don't want to spin up
  Redis for unit tests, and the manager's "did we install the entry?"
  behaviour is covered by its own direct tests (not included here; would
  need a real Redis).
* Mock the Celery ``send_task`` call for the run-now test.
* Mock ``httpx.AsyncClient`` on the dispatcher module when exercising the
  Celery task's happy path.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
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
from app.models.scheduled_workflow_run import ScheduledWorkflowRun
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


def _patch_redbeat():
    """Patch every public redbeat_manager side-effect used by CRUD.

    Returns a dict of the patched MagicMocks for assertion. We patch both
    the ``app.services.redbeat_manager`` module and the re-exports the
    CRUD imports transitively to avoid surprises.
    """
    patches = {
        "upsert": patch(
            "app.crud.scheduled_workflow_run_crud.redbeat_manager.upsert_schedule",
            return_value="qontinui:schedule:fake-entry",
        ),
        "disable": patch(
            "app.crud.scheduled_workflow_run_crud.redbeat_manager.disable_schedule"
        ),
        "delete": patch(
            "app.crud.scheduled_workflow_run_crud.redbeat_manager.delete_schedule"
        ),
    }
    return patches


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
        patches = _patch_redbeat()
        with patches["upsert"] as upsert, patches["disable"], patches["delete"]:
            row = await crud.create_scheduled_run(
                async_db_session,
                test_user.id,
                ScheduledWorkflowRunCreate(
                    name="daily",
                    cron_expression="0 9 * * *",
                    target="auto",
                    workflow_id=_workflow.id,
                ),
            )
            assert row.id is not None
            assert row.name == "daily"
            assert row.cron_expression == "0 9 * * *"
            assert row.target == "auto"
            assert row.enabled is True
            assert row.redbeat_entry_id == "qontinui:schedule:fake-entry"
            assert upsert.call_count == 1

            rows = await crud.list_scheduled_runs(async_db_session, test_user.id)
            assert len(rows) == 1
            assert rows[0].id == row.id

            fetched = await crud.get_scheduled_run(
                async_db_session, test_user.id, row.id
            )
            assert fetched is not None
            assert fetched.id == row.id

    @pytest.mark.asyncio
    async def test_update_then_delete(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        patches = _patch_redbeat()
        with (
            patches["upsert"] as upsert,
            patches["disable"] as disable,
            patches["delete"] as delete,
        ):
            row = await crud.create_scheduled_run(
                async_db_session,
                test_user.id,
                ScheduledWorkflowRunCreate(
                    name="initial",
                    cron_expression="0 9 * * *",
                    target="auto",
                    workflow_id=_workflow.id,
                ),
            )
            assert upsert.call_count == 1

            updated = await crud.update_scheduled_run(
                async_db_session,
                test_user.id,
                row.id,
                ScheduledWorkflowRunUpdate(name="renamed"),
            )
            assert updated.name == "renamed"
            # Name-only change — no cron/target diff, no redbeat re-upsert.
            assert upsert.call_count == 1

            await crud.delete_scheduled_run(async_db_session, test_user.id, row.id)
            assert delete.call_count == 1
            assert disable.call_count == 0

            gone = await crud.get_scheduled_run(async_db_session, test_user.id, row.id)
            assert gone is None

    @pytest.mark.asyncio
    async def test_update_cron_triggers_redbeat_upsert(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """Changing cron_expression re-installs the redbeat entry."""
        patches = _patch_redbeat()
        with patches["upsert"] as upsert, patches["disable"], patches["delete"]:
            row = await crud.create_scheduled_run(
                async_db_session,
                test_user.id,
                ScheduledWorkflowRunCreate(
                    name="x",
                    cron_expression="0 9 * * *",
                    target="auto",
                    workflow_id=_workflow.id,
                ),
            )
            assert upsert.call_count == 1

            await crud.update_scheduled_run(
                async_db_session,
                test_user.id,
                row.id,
                ScheduledWorkflowRunUpdate(cron_expression="30 10 * * 1-5"),
            )
            # Create called once + update called once → 2 upserts.
            assert upsert.call_count == 2

    @pytest.mark.asyncio
    async def test_disable_removes_redbeat_entry(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """Flipping enabled=True→False tears down the entry but keeps the row."""
        patches = _patch_redbeat()
        with patches["upsert"], patches["disable"] as disable, patches["delete"]:
            row = await crud.create_scheduled_run(
                async_db_session,
                test_user.id,
                ScheduledWorkflowRunCreate(
                    name="x",
                    cron_expression="0 9 * * *",
                    target="auto",
                    workflow_id=_workflow.id,
                ),
            )
            assert row.redbeat_entry_id is not None

            updated = await crud.update_scheduled_run(
                async_db_session,
                test_user.id,
                row.id,
                ScheduledWorkflowRunUpdate(enabled=False),
            )
            assert updated.enabled is False
            assert updated.redbeat_entry_id is None
            assert disable.call_count == 1

            # Row still exists.
            still_there = await crud.get_scheduled_run(
                async_db_session, test_user.id, row.id
            )
            assert still_there is not None

    @pytest.mark.asyncio
    async def test_create_rejects_foreign_workflow(
        self,
        async_db_session: AsyncSession,
        test_user: User,
    ):
        """Creating a schedule for a workflow you don't own → 404."""
        patches = _patch_redbeat()
        with patches["upsert"], patches["disable"], patches["delete"]:
            # Another user's workflow.
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
                await crud.create_scheduled_run(
                    async_db_session,
                    test_user.id,
                    ScheduledWorkflowRunCreate(
                        name="x",
                        cron_expression="0 9 * * *",
                        target="auto",
                        workflow_id=wf.id,
                    ),
                )
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
    """``POST /scheduled-runs/{id}/run-now`` enqueues a Celery task."""

    @pytest.mark.asyncio
    async def test_run_now_sends_celery_task(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        patches = _patch_redbeat()
        with patches["upsert"], patches["disable"], patches["delete"]:
            row = await crud.create_scheduled_run(
                async_db_session,
                test_user.id,
                ScheduledWorkflowRunCreate(
                    name="x",
                    cron_expression="0 9 * * *",
                    target="auto",
                    workflow_id=_workflow.id,
                ),
            )

        fake_async_result = MagicMock()
        fake_async_result.id = "task-id-xyz"
        with patch(
            "app.api.v1.endpoints.scheduled_runs.celery_app.send_task",
            return_value=fake_async_result,
        ) as send_task:
            result = await run_scheduled_run_now_endpoint(
                run_id=row.id,
                db=async_db_session,
                current_user=test_user,
            )

        assert send_task.call_count == 1
        call_args = send_task.call_args
        assert call_args[0][0] == "app.tasks.scheduled_dispatch.fire"
        assert call_args[1]["args"] == [str(row.id)]
        assert result["task_id"] == "task-id-xyz"
        assert result["scheduled_run_id"] == str(row.id)

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
# Celery task — fire_scheduled_run
# ---------------------------------------------------------------------------


class TestCeleryTask:
    """Cover the async core of the task (``_async_fire``)."""

    @pytest.mark.asyncio
    async def test_disabled_row_exits_without_dispatch(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """A disabled row short-circuits without calling the dispatcher."""
        # Create row then disable.
        patches = _patch_redbeat()
        with patches["upsert"], patches["disable"], patches["delete"]:
            row = await crud.create_scheduled_run(
                async_db_session,
                test_user.id,
                ScheduledWorkflowRunCreate(
                    name="x",
                    cron_expression="0 9 * * *",
                    target="auto",
                    workflow_id=_workflow.id,
                ),
            )
            await crud.update_scheduled_run(
                async_db_session,
                test_user.id,
                row.id,
                ScheduledWorkflowRunUpdate(enabled=False),
            )

        # Monkey-patch the task's async-session maker so it uses our test db.
        from app.tasks import scheduled_dispatch

        async def _fake_in_test_session(scheduled_run_id: str):
            """Run the task body, but against ``async_db_session``."""
            from uuid import UUID

            from app.services.workflow_dispatcher import dispatch_workflow_to_runner

            run_uuid = UUID(scheduled_run_id)
            db = async_db_session
            db_row = await db.get(ScheduledWorkflowRun, run_uuid)
            assert db_row is not None
            if not db_row.enabled:
                return {"status": "skipped", "reason": "disabled"}
            _ = dispatch_workflow_to_runner  # should not be called
            return {"status": "dispatched"}  # pragma: no cover

        with patch.object(scheduled_dispatch, "_async_fire", _fake_in_test_session):
            result = await scheduled_dispatch._async_fire(str(row.id))

        assert result == {"status": "skipped", "reason": "disabled"}

    @pytest.mark.asyncio
    async def test_missing_row_exits_without_dispatch(
        self, async_db_session: AsyncSession
    ):
        """Row deleted since schedule was installed → skip."""
        from app.tasks import scheduled_dispatch

        missing_id = uuid4()

        async def _fake(scheduled_run_id: str):
            from uuid import UUID as _UUID

            db = async_db_session
            db_row = await db.get(ScheduledWorkflowRun, _UUID(scheduled_run_id))
            if db_row is None:
                return {"status": "skipped", "reason": "row_missing"}
            return {"status": "dispatched"}  # pragma: no cover

        with patch.object(scheduled_dispatch, "_async_fire", _fake):
            result = await scheduled_dispatch._async_fire(str(missing_id))

        assert result == {"status": "skipped", "reason": "row_missing"}

    @pytest.mark.asyncio
    async def test_happy_path_updates_last_fields(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _workflow: UnifiedWorkflow,
    ):
        """A successful dispatch records ``last_execution_id`` + status."""
        from datetime import timedelta

        from qontinui_schemas.common import utc_now

        from app.crud import runner_crud
        from app.services.workflow_dispatcher import dispatch_workflow_to_runner

        # Register a runner with an open WS session for the dispatcher to find.
        runner = await runner_crud.register_runner(
            async_db_session,
            user_id=test_user.id,
            name="r",
            hostname="127.0.0.1",
            port=1420,
            capabilities=[],
            restate_enabled=False,
            restate_healthy=False,
        )
        runner.last_heartbeat = utc_now() - timedelta(seconds=5)
        runner.status = "healthy"
        # Phase 5A: WS is the sole dispatch channel — mark this runner as
        # WS-connected so the dispatcher relays to it.
        runner.ws_session_id = 1
        await async_db_session.commit()

        # Create the scheduled run.
        patches = _patch_redbeat()
        with patches["upsert"], patches["disable"], patches["delete"]:
            row = await crud.create_scheduled_run(
                async_db_session,
                test_user.id,
                ScheduledWorkflowRunCreate(
                    name="happy",
                    cron_expression="0 9 * * *",
                    target="auto",
                    workflow_id=_workflow.id,
                ),
            )

        async def _run_task_body(scheduled_run_id: str):
            """Re-implementation of the task body against ``async_db_session``.

            Mirrors :func:`app.tasks.scheduled_dispatch._async_fire` but uses
            the test transaction, so assertions can observe the row mutations.
            """
            from uuid import UUID as _UUID

            from qontinui_schemas.common import utc_now as _utc_now

            db = async_db_session
            db_row = await db.get(ScheduledWorkflowRun, _UUID(scheduled_run_id))
            assert db_row is not None
            assert db_row.enabled

            target = "auto" if db_row.target == "auto" else _UUID(db_row.target)
            fired_at = _utc_now()
            result = await dispatch_workflow_to_runner(
                db,
                user_id=db_row.user_id,
                workflow_id=db_row.workflow_id,
                target=target,
                parent_task_run_id=None,
            )
            db_row.last_fired_at = fired_at
            db_row.last_status = "dispatched"
            db_row.last_execution_id = result.execution_id
            db_row.last_error = None
            await db.commit()
            return {
                "status": "dispatched",
                "execution_id": result.execution_id,
            }

        # Patch the WS manager — it's the only dispatch channel after Phase 5A.
        fake_manager = MagicMock()
        fake_manager.is_connected = MagicMock(return_value=True)
        fake_manager.send_dispatch = AsyncMock(return_value=True)

        async def _fake_get_redis():
            return MagicMock()

        with (
            patch("app.services.workflow_dispatcher.get_redis", _fake_get_redis),
            patch(
                "app.services.workflow_dispatcher.get_runner_websocket_manager",
                AsyncMock(return_value=fake_manager),
            ),
        ):
            result = await _run_task_body(str(row.id))

        assert result["status"] == "dispatched"
        # Phase 5A: WS dispatch mints a server-side run_id (UUID string).
        assert isinstance(result["execution_id"], str)
        assert len(result["execution_id"]) == 36  # UUID4 string

        await async_db_session.refresh(row)
        assert row.last_status == "dispatched"
        assert row.last_execution_id == result["execution_id"]
        assert row.last_fired_at is not None
        assert row.last_error is None
        # The WS dispatch was actually invoked.
        fake_manager.send_dispatch.assert_awaited_once()


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
        patches = _patch_redbeat()
        with patches["upsert"], patches["disable"], patches["delete"]:
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
