"""End-to-end integration test for the server-mode runner flow.

Exercises the full register -> heartbeat -> dispatch -> ingest -> read-back
chain that connects the runner and qontinui-web over HTTP in server mode:

1. The runner mints a runner token via the web UI and starts with
   ``QONTINUI_SERVER_MODE=1`` + the token in its env.
2. The runner registers via ``POST /api/v1/runners/register``, receives a
   ``runner_id`` and a ``dispatch_secret``.
3. The runner heartbeats every 30s via
   ``POST /api/v1/runners/{runner_id}/heartbeat``.
4. A user dispatches a workflow via
   ``POST /api/v1/workflows/{id}/dispatch`` which POSTs to the runner's
   ``/api/workflows/run`` with ``Authorization: Bearer <dispatch_secret>``.
5. The runner emits phase results via
   ``POST /api/v1/events/phase-completed`` which persist ``phase_results``
   rows plus companion ``workflow_events`` rows (type=PHASE_COMPLETED).
6. The web UI reads the per-phase timeline via
   ``GET /api/v1/phase-results?execution_id=...``.

The runner binary itself is not launched. Its ``/api/workflows/run``
endpoint is mocked at the ``httpx.AsyncClient`` layer — every other hop is
real code running against the transactional test database.
"""

from datetime import timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks, HTTPException, Request, Response
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_runner_user_from_token
from app.api.v1.endpoints.events import ingest_phase_completed
from app.api.v1.endpoints.phase_results import list_phase_results
from app.api.v1.endpoints.runners_fleet import heartbeat, register_runner
from app.api.v1.endpoints.workflow_dispatch import dispatch_workflow
from app.crud import runner_crud
from app.models.phase_result import PhaseResult
from app.models.unified_workflow import UnifiedWorkflow
from app.models.user import User
from app.models.workflow_event import WorkflowEvent, WorkflowEventType
from app.schemas.phase_result import PhaseResultIngestRequest, StepResultRecord
from app.schemas.runner_fleet import (
    RecentCrashPayload,
    RunnerHeartbeatRequest,
    RunnerRegistrationRequest,
    UiErrorPayload,
)
from app.schemas.workflow_dispatch import WorkflowDispatchRequest

