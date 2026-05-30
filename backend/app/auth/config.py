"""FastAPI-Users configuration for authentication."""

import uuid
from typing import cast

import structlog
from fastapi import Depends, Request, Response
from fastapi.security import OAuth2PasswordBearer
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import AuthenticationBackend, JWTStrategy
from fastapi_users.authentication.transport import (
    Transport,
    TransportLogoutNotSupportedError,
)
from fastapi_users.openapi import OpenAPIResponseType
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_async_db
from app.models.user import User

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

    async def __call__(self, request: Request) -> str | None:
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
        self,
        cookie_name: str = "access_token",
        # OpenAPI/Swagger hint only — there is no local token endpoint
        # anymore (Cognito's hosted UI issues tokens). The transport still
        # *extracts* the presented Cognito bearer from the cookie/header.
        tokenUrl: str = "cognito",
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

    @staticmethod
    def get_openapi_login_responses_success() -> OpenAPIResponseType:
        """Return OpenAPI responses for successful login."""
        return {
            200: {
                "description": "Successful login",
                "content": {
                    "application/json": {"example": {"detail": "Login successful"}}
                },
            }
        }

    @staticmethod
    def get_openapi_logout_responses_success() -> OpenAPIResponseType:
        """Return OpenAPI responses for successful logout."""
        return {
            200: {
                "description": "Successful logout",
            }
        }


# ===== USER DATABASE =====


async def get_user_db(session: AsyncSession = Depends(get_async_db)):
    """Get SQLAlchemy user database instance."""
    yield SQLAlchemyUserDatabase(session, User)


# ===== USER MANAGER =====


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    """User manager for fastapi-users user-DB lookups.

    Cognito is the sole authentication mechanism, so this manager no
    longer performs local password verification, password reset, or
    email verification (the Cognito hosted UI owns sign-up / reset /
    verify). It exists only so the fastapi-users machinery can fetch the
    authenticated ``User`` by id for the ``current_active_user`` family of
    dependencies; the actual token verification lives in
    :class:`CognitoJWTStrategy`.
    """

    async def on_after_register(self, user: User, request: Request | None = None):
        """Create the new user's personal organization.

        Local self-service registration is gone (Cognito hosted UI owns
        sign-up), but a ``User`` row is still created on first Cognito
        login via provision-or-link. This hook is invoked by
        :meth:`BaseUserManager.create`; provisioning goes through
        :mod:`app.services.cognito_provision` instead, so this stays a
        thin org-bootstrap shim retained for any programmatic ``create``.
        """
        logger.info("user_registered", user_id=str(user.id), email=user.email)

        from app.services.organization_service import organization_service

        # Cast user_db to SQLAlchemyUserDatabase to access session attribute
        user_db = cast(SQLAlchemyUserDatabase, self.user_db)
        personal_org = await organization_service.create_personal_organization(
            db=user_db.session,
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


async def get_user_manager(user_db=Depends(get_user_db)):
    """Get user manager instance."""
    yield UserManager(user_db)


# ===== AUTHENTICATION BACKEND =====

# Custom transport that extracts the Cognito bearer from either the
# access_token cookie or the Authorization header.
cookie_or_bearer_transport = CookieOrBearerTransport(
    cookie_name="access_token", tokenUrl="cognito"
)


class CognitoJWTStrategy(JWTStrategy):
    """The sole user-token verifier: AWS Cognito user-pool JWTs only.

    Cognito is the only user-authentication mechanism. Every bearer token
    presented on the ``Authorization`` header / ``access_token`` cookie is
    verified against the configured Cognito pool JWKS and resolved to a
    local ``User`` (provision-or-link). There is no local HS256 / password
    fallback — a non-Cognito or otherwise invalid token returns ``None``,
    which fastapi-users surfaces as a 401.

    This lives in the fastapi-users strategy so *every* exported
    dependency (``current_active_user``/``current_verified_user``/…)
    authenticates through the one Cognito path without per-endpoint
    changes. The verification logic itself is shared with the WebSocket
    authenticator via
    :func:`app.auth.cognito_user.verify_cognito_token_and_resolve_user`.
    """

    async def read_token(self, token: str | None, user_manager):
        """Verify a Cognito token and resolve the local ``User``.

        Returns the ``User`` on success, or ``None`` (the fastapi-users
        signal for "invalid token" → 401). Provisioning uses the
        request-scoped session that ``user_manager`` already holds, so a
        newly-provisioned/linked user commits with the request.
        """
        if token is None:
            logger.warning("jwt_read_token_none")
            return None

        from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

        from app.auth.cognito_user import (
            CognitoAuthError,
            verify_cognito_token_and_resolve_user,
        )

        user_db = user_manager.user_db
        if not isinstance(user_db, SQLAlchemyUserDatabase):
            logger.error(
                "cognito_resolve_no_session",
                user_db_type=type(user_db).__name__,
            )
            return None

        try:
            return await verify_cognito_token_and_resolve_user(token, user_db.session)
        except CognitoAuthError:
            # Invalid/unverifiable token → 401 (fastapi-users treats None
            # as "no authenticated user"). Detail already logged in helper.
            return None


def get_jwt_strategy() -> JWTStrategy:
    """Get the Cognito-only JWT authentication strategy.

    ``secret``/``lifetime_seconds`` are inherited from ``JWTStrategy`` but
    unused: :meth:`CognitoJWTStrategy.read_token` never decodes locally —
    it delegates entirely to the Cognito JWKS verifier. A non-empty secret
    is supplied only to satisfy the base ``__init__`` contract.
    """
    return CognitoJWTStrategy(
        secret="cognito-only-unused",
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
current_active_user_optional = fastapi_users.current_user(active=True, optional=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)
current_verified_user = fastapi_users.current_user(active=True, verified=True)
