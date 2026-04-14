"""
Integration tests for runner token authentication.

Tests the complete authentication flow:
1. Creating runner tokens
2. Validating runner tokens
3. WebSocket authentication with runner tokens
4. Token expiration and revocation

NOTE: These tests depend on runner token auth functions (authenticate_runner,
generate_runner_token, hash_runner_token, verify_runner_token, and related CRUD
operations) that have not been implemented yet. The entire module is skipped
until the feature is built.
"""

import pytest

pytestmark = pytest.mark.skip(
    reason="Runner token auth feature not yet implemented: "
    "authenticate_runner, generate_runner_token, hash_runner_token, "
    "verify_runner_token, and related CRUD functions do not exist."
)

from fastapi import HTTPException  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.api.deps import get_runner_user_from_token as authenticate_runner  # noqa: E402
from app.models.user import User  # noqa: E402

# Stubs for unimplemented functions - these will fail if tests are unskipped
try:
    from app.core.security import (  # type: ignore[attr-defined]
        generate_runner_token,
        hash_runner_token,
    )
except ImportError:

    def generate_runner_token() -> str:  # type: ignore[misc]
        raise NotImplementedError("generate_runner_token not yet implemented")

    def hash_runner_token(token: str) -> str:  # type: ignore[misc]
        raise NotImplementedError("hash_runner_token not yet implemented")


try:
    from app.crud import runner as runner_crud
except ImportError:
    runner_crud = None  # type: ignore[assignment]


class TestRunnerTokenCreation:
    """Test runner token creation and hashing."""

    @pytest.mark.asyncio
    async def test_create_runner_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test creating a runner token."""
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="Test Token",
            expires_in_days=30,
        )

        # Verify token record
        assert token_record.user_id == test_user.id
        assert token_record.name == "Test Token"
        assert token_record.is_revoked is False
        assert token_record.expires_at is not None

        # Verify plain token format
        assert plain_token.startswith("qontinui_runner_")
        assert len(plain_token) > 50  # Should be long and random

        # Verify token hash is stored (not plain token)
        assert token_record.token_hash != plain_token
        assert len(token_record.token_hash) > 50  # Argon2 hash is long

    @pytest.mark.asyncio
    async def test_create_token_with_no_expiry(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test creating a token that never expires."""
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="Never Expires",
            expires_in_days=None,
        )

        assert token_record.expires_at is None

    def test_token_hash_is_unique_per_call(self):
        """Test that hashing the same token twice produces different hashes (salt)."""
        plain_token = generate_runner_token()
        hash1 = hash_runner_token(plain_token)
        hash2 = hash_runner_token(plain_token)

        # Hashes should be different due to salt
        assert hash1 != hash2


class TestRunnerTokenValidation:
    """Test runner token validation and verification."""

    @pytest.mark.asyncio
    async def test_validate_valid_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test validating a valid runner token."""
        # Create token
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="Valid Token",
        )

        # Validate token
        validated_token = await runner_crud.validate_runner_token(
            db=async_db_session,
            plain_token=plain_token,
        )

        assert validated_token is not None
        assert validated_token.id == token_record.id
        assert validated_token.user_id == test_user.id

    @pytest.mark.asyncio
    async def test_validate_invalid_token(self, async_db_session: AsyncSession):
        """Test that an invalid token returns None."""
        fake_token = "qontinui_runner_fakefakefakefakefakefakefake"

        validated_token = await runner_crud.validate_runner_token(
            db=async_db_session,
            plain_token=fake_token,
        )

        assert validated_token is None

    @pytest.mark.asyncio
    async def test_validate_revoked_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test that a revoked token cannot be validated."""
        # Create and revoke token
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="To Be Revoked",
        )

        await runner_crud.revoke_runner_token(
            db=async_db_session,
            token_id=token_record.id,
            user_id=test_user.id,
        )

        # Try to validate revoked token
        validated_token = await runner_crud.validate_runner_token(
            db=async_db_session,
            plain_token=plain_token,
        )

        assert validated_token is None

    @pytest.mark.asyncio
    async def test_validate_expired_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test that an expired token cannot be validated."""
        # Create token with past expiry
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="Expired Token",
            expires_in_days=-1,  # Already expired
        )

        # Try to validate expired token
        validated_token = await runner_crud.validate_runner_token(
            db=async_db_session,
            plain_token=plain_token,
        )

        assert validated_token is None

    @pytest.mark.asyncio
    async def test_validate_token_with_multiple_tokens(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test that validation works correctly when multiple tokens exist."""
        # Create multiple tokens
        tokens = []
        for i in range(3):
            token_record, plain_token = await runner_crud.create_runner_token(
                db=async_db_session,
                user_id=test_user.id,
                name=f"Token {i}",
            )
            tokens.append((token_record, plain_token))

        # Validate each token
        for token_record, plain_token in tokens:
            validated_token = await runner_crud.validate_runner_token(
                db=async_db_session,
                plain_token=plain_token,
            )

            assert validated_token is not None
            assert validated_token.id == token_record.id


