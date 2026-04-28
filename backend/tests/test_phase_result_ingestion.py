"""
Integration tests for phase-result ingestion (Phase 3B).

Mirrors the approach used by ``test_runners_fleet.py``: drive the endpoint
handler and service layer directly against the transactional
``async_db_session`` fixture rather than going through the HTTP stack, since
the repo's HTTP test fixtures don't wire up a full FastAPI app with the new
router included.
"""

from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_runner_user_from_token
from app.api.v1.endpoints.events import ingest_phase_completed
from app.api.v1.endpoints.phase_results import get_phase_result, list_phase_results
from app.crud import runner_crud
from app.models.phase_result import PhaseResult
from app.models.runner import Runner
from app.models.runner_token import RunnerToken
from app.models.user import User
from app.models.workflow_event import WorkflowEvent, WorkflowEventType
from app.schemas.phase_result import PhaseResultIngestRequest, StepResultRecord

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def _other_user(async_db_session: AsyncSession) -> User:
    """Second user for ownership-boundary tests."""
    user = User(
        email=f"otheruser_{uuid4()}@example.com",
        username=f"otheruser_{uuid4().hex[:8]}",
        full_name="Other User",
        hashed_password="hashed_password",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


async def _mint_token(
    db: AsyncSession, user: User, name: str
) -> tuple[RunnerToken, str]:
    return await runner_crud.create_runner_token(db=db, user_id=user.id, name=name)


async def _register_runner(
    db: AsyncSession, user: User, *, name: str, token_id=None
) -> Runner:
    return await runner_crud.register_runner(
        db,
        user_id=user.id,
        name=name,
        hostname="127.0.0.1",
        port=1420,
        capabilities=["gui_automation"],
        restate_enabled=False,
        restate_healthy=False,
        runner_token_id=token_id,
    )


def _make_req_res() -> tuple[Request, Response]:
    """Build a minimal real Starlette Request (and matching Response) —
    slowapi's rate-limit decorator requires the real class (not a fake)."""
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


def _sample_payload(
    execution_id: str, phase: str = "verification"
) -> PhaseResultIngestRequest:
    return PhaseResultIngestRequest(
        execution_id=execution_id,
        phase=phase,  # type: ignore[arg-type]
        iteration=0,
        stage_index=None,
        success=True,
        all_passed=True,
        duration_ms=1234,
        failure_context=None,
        commit_hash="abc123",
        step_results=[
            StepResultRecord(
                step_id="s1",
                step_index=0,
                step_type="click",
                step_name="click-button",
                success=True,
                error=None,
                output_data={"ok": True},
                duration_ms=100,
                variables_set=None,
            ),
        ],
        variables_set={"foo": "bar"},
    )


# ---------------------------------------------------------------------------
# Ingestion tests
# ---------------------------------------------------------------------------


class TestPhaseResultIngestion:
    """``POST /api/v1/events/phase-completed`` behaviour."""

    @pytest.mark.asyncio
    async def test_ingest_with_valid_runner_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Valid token -> phase_result row + workflow_event row created."""
        token_record, plain = await _mint_token(async_db_session, test_user, "t-valid")
        user, token = await get_runner_user_from_token(plain, async_db_session)
        assert user.id == test_user.id

        runner = await _register_runner(
            async_db_session,
            test_user,
            name="runner-ingest",
            token_id=token.id,
        )

        payload = _sample_payload("exec-1")
        response = await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=payload,
            runner_token=token,
        )

        # Response reflects the persisted row.
        assert response.execution_id == "exec-1"
        assert response.phase == "verification"
        assert response.success is True
        assert response.all_passed is True
        assert response.commit_hash == "abc123"
        assert len(response.step_results) == 1

        # PhaseResult row exists
        result = await async_db_session.execute(
            select(PhaseResult).where(PhaseResult.execution_id == "exec-1")
        )
        rows = result.scalars().all()
        assert len(rows) == 1
        pr = rows[0]
        assert pr.runner_id == runner.id  # resolved from user's latest runner
        assert pr.phase == "verification"
        assert pr.duration_ms == 1234

        # WorkflowEvent row exists
        event_result = await async_db_session.execute(
            select(WorkflowEvent).where(
                WorkflowEvent.event_type == WorkflowEventType.PHASE_COMPLETED.value,
                WorkflowEvent.run_id == "exec-1",
            )
        )
        events = event_result.scalars().all()
        assert len(events) == 1
        event = events[0]
        assert event.user_id == test_user.id
        assert event.payload["phase_result_id"] == str(pr.id)
        assert event.payload["phase"] == "verification"
        assert event.payload["success"] is True

    @pytest.mark.asyncio
    async def test_ingest_without_runner_token_raises_401(
        self, async_db_session: AsyncSession
    ):
        """An unknown/malformed runner token must yield HTTP 401."""
        with pytest.raises(HTTPException) as exc_info:
            await get_runner_user_from_token(
                "qontinui_runner_" + "deadbeef" * 8, async_db_session
            )
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_ingest_with_no_registered_runner_persists_with_null_runner_id(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """If the user has no registered runner yet, runner_id is NULL but the
        ingest still succeeds."""
        _tk_row, plain = await _mint_token(async_db_session, test_user, "t-norunner")
        _user, token = await get_runner_user_from_token(plain, async_db_session)

        payload = _sample_payload("exec-norunner")
        response = await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=payload,
            runner_token=token,
        )
        assert response.execution_id == "exec-norunner"
        assert response.runner_id is None

    @pytest.mark.asyncio
    async def test_ingest_with_explicit_runner_id_attributes_correctly(
        self,
        async_db_session: AsyncSession,
        test_user: User,
    ):
        """An explicit ``runner_id`` in the payload wins over the
        most-recently-heartbeated fallback — required for users that own
        multiple runners.

        Also verifies that passing a ``runner_id`` belonging to a *different*
        user yields HTTP 403 (no cross-user attribution).
        """
        _tk, plain = await _mint_token(async_db_session, test_user, "t-multi")
        _user, token = await get_runner_user_from_token(plain, async_db_session)

        # Register two runners owned by the same user. `runner_old` is
        # registered first; `runner_new` is registered (and therefore has the
        # newer `created_at`/`last_heartbeat`) second.
        runner_old = await _register_runner(
            async_db_session,
            test_user,
            name="runner-old",
            token_id=token.id,
        )
        runner_new = await _register_runner(
            async_db_session,
            test_user,
            name="runner-new",
            token_id=token.id,
        )
        # Sanity check: the fallback heuristic would pick `runner_new`.
        assert runner_old.id != runner_new.id

        # Ingest with an explicit runner_id of `runner_old` — the OLDER runner.
        # If the handler honors payload.runner_id, the row is attributed to
        # runner_old. If it falls back to "most recent", it wrongly attributes
        # to runner_new.
        payload = _sample_payload("exec-multi")
        payload.runner_id = runner_old.id
        response = await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=payload,
            runner_token=token,
        )
        assert response.runner_id == str(runner_old.id)

        # The persisted row is attributed to runner_old, NOT runner_new.
        result = await async_db_session.execute(
            select(PhaseResult).where(PhaseResult.execution_id == "exec-multi")
        )
        rows = result.scalars().all()
        assert len(rows) == 1
        assert rows[0].runner_id == runner_old.id
        assert rows[0].runner_id != runner_new.id

    @pytest.mark.asyncio
    async def test_ingest_with_other_users_runner_id_raises_403(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        """Passing a ``runner_id`` that belongs to a different user's runner
        yields HTTP 403 — even when the caller's token is otherwise valid."""
        # User A's token
        _tk_a, plain_a = await _mint_token(async_db_session, test_user, "t-explicit-a")
        _user_a, token_a = await get_runner_user_from_token(plain_a, async_db_session)
        await _register_runner(
            async_db_session, test_user, name="runner-a3", token_id=token_a.id
        )
        # User B has their own registered runner.
        runner_b = await _register_runner(
            async_db_session, _other_user, name="runner-b3"
        )

        # User A submits a payload that points at User B's runner.
        payload = _sample_payload("exec-foreign")
        payload.runner_id = runner_b.id
        with pytest.raises(HTTPException) as exc_info:
            await ingest_phase_completed(
                background_tasks=BackgroundTasks(),
                db=async_db_session,
                payload=payload,
                runner_token=token_a,
            )
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_ingest_is_not_deduplicated(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Ingesting the same payload twice creates two rows — no dedupe."""
        _tk_row, plain = await _mint_token(async_db_session, test_user, "t-dupe")
        _user, token = await get_runner_user_from_token(plain, async_db_session)
        await _register_runner(
            async_db_session, test_user, name="runner-dupe", token_id=token.id
        )

        payload = _sample_payload("exec-dupe")
        await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=payload,
            runner_token=token,
        )
        await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=payload,
            runner_token=token,
        )

        result = await async_db_session.execute(
            select(PhaseResult).where(PhaseResult.execution_id == "exec-dupe")
        )
        assert len(result.scalars().all()) == 2


# ---------------------------------------------------------------------------
# Read endpoint tests
# ---------------------------------------------------------------------------


class TestPhaseResultReadEndpoints:
    """``GET /api/v1/phase-results?execution_id=...`` and by id."""

    @pytest.mark.asyncio
    async def test_list_by_execution_id_returns_in_order(
        self, async_db_session: AsyncSession, test_user: User
    ):
        _tk, plain = await _mint_token(async_db_session, test_user, "t-list")
        _user, token = await get_runner_user_from_token(plain, async_db_session)
        await _register_runner(
            async_db_session, test_user, name="runner-list", token_id=token.id
        )

        # Ingest three phases for the same execution
        for phase in ("setup", "verification", "completion"):
            await ingest_phase_completed(
                background_tasks=BackgroundTasks(),
                db=async_db_session,
                payload=_sample_payload("exec-list", phase=phase),
                runner_token=token,
            )

        # Forge a lightweight Request/Response for the handler signature.
        req, res = _make_req_res()

        results = await list_phase_results(
            request=req,
            response=res,
            db=async_db_session,
            current_user=test_user,
            execution_id="exec-list",
            limit=500,
            offset=0,
        )
        phases = [r.phase for r in results]
        assert phases == ["setup", "verification", "completion"]

    @pytest.mark.asyncio
    async def test_get_by_id_returns_record(
        self, async_db_session: AsyncSession, test_user: User
    ):
        _tk, plain = await _mint_token(async_db_session, test_user, "t-get")
        _user, token = await get_runner_user_from_token(plain, async_db_session)
        await _register_runner(
            async_db_session, test_user, name="runner-get", token_id=token.id
        )

        ingested = await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=_sample_payload("exec-get"),
            runner_token=token,
        )

        req, res = _make_req_res()

        got = await get_phase_result(
            request=req,
            response=res,
            db=async_db_session,
            current_user=test_user,
            phase_result_id=UUID(str(ingested.id)),
        )
        assert got.id == ingested.id
        assert got.execution_id == "exec-get"

    @pytest.mark.asyncio
    async def test_list_does_not_leak_across_users(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        """User A's list must not contain User B's phase results."""
        # User A
        _tk_a, plain_a = await _mint_token(async_db_session, test_user, "t-a")
        _user_a, token_a = await get_runner_user_from_token(plain_a, async_db_session)
        await _register_runner(
            async_db_session, test_user, name="runner-a", token_id=token_a.id
        )
        await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=_sample_payload("exec-shared"),
            runner_token=token_a,
        )

        # User B — same execution_id string, ingested under B's token
        _tk_b, plain_b = await _mint_token(async_db_session, _other_user, "t-b")
        _user_b, token_b = await get_runner_user_from_token(plain_b, async_db_session)
        await _register_runner(
            async_db_session, _other_user, name="runner-b", token_id=token_b.id
        )
        await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=_sample_payload("exec-shared"),
            runner_token=token_b,
        )

        # User A sees only their row
        req_a, res_a = _make_req_res()
        results_a = await list_phase_results(
            request=req_a,
            response=res_a,
            db=async_db_session,
            current_user=test_user,
            execution_id="exec-shared",
            limit=500,
            offset=0,
        )
        # User B sees only their row
        req_b, res_b = _make_req_res()
        results_b = await list_phase_results(
            request=req_b,
            response=res_b,
            db=async_db_session,
            current_user=_other_user,
            execution_id="exec-shared",
            limit=500,
            offset=0,
        )

        # Both got exactly one row — the one they own.
        assert len(results_a) == 1
        assert len(results_b) == 1
        # And the rows must differ (no leakage / double-count)
        assert results_a[0].id != results_b[0].id

    @pytest.mark.asyncio
    async def test_get_by_id_blocks_other_users(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        """Getting another user's phase result by id yields 404."""
        _tk_a, plain_a = await _mint_token(async_db_session, test_user, "t-a2")
        _user_a, token_a = await get_runner_user_from_token(plain_a, async_db_session)
        await _register_runner(
            async_db_session, test_user, name="runner-a2", token_id=token_a.id
        )
        ingested = await ingest_phase_completed(
            background_tasks=BackgroundTasks(),
            db=async_db_session,
            payload=_sample_payload("exec-a2"),
            runner_token=token_a,
        )

        # Other user tries to fetch User A's row -> 404
        req, res = _make_req_res()
        with pytest.raises(HTTPException) as exc_info:
            await get_phase_result(
                request=req,
                response=res,
                db=async_db_session,
                current_user=_other_user,
                phase_result_id=UUID(str(ingested.id)),
            )
        assert exc_info.value.status_code == 404
