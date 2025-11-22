"""FastAPI-Users configuration for authentication."""

import uuid
from typing import Optional

import structlog
from app.core.config import settings
from app.db.session import get_async_db
from app.models.user import User
from fastapi import Depends, Request, Response
from fastapi.security import HTTPBearer, OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.security.http import HTTPAuthorizationCredentials
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, exceptions
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.authentication.transport import (
    Transport,
    TransportLogoutNotSupportedError,
)
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


# ===== CUSTOM COOKIE + BEARER TRANSPORT =====


class CookieOrBearerScheme(OAuth2PasswordBearer):
    """
    Custom OAuth2 scheme that reads tokens from cookies OR Authorization header.

    This scheme is used by fastapi-users to extract tokens from requests.
    It first tries to read from the access_token cookie, then falls back to
    the Authorization header for backward compatibility.
    """

    def __init__(self, tokenUrl: str, cookie_name: str = "access_token"):
        super().__init__(tokenUrl=tokenUrl, auto_error=False)
        self.cookie_name = cookie_name

    async def __call__(self, request: Request) -> Optional[str]:
        """
        Extract token from cookie or Authorization header.

        This method is called by fastapi-users to get the token from the request.

        Priority:
        1. access_token cookie (preferred for XSS protection)
        2. Authorization header (backward compatibility)
        """
        logger.info(
            "cookie_or_bearer_scheme_called",
            cookies=list(request.cookies.keys()),
            has_auth_header=bool(request.headers.get("Authorization")),
        )

        # Try cookie first (preferred method)
        token = request.cookies.get(self.cookie_name)

        if token:
            logger.info("auth_token_from_cookie", token_length=len(token))
            return token

        # Fallback to Authorization header for backward compatibility
        # Call the parent OAuth2PasswordBearer's __call__ method
        token = await super().__call__(request)

        if token:
            logger.info("auth_token_from_header", token_length=len(token))
            return token

        logger.warning("no_auth_token_found", path=request.url.path)
        return None


class CookieOrBearerTransport(Transport):
    """
    Custom transport that supports both HttpOnly cookies and Authorization header.

    Reads access token from:
    1. Cookie (preferred for XSS protection)
    2. Authorization header (backward compatibility)

    This provides a gradual migration path from localStorage to HttpOnly cookies.
    """

    scheme: CookieOrBearerScheme

    def __init__(
        self, cookie_name: str = "access_token", tokenUrl: str = "api/v1/auth/jwt/login"
    ):
        self.cookie_name = cookie_name
        self.scheme = CookieOrBearerScheme(tokenUrl=tokenUrl, cookie_name=cookie_name)

    async def get_login_response(self, token: str) -> Response:
        """
        Return response with token.

        Note: Tokens are set as cookies in the login endpoint itself.
        This method is required by the Transport interface.
        """
        # Return a simple success response
        # Actual cookies are set in the custom login endpoint
        return Response(content={"detail": "Login successful"}, status_code=200)

    async def get_logout_response(self) -> Response:
        """Return logout response."""
        raise TransportLogoutNotSupportedError()


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

        # Create personal organization for the new user
        from app.services.organization_service import organization_service

        personal_org = await organization_service.create_personal_organization(
            db=self.user_db.session,
            user=user,
        )

        if personal_org:
            logger.info(
                "user_registration_complete_with_org",
                user_id=str(user.id),
                org_id=str(personal_org.id),
            )
        else:
            logger.warning(
                "user_registration_complete_without_org",
                user_id=str(user.id),
            )

        # Send welcome email via background task
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

    async def authenticate(
        self, credentials: OAuth2PasswordRequestForm
    ) -> Optional[User]:
        """
        Authenticate and return a user following a username/email and password.

        Supports authentication with both email and username.
        Will automatically upgrade password hash if necessary.

        :param credentials: The user credentials (username field can be email or username).
        """
        # First try to get user by email
        try:
            user = await self.get_by_email(credentials.username)
        except exceptions.UserNotExists:
            # Try to get user by username instead
            from sqlalchemy import select

            result = await self.user_db.session.execute(
                select(User).filter(User.username == credentials.username)
            )
            user = result.scalar_one_or_none()

            if not user:
                # Run the hasher to mitigate timing attack
                self.password_helper.hash(credentials.password)
                return None

        # Verify password
        verified, updated_password_hash = self.password_helper.verify_and_update(
            credentials.password, user.hashed_password
        )
        if not verified:
            return None

        # Update password hash to a more robust one if needed
        if updated_password_hash is not None:
            await self.user_db.update(user, {"hashed_password": updated_password_hash})

        return user


async def get_user_manager(user_db=Depends(get_user_db)):
    """Get user manager instance."""
    yield UserManager(user_db)


# ===== AUTHENTICATION BACKEND =====

# Use custom transport that supports both cookies and bearer tokens
cookie_or_bearer_transport = CookieOrBearerTransport(
    cookie_name="access_token", tokenUrl="api/v1/auth/jwt/login"
)


class DebugJWTStrategy(JWTStrategy):
    """JWT Strategy with debug logging to track validation failures."""

    async def read_token(self, token: str | None, user_manager):
        """Override to add debug logging for JWT validation."""
        if token is None:
            logger.warning("jwt_read_token_none")
            return None

        try:
            # First decode the JWT to see what's in it
            import jwt as pyjwt

            decoded = pyjwt.decode(token, options={"verify_signature": False})
            logger.info(
                "jwt_decoded_payload",
                sub=decoded.get("sub"),
                type=decoded.get("type"),
                has_device_fp=("device_fp" in decoded),
                all_claims=list(decoded.keys()),
            )

            # Now try fastapi-users' validation
            logger.info("jwt_decode_attempt", token_length=len(token))
            result = await super().read_token(token, user_manager)
            logger.info(
                "jwt_decode_result",
                user_id=str(result) if result else None,
                result_type=type(result).__name__,
            )
            return result
        except Exception as e:
            logger.error(
                "jwt_decode_failed",
                error=str(e),
                error_type=type(e).__name__,
                token_preview=token[:50] if token else None,
            )
            raise


def get_jwt_strategy() -> JWTStrategy:
    """Get JWT authentication strategy with debug logging."""
    return DebugJWTStrategy(
        secret=settings.ACCESS_SECRET_KEY,
        lifetime_seconds=settings.ACCESS_TOKEN_EXPIRE_SECONDS,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=cookie_or_bearer_transport,
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