# ---------------------------------------------------------------------------
# Fixtures — local to this module so we can depend on the top-level
# ``async_db_session`` (transactional) fixture from ``tests/conftest.py``
# rather than the integration subdirectory's own ``db_session``.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def _server_user(async_db_session: AsyncSession) -> User:
    """Create a dedicated user for the server-runner flow."""
    user = User(
        email=f"serverflow_{uuid4()}@example.com",
        username=f"serverflow_{uuid4().hex[:8]}",
        full_name="Server Flow User",
        hashed_password="hashed_password",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


def _make_request() -> tuple[Request, Response]:
    """Forge a minimal Starlette ``Request``/``Response`` pair.

    ``list_phase_results`` is decorated with slowapi's rate limiter, which
    requires a real :class:`Request` (not a MagicMock) to inspect scope.
    """
    scope = {
        "type": "http",
        "method": "GET",
        "headers": [],
        "path": "/",
        "query_string": b"",
        "client": ("127.0.0.1", 0),
        "server": ("testserver", 80),
        "scheme": "http",
        "root_path": "",
        "http_version": "1.1",
    }
    return Request(scope), Response()


def _patch_httpx_post(response_payload: dict | None = None):
    """Return a context-manager + configure-callable that mocks the
    ``httpx.AsyncClient`` used inside ``workflow_dispatcher``.

    Mirrors the helper pattern from ``test_workflow_dispatch.py`` but
    specialised for this end-to-end test: the mock always returns HTTP 202
    with the given JSON body (default includes a synthetic ``execution_id``).
    """
    payload = response_payload or {"execution_id": "exec-e2e-server-flow"}
    mock_resp = MagicMock()
    mock_resp.status_code = 202
    mock_resp.json.return_value = payload
    mock_resp.text = str(payload)

    cm = patch("app.services.workflow_dispatcher.httpx.AsyncClient")

    def _configure(MockClient):
        instance = AsyncMock()
        instance.__aenter__.return_value = instance
        instance.__aexit__.return_value = False
        instance.post.return_value = mock_resp
        MockClient.return_value = instance
        return instance

    return cm, _configure


def _phase_payload(
    execution_id: str,
    phase: str,
    *,
    runner_id: UUID | None = None,
    duration_ms: int = 1000,
) -> PhaseResultIngestRequest:
    """Build a realistic ``PhaseResultIngestRequest`` for ``phase``."""
    return PhaseResultIngestRequest(
        runner_id=runner_id,
        execution_id=execution_id,
        phase=phase,  # type: ignore[arg-type]
        iteration=0 if phase == "agentic" else None,
        stage_index=None,
        success=True,
        all_passed=True,
        duration_ms=duration_ms,
        failure_context=None,
        commit_hash="e2edeadbeef",
        step_results=[
            StepResultRecord(
                step_id=f"{phase}-step-0",
                step_index=0,
                step_type="click",
                step_name=f"{phase}-click",
                success=True,
                error=None,
                output_data={"ok": True},
                duration_ms=duration_ms // 2,
                variables_set=None,
            ),
        ],
        variables_set={"phase": phase},
    )


# ---------------------------------------------------------------------------
# Happy-path: register -> heartbeat -> dispatch -> ingest -> read-back
# ---------------------------------------------------------------------------


class TestServerRunnerHappyPath:
    """Full round-trip with no failures — the smoke test for Phase 3F."""

    @pytest.mark.asyncio
    async def test_full_server_runner_flow(
        self,
        async_db_session: AsyncSession,
        _server_user: User,
    ) -> None:
        # Step 1 — create a runner token via the DB fixtures.
        _token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=_server_user.id,
            name="server-flow-token",
        )
        assert plain_token.startswith("qontinui_runner_")

        # Step 2 — register the runner with the plain token. Drives the same
        # handler the runner's ``register_with_retry`` loop calls at startup.
        _user, token = await get_runner_user_from_token(plain_token, async_db_session)

        registration = await register_runner(
            db=async_db_session,
            runner_token=token,
            payload=RunnerRegistrationRequest(
                name="server-flow-runner",
                hostname="127.0.0.1",
                port=9876,
                capabilities=["gui_automation", "accessibility"],
                server_mode=True,
                restate_enabled=True,
                restate_healthy=True,
            ),
        )
        assert isinstance(registration.runner_id, UUID)
        assert isinstance(registration.dispatch_secret, str)
        assert len(registration.dispatch_secret) == 64

        runner_id = registration.runner_id
        dispatch_secret = registration.dispatch_secret

        # Step 3 — heartbeat.
        beat = await heartbeat(
            db=async_db_session,
            runner_token=token,
            runner_id=runner_id,
            payload=RunnerHeartbeatRequest(restate_healthy=True, status="healthy"),
        )
        assert beat.id == runner_id
        assert beat.status == "healthy"
        assert beat.restate_healthy is True
        assert beat.last_heartbeat is not None

        # Step 4+5 — create a workflow owned by the user, then dispatch.
        workflow = UnifiedWorkflow(
            created_by_user_id=_server_user.id,
            name="server-flow-workflow",
        )
        async_db_session.add(workflow)
        await async_db_session.commit()
        await async_db_session.refresh(workflow)

        cm, configure = _patch_httpx_post({"execution_id": "exec-e2e-001"})
        with cm as MockClient:
            instance = configure(MockClient)
            dispatched = await dispatch_workflow(
                workflow_id=workflow.id,
                payload=WorkflowDispatchRequest(
                    target=runner_id, parent_task_run_id="parent-e2e"
                ),
                db=async_db_session,
                current_user=_server_user,
            )

        # The outbound POST used the runner's ``dispatch_secret`` as bearer —
        # the exact secret we just captured from registration.
        assert instance.post.call_count == 1
        _args, kwargs = instance.post.call_args
        assert kwargs["headers"]["Authorization"] == f"Bearer {dispatch_secret}"
        assert kwargs["json"]["workflow_id"] == str(workflow.id)
        assert kwargs["json"]["parent_task_run_id"] == "parent-e2e"
        # And it went to the runner's hostname:port.
        posted_url = instance.post.call_args[0][0]
        assert "127.0.0.1:9876" in posted_url
        assert posted_url.endswith("/api/workflows/run")

        # Response shape mirrors what the web UI surfaces.
        assert dispatched.execution_id == "exec-e2e-001"
        assert dispatched.runner_id == runner_id
        assert dispatched.runner_hostname == "127.0.0.1"
        assert dispatched.runner_port == 9876
        assert dispatched.dispatched_at is not None

        execution_id = dispatched.execution_id

        # Step 7 — ingest the first phase (setup).
        response_setup = await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=_phase_payload(
                execution_id, "setup", runner_id=runner_id, duration_ms=500
            ),
            runner_token=token,
        )
        assert response_setup.execution_id == execution_id
        assert response_setup.phase == "setup"
        assert response_setup.runner_id == str(runner_id)

        # Step 8 — remaining three phases, in order.
        for phase, duration in (
            ("verification", 750),
            ("agentic", 2500),
            ("completion", 250),
        ):
            resp = await ingest_phase_completed(
                background_tasks=BackgroundTasks(),
                db=async_db_session,
                payload=_phase_payload(
                    execution_id, phase, runner_id=runner_id, duration_ms=duration
                ),
                runner_token=token,
            )
            assert resp.phase == phase
            assert resp.execution_id == execution_id
            assert resp.runner_id == str(runner_id)

        # Step 9 — read back via the user-facing list endpoint.
        req, res = _make_request()
        results = await list_phase_results(
            request=req,
            response=res,
            db=async_db_session,
            current_user=_server_user,
            execution_id=execution_id,
            limit=500,
            offset=0,
        )
        phases = [r.phase for r in results]
        assert phases == ["setup", "verification", "agentic", "completion"]
        # Every row is attributed to the runner we registered.
        assert all(r.runner_id == str(runner_id) for r in results)

        # Step 10 — confirm the companion workflow_events rows exist. There is
        # one WorkflowEvent per phase, each carrying the phase_result_id in
        # its payload.
        event_rows = (
            (
                await async_db_session.execute(
                    select(WorkflowEvent)
                    .where(
                        WorkflowEvent.event_type
                        == WorkflowEventType.PHASE_COMPLETED.value,
                        WorkflowEvent.run_id == execution_id,
                    )
                    .order_by(WorkflowEvent.timestamp.asc())
                )
            )
            .scalars()
            .all()
        )
        assert len(event_rows) == 4

        phase_ids_by_phase = {r.phase: r.id for r in results}
        for event in event_rows:
            assert event.user_id == _server_user.id
            assert event.payload is not None
            payload = cast(dict[str, Any], event.payload)
            phase = cast(str, payload["phase"])
            pr_id = cast(str, payload["phase_result_id"])
            # Every event payload's phase_result_id is a real PhaseResult row.
            row = (
                await async_db_session.execute(
                    select(PhaseResult).where(PhaseResult.id == UUID(pr_id))
                )
            ).scalar_one_or_none()
            assert row is not None
            assert row.phase == phase
            # And the id matches the one returned by the list endpoint.
            assert str(phase_ids_by_phase[phase]) == pr_id