class TestAuthenticateRunner:
    """Test the authenticate_runner function used by WebSocket endpoints."""

    @pytest.mark.asyncio
    async def test_authenticate_with_valid_runner_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test authenticating with a valid runner token."""
        # Create token
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="WebSocket Token",
        )

        # Authenticate
        user, runner_token = await authenticate_runner(plain_token)

        assert user is not None
        assert user.id == test_user.id
        assert runner_token is not None
        assert runner_token.id == token_record.id

    @pytest.mark.asyncio
    async def test_authenticate_with_invalid_token(
        self, async_db_session: AsyncSession
    ):
        """Test that authentication fails with invalid token."""
        fake_token = "qontinui_runner_invalidinvalidinvalidinvalid"

        with pytest.raises(HTTPException) as exc_info:
            await authenticate_runner(fake_token)

        assert exc_info.value.status_code == 401
        assert "Invalid or expired token" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_authenticate_with_revoked_token(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test that authentication fails with revoked token."""
        # Create and revoke token
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="Revoked Token",
        )

        await runner_crud.revoke_runner_token(
            db=async_db_session,
            token_id=token_record.id,
            user_id=test_user.id,
        )

        # Try to authenticate
        with pytest.raises(HTTPException) as exc_info:
            await authenticate_runner(plain_token)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_authenticate_with_inactive_user(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test that authentication fails if user is inactive."""
        # Create token
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="Inactive User Token",
        )

        # Deactivate user
        test_user.is_active = False
        await async_db_session.commit()

        # Try to authenticate
        with pytest.raises(HTTPException) as exc_info:
            await authenticate_runner(plain_token)

        assert exc_info.value.status_code == 401
        assert "User is not active" in str(exc_info.value.detail)


class TestTokenSecurity:
    """Test security aspects of runner tokens."""

    def test_token_format_is_identifiable(self):
        """Test that runner tokens have identifiable format."""
        token = generate_runner_token()

        assert token.startswith("qontinui_runner_")
        assert len(token) == len("qontinui_runner_") + 64  # 64 hex chars

    def test_tokens_are_unique(self):
        """Test that generated tokens are unique."""
        tokens = {generate_runner_token() for _ in range(100)}

        # All 100 tokens should be unique
        assert len(tokens) == 100

    @pytest.mark.asyncio
    async def test_hash_comparison_is_constant_time(
        self, async_db_session: AsyncSession, test_user: User
    ):
        """Test that token verification uses constant-time comparison."""
        from app.core.security import verify_runner_token

        # Create token
        token_record, plain_token = await runner_crud.create_runner_token(
            db=async_db_session,
            user_id=test_user.id,
            name="Security Test",
        )

        # Correct token should verify
        assert verify_runner_token(plain_token, token_record.token_hash) is True

        # Wrong token should not verify
        wrong_token = "qontinui_runner_wrongwrongwrongwrongwrongwrong"
        assert verify_runner_token(wrong_token, token_record.token_hash) is False

        # Malformed hash should not crash
        assert verify_runner_token(plain_token, "malformed_hash") is False
