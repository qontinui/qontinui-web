"""
Integration tests for ``POST /api/v1/workflows/{workflow_id}/dispatch`` —
Phase 3C of the web-side dispatch path.

Follows the pattern established by ``test_runners_fleet.py`` and
``test_phase_result_ingestion.py``: drive the endpoint handler directly
against the transactional ``async_db_session`` fixture. HTTP client fixtures
in this repo don't wire up a full FastAPI app with the new router included,
and testing the routing layer separately would be redundant with FastAPI's
own tests.

The outbound HTTP POST to the runner is stubbed with
``unittest.mock.patch`` on ``httpx.AsyncClient`` inside the dispatch module.
"""

from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.workflow_dispatch import dispatch_workflow
from app.crud import runner_crud
from app.models.runner import Runner
from app.models.unified_workflow import UnifiedWorkflow
from app.models.user import User
from app.schemas.workflow_dispatch import WorkflowDispatchRequest

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def _other_user(async_db_session: AsyncSession) -> User:
    """Create a second user for cross-user ownership tests."""
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


async def _make_workflow(
    db: AsyncSession, user: User, name: str = "wf"
) -> UnifiedWorkflow:
    """Create a minimal workflow owned by ``user``."""
    wf = UnifiedWorkflow(
        created_by_user_id=user.id,
        name=name,
    )
    db.add(wf)
    await db.commit()
    await db.refresh(wf)
    return wf


async def _make_runner(
    db: AsyncSession,
    user: User,
    *,
    name: str,
    server_mode: bool = True,
    heartbeat_age_seconds: int | None = 5,
    status_value: str = "healthy",
) -> Runner:
    """Register a runner, then optionally age its last_heartbeat.

    ``heartbeat_age_seconds`` is how far in the past to push ``last_heartbeat``
    relative to now, or ``None`` to clear the heartbeat (simulating a just-
    registered runner that the health window rejects).
    """
    runner = await runner_crud.register_runner(
        db,
        user_id=user.id,
        name=name,
        hostname="127.0.0.1",
        port=1420,
        capabilities=["gui_automation"],
        server_mode=server_mode,
        restate_enabled=False,
        restate_healthy=False,
    )
    # The freshly-registered heartbeat is "now"; override if the caller
    # wanted a different liveness window.
    if heartbeat_age_seconds is None:
        runner.last_heartbeat = None
    else:
        runner.last_heartbeat = utc_now() - timedelta(seconds=heartbeat_age_seconds)
    runner.status = status_value
    await db.commit()
    await db.refresh(runner)
    return runner


def _mock_httpx_response(
    *, status_code: int = 202, json_data: dict | None = None, text: str = ""
) -> MagicMock:
    """Build a MagicMock that looks like an httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    if json_data is not None:
        resp.json.return_value = json_data
        resp.text = text or str(json_data)
    else:
        resp.json.side_effect = ValueError("no json")
        resp.text = text
    return resp


def _patch_httpx(mock_response: MagicMock | None = None, *, side_effect=None):
    """Return a context-manager that patches the dispatch module's
    ``httpx.AsyncClient``.

    On entry: ``instance.post`` is configured to return ``mock_response`` or
    raise ``side_effect`` on call. The AsyncClient is used via
    ``async with httpx.AsyncClient(...) as client:`` — the mock wires up the
    context-manager protocol.
    """
    cm = patch("app.api.v1.endpoints.workflow_dispatch.httpx.AsyncClient")

    def _configure(MockClient):
        instance = AsyncMock()
        instance.__aenter__.return_value = instance
        instance.__aexit__.return_value = False
        if side_effect is not None:
            instance.post.side_effect = side_effect
        else:
            instance.post.return_value = mock_response
        MockClient.return_value = instance
        return instance

    return cm, _configure


# ---------------------------------------------------------------------------
# Auto-target tests
# ---------------------------------------------------------------------------


class TestAutoTarget:
    """``target="auto"`` picks the healthiest runner owned by the user."""

    @pytest.mark.asyncio
    async def test_auto_picks_most_recent_heartbeat(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Among multiple healthy runners, prefer the one with the newest
        heartbeat."""
        await _make_runner(
            async_db_session, test_user, name="older", heartbeat_age_seconds=60
        )
        newer = await _make_runner(
            async_db_session, test_user, name="newer", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, test_user)

        mock_resp = _mock_httpx_response(json_data={"execution_id": "exec-abc-123"})
        cm, configure = _patch_httpx(mock_resp)
        with cm as MockClient:
            instance = configure(MockClient)
            result = await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target="auto"),
                db=async_db_session,
                current_user=test_user,
            )

        assert result.runner_id == newer.id
        assert result.execution_id == "exec-abc-123"
        # Outbound POST went to the newer runner.
        posted_url = instance.post.call_args[0][0]
        assert "127.0.0.1:1420" in posted_url

    @pytest.mark.asyncio
    async def test_auto_no_healthy_runners_returns_503(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """All runners have stale heartbeats → 503 no_healthy_runner."""
        await _make_runner(
            async_db_session,
            test_user,
            name="stale",
            heartbeat_age_seconds=600,
        )
        wf = await _make_workflow(async_db_session, test_user)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target="auto"),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 503
        assert exc_info.value.detail["code"] == "no_healthy_runner"

    @pytest.mark.asyncio
    async def test_auto_no_runners_at_all_returns_503(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """User has no registered runners at all → 503 no_healthy_runner."""
        wf = await _make_workflow(async_db_session, test_user)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target="auto"),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_auto_ignores_other_users_healthy_runners(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        """A healthy runner owned by another user must not satisfy auto."""
        await _make_runner(
            async_db_session, _other_user, name="theirs", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, test_user)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target="auto"),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 503