# ---------------------------------------------------------------------------
# Heartbeat schema extensions — Phase 3J.5 + post-3J follow-up.
# ---------------------------------------------------------------------------


class TestHeartbeatStateExtensions:
    """End-to-end coverage of the post-Phase-3F heartbeat payload extensions.

    These tests drive the same ``heartbeat`` handler the runner's
    server-mode loop calls, with the extended payload (``derived_status``,
    ``ui_error``, ``recent_crash``) that post-Phase-3J runners emit. They
    guard against the full Pydantic → CRUD → response round-trip silently
    dropping a field.
    """

    @pytest.mark.asyncio
    async def test_heartbeat_persists_and_clears_recent_crash(
        self,
        async_db_session: AsyncSession,
        _server_user: User,
    ) -> None:
        _tk, plain = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=_server_user.id,
            name="crash-runner-token",
        )
        _user, token = await get_runner_user_from_token(plain, async_db_session)

        registration = await register_runner(
            db=async_db_session,
            runner_token=token,
            payload=RunnerRegistrationRequest(
                name="crash-runner",
                hostname="127.0.0.1",
                port=9876,
                capabilities=[],
                server_mode=True,
                restate_enabled=False,
                restate_healthy=False,
            ),
        )
        runner_id = registration.runner_id

        # Step 1 — heartbeat carrying a crash dump + ui_error. The runner's
        # post-3J payload tips `derived_status` to "errored" when either
        # signal is present; we assert both are stored verbatim so fleet
        # consumers can branch on presence rather than re-deriving.
        crash_in = RecentCrashPayload(
            file_path="D:/.dev-logs/crash_http.txt",
            reported_at=utc_now(),
            panic_location="src-tauri/src/foo.rs:42:9",
            panic_message="http-path boom",
            thread="main",
        )
        ui_in = UiErrorPayload(
            message="unrelated render error",
            first_seen=utc_now(),
            reported_at=utc_now(),
            count=3,
        )
        errored = await heartbeat(
            db=async_db_session,
            runner_token=token,
            runner_id=runner_id,
            payload=RunnerHeartbeatRequest(
                restate_healthy=False,
                status="healthy",
                derived_status="errored",
                ui_error=ui_in,
                recent_crash=crash_in,
            ),
        )
        assert errored.derived_status == "errored"
        assert errored.ui_error is not None
        assert errored.ui_error["message"] == "unrelated render error"
        assert errored.ui_error["count"] == 3
        assert errored.recent_crash is not None
        assert errored.recent_crash["file_path"] == "D:/.dev-logs/crash_http.txt"
        assert errored.recent_crash["panic_message"] == "http-path boom"
        assert errored.recent_crash["panic_location"] == "src-tauri/src/foo.rs:42:9"
        assert errored.recent_crash["thread"] == "main"

        # Step 2 — a subsequent heartbeat without the error fields clears
        # both JSONB columns. This matches the runner-side "authoritative
        # per heartbeat" contract: the runner holds the current outstanding
        # error/crash and every heartbeat reflects that snapshot.
        cleared = await heartbeat(
            db=async_db_session,
            runner_token=token,
            runner_id=runner_id,
            payload=RunnerHeartbeatRequest(
                restate_healthy=False,
                status="healthy",
                derived_status="healthy",
            ),
        )
        assert cleared.derived_status == "healthy"
        assert cleared.ui_error is None
        assert cleared.recent_crash is None

    @pytest.mark.asyncio
    async def test_heartbeat_accepts_minimal_body_from_pre_3j_runner(
        self,
        async_db_session: AsyncSession,
        _server_user: User,
    ) -> None:
        """Pre-Phase-3J runners still heartbeat with only ``restate_healthy``
        + ``status``. The new optional fields must default to ``None`` on the
        request model without rejecting the body."""
        _tk, plain = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=_server_user.id,
            name="legacy-runner-token",
        )
        _user, token = await get_runner_user_from_token(plain, async_db_session)

        registration = await register_runner(
            db=async_db_session,
            runner_token=token,
            payload=RunnerRegistrationRequest(
                name="legacy-runner",
                hostname="127.0.0.1",
                port=9876,
                capabilities=[],
                server_mode=True,
                restate_enabled=False,
                restate_healthy=False,
            ),
        )

        beat = await heartbeat(
            db=async_db_session,
            runner_token=token,
            runner_id=registration.runner_id,
            payload=RunnerHeartbeatRequest(restate_healthy=True, status="healthy"),
        )
        assert beat.derived_status is None
        assert beat.ui_error is None
        assert beat.recent_crash is None


