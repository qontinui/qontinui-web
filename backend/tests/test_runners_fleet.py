"""
Integration tests for the runner fleet registry.

Covers registration, heartbeat, idempotence, and ownership guards. Each test
drives the service layer (``app.crud.runner_crud``) and the authentication
helper (``app.api.deps.get_runner_user_from_token``) directly rather than
going through the HTTP stack, because the HTTP test fixtures in this repo
don't spin up a full FastAPI app with the new router wired in.
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_runner_user_from_token
from app.crud import runner_crud
from app.models.user import User


@pytest_asyncio.fixture
async def _other_user(async_db_session: AsyncSession) -> User:
    """Create a second user for ownership-boundary tests."""
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


class TestRunnerRegistration:
    """Registration must require a valid runner token and be idempotent."""

    @pytest.mark.asyncio
    async def test_register_with_valid_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """A valid token authenticates the caller and creates a runner row."""
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session, user_id=test_user.id, name="valid-token"
        )

        user, token = await get_runner_user_from_token(plain_token, async_db_session)
        assert user.id == test_user.id
        assert token.id == token_record.id

        runner = await runner_crud.register_runner(
            async_db_session,
            user_id=token.user_id,
            name="runner-a",
            hostname="127.0.0.1",
            port=1420,
            capabilities=["gui_automation"],
            server_mode=True,
            restate_enabled=False,
            restate_healthy=False,
            runner_token_id=token.id,
        )
        assert runner.user_id == test_user.id
        assert runner.status == "healthy"
        assert runner.last_heartbeat is not None

    @pytest.mark.asyncio
    async def test_register_with_invalid_token(self, async_db_session: AsyncSession):
        """An unknown token must yield HTTP 401."""
        with pytest.raises(HTTPException) as exc_info:
            await get_runner_user_from_token(
                "qontinui_runner_deadbeef" * 4, async_db_session
            )
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_idempotent_registration(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Re-registering with the same name updates, not duplicates."""
        first = await runner_crud.register_runner(
            async_db_session,
            user_id=test_user.id,
            name="same-name",
            hostname="host-a",
            port=1420,
            capabilities=["gui_automation"],
            server_mode=True,
            restate_enabled=False,
            restate_healthy=False,
        )

        second = await runner_crud.register_runner(
            async_db_session,
            user_id=test_user.id,
            name="same-name",
            hostname="host-b",
            port=5555,
            capabilities=["accessibility"],
            server_mode=True,
            restate_enabled=True,
            restate_healthy=True,
        )

        assert second.id == first.id
        assert second.hostname == "host-b"
        assert second.port == 5555
        assert second.capabilities == ["accessibility"]
        assert second.restate_enabled is True
        assert second.restate_healthy is True

        rows = await runner_crud.list_runners(async_db_session, test_user.id)
        assert [r.id for r in rows].count(first.id) == 1


class TestRunnerHeartbeat:
    """Heartbeat updates liveness fields."""

    @pytest.mark.asyncio
    async def test_heartbeat_updates_status_and_timestamp(
        self, async_db_session: AsyncSession, test_user: User
    ):
        runner = await runner_crud.register_runner(
            async_db_session,
            user_id=test_user.id,
            name="runner-b",
            hostname="localhost",
            port=1420,
            capabilities=[],
            server_mode=True,
            restate_enabled=False,
            restate_healthy=False,
        )
        first_beat = runner.last_heartbeat
        assert first_beat is not None

        updated = await runner_crud.heartbeat_runner(
            async_db_session,
            runner_id=runner.id,
            restate_healthy=True,
            status_value="unhealthy",
        )
        assert updated is not None
        assert updated.id == runner.id
        assert updated.status == "unhealthy"
        assert updated.restate_healthy is True
        assert updated.last_heartbeat is not None
        assert updated.last_heartbeat >= first_beat

    @pytest.mark.asyncio
    async def test_heartbeat_missing_runner_returns_none(
        self, async_db_session: AsyncSession
    ):
        result = await runner_crud.heartbeat_runner(
            async_db_session,
            runner_id=uuid4(),
            restate_healthy=True,
            status_value="healthy",
        )
        assert result is None


class TestRunnerOwnership:
    """Deregistration and token revocation must honour ownership."""

    @pytest.mark.asyncio
    async def test_cannot_deregister_other_users_runner(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        runner = await runner_crud.register_runner(
            async_db_session,
            user_id=test_user.id,
            name="mine",
            hostname="h",
            port=1420,
            capabilities=[],
            server_mode=True,
            restate_enabled=False,
            restate_healthy=False,
        )

        with pytest.raises(HTTPException) as exc_info:
            await runner_crud.delete_runner(async_db_session, runner.id, _other_user.id)
        assert exc_info.value.status_code == 403

        # Owner can still delete
        await runner_crud.delete_runner(async_db_session, runner.id, test_user.id)
        assert await runner_crud.get_runner(async_db_session, runner.id) is None

    @pytest.mark.asyncio
    async def test_cannot_revoke_other_users_token(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        _other_user: User,
    ):
        token_record, _plain = await runner_crud.create_runner_token(
            db=async_db_session, user_id=test_user.id, name="mine-token"
        )

        with pytest.raises(HTTPException) as exc_info:
            await runner_crud.revoke_runner_token(
                async_db_session,
                token_id=token_record.id,
                user_id=_other_user.id,
            )
        assert exc_info.value.status_code == 403

        # Owner can revoke
        await runner_crud.revoke_runner_token(
            async_db_session,
            token_id=token_record.id,
            user_id=test_user.id,
        )
        refreshed = await runner_crud.get_runner_token(
            async_db_session, token_record.id
        )
        assert refreshed is not None
        assert refreshed.is_revoked is True
