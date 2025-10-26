"""FastAPI-Users configuration for authentication."""

import uuid

import structlog
from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_async_db
from app.models.user import User

logger = structlog.get_logger(__name__)


# ===== USER DATABASE =====


async def get_user_db(session: AsyncSession = Depends(get_async_db)):
    """Get SQLAlchemy user database instance."""
    yield SQLAlchemyUserDatabase(session, User)


# ===== USER MANAGER =====


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    """User manager for handling user registration, password reset, etc."""

    reset_password_token_secret = settings.RESET_PASSWORD_SECRET_KEY
    verification_token_secret = settings.VERIFICATION_SECRET_KEY

    async def on_after_register(self, user: User, request: Request | None = None):
        """Called after a user successfully registers."""
        logger.info("user_registered", user_id=str(user.id), email=user.email)
        # TODO: Send welcome email via background task
        from app.services.auth.token_service import token_service
        from app.worker.queue import task_queue

        # Generate verification token
        verification_token = token_service.create_email_verification_token(user.email)

        # Send verification email in background
        job_id = await task_queue.send_verification_email(
            to_email=user.email,
            username=user.username,
            verification_token=verification_token,
        )
        if job_id:
            logger.info("verification_email_enqueued", email=user.email, job_id=job_id)
        else:
            logger.error("verification_email_enqueue_failed", email=user.email)

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ):
        """Called after a user requests a password reset."""
        logger.info("password_reset_requested", user_id=str(user.id), email=user.email)
        # TODO: Send password reset email via background task
        from app.worker.queue import task_queue

        job_id = await task_queue.send_password_reset_email(
            to_email=user.email,
            username=user.username,
            reset_token=token,
        )
        if job_id:
            logger.info(
                "password_reset_email_enqueued", email=user.email, job_id=job_id
            )
        else:
            logger.error("password_reset_email_enqueue_failed", email=user.email)

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ):
        """Called after a user requests email verification."""
        logger.info("verification_requested", user_id=str(user.id), email=user.email)
        # TODO: Send verification email via background task
        from app.worker.queue import task_queue

        job_id = await task_queue.send_verification_email(
            to_email=user.email,
            username=user.username,
            verification_token=token,
        )
        if job_id:
            logger.info("verification_email_enqueued", email=user.email, job_id=job_id)
        else:
            logger.error("verification_email_enqueue_failed", email=user.email)


async def get_user_manager(user_db=Depends(get_user_db)):
    """Get user manager instance."""
    yield UserManager(user_db)


# ===== AUTHENTICATION BACKEND =====

bearer_transport = BearerTransport(tokenUrl="api/v1/auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    """Get JWT authentication strategy."""
    return JWTStrategy(
        secret=settings.ACCESS_SECRET_KEY,
        lifetime_seconds=settings.ACCESS_TOKEN_EXPIRE_SECONDS,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)


# ===== FASTAPI USERS INSTANCE =====

fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager,
    [auth_backend],
)

# Export for use in endpoints
current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)
current_verified_user = fastapi_users.current_user(active=True, verified=True)