# ---------------------------------------------------------------------------
# Explicit-target tests
# ---------------------------------------------------------------------------


class TestExplicitTarget:
    """``target=<runner_id>`` routes to that specific runner."""

    @pytest.mark.asyncio
    async def test_explicit_target_routes_to_runner(
        self, async_db_session: AsyncSession, test_user: User
    ):
        runner_a = await _make_runner(
            async_db_session, test_user, name="a", heartbeat_age_seconds=5
        )
        # Second healthy runner to make sure we don't accidentally pick the
        # most-recent one.
        await _make_runner(
            async_db_session, test_user, name="b", heartbeat_age_seconds=1
        )
        wf = await _make_workflow(async_db_session, test_user)

        mock_resp = _mock_httpx_response(json_data={"execution_id": "exec-a"})
        cm, configure = _patch_httpx(mock_resp)
        with cm as MockClient:
            configure(MockClient)
            result = await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target=runner_a.id),
                db=async_db_session,
                current_user=test_user,
            )

        assert result.runner_id == runner_a.id
        assert result.execution_id == "exec-a"

    @pytest.mark.asyncio
    async def test_explicit_target_other_users_runner_returns_404(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        """Targeting a runner owned by another user → 404 (we collapse
        not-found and not-owned to avoid leaking existence)."""
        other = await _make_runner(
            async_db_session, _other_user, name="theirs", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, test_user)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target=other.id),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_explicit_target_non_server_mode_returns_409(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """A non-server-mode runner → 409 runner_not_server_mode."""
        runner = await _make_runner(
            async_db_session,
            test_user,
            name="desktop",
            server_mode=False,
            heartbeat_age_seconds=5,
        )
        wf = await _make_workflow(async_db_session, test_user)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target=runner.id),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "runner_not_server_mode"

    @pytest.mark.asyncio
    async def test_explicit_target_unhealthy_returns_503(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """An owned server-mode runner with a stale heartbeat → 503."""
        runner = await _make_runner(
            async_db_session,
            test_user,
            name="stale",
            heartbeat_age_seconds=600,
        )
        wf = await _make_workflow(async_db_session, test_user)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target=runner.id),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 503
        assert exc_info.value.detail["code"] == "runner_unhealthy"

    @pytest.mark.asyncio
    async def test_explicit_target_nonexistent_returns_404(
        self, async_db_session: AsyncSession, test_user: User
    ):
        wf = await _make_workflow(async_db_session, test_user)

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target=uuid4()),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Outbound HTTP tests
# ---------------------------------------------------------------------------