# ---------------------------------------------------------------------------
# Failure paths.
# ---------------------------------------------------------------------------


class TestServerRunnerFailurePaths:
    """The three negative cases Phase 3F calls out."""

    @pytest.mark.asyncio
    async def test_dispatch_auto_with_stale_runner_returns_503(
        self,
        async_db_session: AsyncSession,
        _server_user: User,
    ) -> None:
        """A runner whose last_heartbeat is older than the 90s health window
        must be rejected by ``target="auto"`` with 503
        ``no_healthy_runner``."""
        _tk, plain = await runner_crud.create_runner_token(
            db=async_db_session, user_id=_server_user.id, name="stale-token"
        )
        _user, token = await get_runner_user_from_token(plain, async_db_session)

        # Register then push the heartbeat > 90s into the past.
        registration = await register_runner(
            db=async_db_session,
            runner_token=token,
            payload=RunnerRegistrationRequest(
                name="stale-runner",
                hostname="127.0.0.1",
                port=9876,
                capabilities=[],
                server_mode=True,
                restate_enabled=True,
                restate_healthy=True,
            ),
        )
        runner_row = await runner_crud.get_runner(
            async_db_session, registration.runner_id
        )
        assert runner_row is not None
        runner_row.last_heartbeat = utc_now() - timedelta(seconds=180)
        await async_db_session.commit()

        wf = UnifiedWorkflow(created_by_user_id=_server_user.id, name="stale-wf")
        async_db_session.add(wf)
        await async_db_session.commit()
        await async_db_session.refresh(wf)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target="auto"),
                db=async_db_session,
                current_user=_server_user,
            )
        assert exc_info.value.status_code == 503
        detail = cast(dict[str, Any], exc_info.value.detail)
        assert detail["code"] == "no_healthy_runner"

    @pytest.mark.asyncio
    async def test_event_ingestion_with_foreign_runner_id_returns_403(
        self,
        async_db_session: AsyncSession,
        _server_user: User,
    ) -> None:
        """Token from user A + payload ``runner_id`` owned by user B -> 403.

        This is the key cross-user guardrail on the event ingestion
        endpoint: the token authenticates the caller, and the caller must
        own the referenced runner.
        """
        # User A: runner + token.
        _tk_a, plain_a = await runner_crud.create_runner_token(
            db=async_db_session, user_id=_server_user.id, name="a-token"
        )
        _user_a, token_a = await get_runner_user_from_token(plain_a, async_db_session)
        _reg_a = await register_runner(
            db=async_db_session,
            runner_token=token_a,
            payload=RunnerRegistrationRequest(
                name="a-runner",
                hostname="127.0.0.1",
                port=9876,
                capabilities=[],
                server_mode=True,
                restate_enabled=False,
                restate_healthy=False,
            ),
        )

        # User B: a separate user who owns a separate runner.
        user_b = User(
            email=f"otheruser_{uuid4()}@example.com",
            username=f"otheruser_{uuid4().hex[:8]}",
            full_name="Other User",
            hashed_password="hashed_password",
            is_active=True,
            is_verified=True,
        )
        async_db_session.add(user_b)
        await async_db_session.commit()
        await async_db_session.refresh(user_b)

        runner_b = await runner_crud.register_runner(
            async_db_session,
            user_id=user_b.id,
            name="b-runner",
            hostname="10.0.0.2",
            port=9876,
            capabilities=[],
            server_mode=True,
            restate_enabled=False,
            restate_healthy=False,
        )

        # User A's token tries to attribute a phase result to user B's runner.
        payload = _phase_payload("exec-foreign", "setup", runner_id=runner_b.id)
        with pytest.raises(HTTPException) as exc_info:
            await ingest_phase_completed(
                background_tasks=BackgroundTasks(),
                db=async_db_session,
                payload=payload,
                runner_token=token_a,
            )
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_register_with_revoked_token_returns_401(
        self,
        async_db_session: AsyncSession,
        _server_user: User,
    ) -> None:
        """A revoked token cannot authenticate the register endpoint."""
        tk, plain = await runner_crud.create_runner_token(
            db=async_db_session, user_id=_server_user.id, name="will-revoke"
        )
        await runner_crud.revoke_runner_token(
            async_db_session, token_id=tk.id, user_id=_server_user.id
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_runner_user_from_token(plain, async_db_session)
        assert exc_info.value.status_code == 401