class TestOutboundHttp:
    """The POST to the runner uses ``dispatch_secret`` as the bearer."""

    @pytest.mark.asyncio
    async def test_outbound_bearer_is_dispatch_secret(
        self, async_db_session: AsyncSession, test_user: User
    ):
        runner = await _make_runner(
            async_db_session, test_user, name="r", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, test_user)

        mock_resp = _mock_httpx_response(json_data={"execution_id": "e1"})
        cm, configure = _patch_httpx(mock_resp)
        with cm as MockClient:
            instance = configure(MockClient)
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(
                    target=runner.id, parent_task_run_id="parent-xyz"
                ),
                db=async_db_session,
                current_user=test_user,
            )

        # Assert outbound call shape.
        assert instance.post.call_count == 1
        _args, kwargs = instance.post.call_args
        assert kwargs["headers"]["Authorization"] == f"Bearer {runner.dispatch_secret}"
        assert kwargs["json"]["workflow_id"] == str(wf.id)
        assert kwargs["json"]["parent_task_run_id"] == "parent-xyz"

    @pytest.mark.asyncio
    async def test_runner_500_returns_502(
        self, async_db_session: AsyncSession, test_user: User
    ):
        runner = await _make_runner(
            async_db_session, test_user, name="r", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, test_user)

        mock_resp = _mock_httpx_response(status_code=500, text="upstream exploded")
        cm, configure = _patch_httpx(mock_resp)
        with cm as MockClient:
            configure(MockClient)
            with pytest.raises(HTTPException) as exc_info:
                await dispatch_workflow(
                    workflow_id=wf.id,
                    payload=WorkflowDispatchRequest(target=runner.id),
                    db=async_db_session,
                    current_user=test_user,
                )

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "runner_rejected"
        assert exc_info.value.detail["runner_status"] == 500

    @pytest.mark.asyncio
    async def test_runner_connect_error_returns_502(
        self, async_db_session: AsyncSession, test_user: User
    ):
        runner = await _make_runner(
            async_db_session, test_user, name="r", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, test_user)

        cm, configure = _patch_httpx(side_effect=httpx.ConnectError("refused"))
        with cm as MockClient:
            configure(MockClient)
            with pytest.raises(HTTPException) as exc_info:
                await dispatch_workflow(
                    workflow_id=wf.id,
                    payload=WorkflowDispatchRequest(target=runner.id),
                    db=async_db_session,
                    current_user=test_user,
                )

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "runner_unreachable"

    @pytest.mark.asyncio
    async def test_runner_returns_non_json_body(
        self, async_db_session: AsyncSession, test_user: User
    ):
        runner = await _make_runner(
            async_db_session, test_user, name="r", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, test_user)

        mock_resp = _mock_httpx_response(status_code=202, text="garbage")
        cm, configure = _patch_httpx(mock_resp)
        with cm as MockClient:
            configure(MockClient)
            with pytest.raises(HTTPException) as exc_info:
                await dispatch_workflow(
                    workflow_id=wf.id,
                    payload=WorkflowDispatchRequest(target=runner.id),
                    db=async_db_session,
                    current_user=test_user,
                )

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "runner_bad_response"


# ---------------------------------------------------------------------------
# Workflow ownership tests
# ---------------------------------------------------------------------------


class TestWorkflowOwnership:
    """A user cannot dispatch another user's workflow."""

    @pytest.mark.asyncio
    async def test_other_users_workflow_returns_404(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        """A workflow owned by another user → 404 (existence hidden)."""
        await _make_runner(
            async_db_session, test_user, name="r", heartbeat_age_seconds=5
        )
        wf = await _make_workflow(async_db_session, _other_user, name="theirs")

        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=wf.id,
                payload=WorkflowDispatchRequest(target="auto"),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_nonexistent_workflow_returns_404(
        self, async_db_session: AsyncSession, test_user: User
    ):
        with pytest.raises(HTTPException) as exc_info:
            await dispatch_workflow(
                workflow_id=uuid4(),
                payload=WorkflowDispatchRequest(target="auto"),
                db=async_db_session,
                current_user=test_user,
            )
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Dispatch secret rotation
# ---------------------------------------------------------------------------


class TestDispatchSecretRotation:
    """Re-registering a runner rotates the dispatch_secret."""

    @pytest.mark.asyncio
    async def test_re_registration_rotates_secret(
        self, async_db_session: AsyncSession, test_user: User
    ):
        first = await runner_crud.register_runner(
            async_db_session,
            user_id=test_user.id,
            name="same",
            hostname="h",
            port=1420,
            capabilities=[],
            server_mode=True,
            restate_enabled=False,
            restate_healthy=False,
        )
        first_secret = first.dispatch_secret
        assert isinstance(first_secret, str) and len(first_secret) == 64

        second = await runner_crud.register_runner(
            async_db_session,
            user_id=test_user.id,
            name="same",
            hostname="h",
            port=1420,
            capabilities=[],
            server_mode=True,
            restate_enabled=False,
            restate_healthy=False,
        )
        assert second.id == first.id
        assert second.dispatch_secret != first_secret
        assert len(second.dispatch_secret) == 64
