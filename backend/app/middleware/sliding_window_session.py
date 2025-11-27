"""
Sliding Window Session Middleware for automatic token refresh.

This middleware:
1. Checks if the access token will expire soon (within threshold)
2. If user is active and token expiring soon, issues new tokens
3. Extends session expiry on each request (sliding window)
4. Enforces absolute maximum session duration (MAX_SESSION_DAYS)
"""

from typing import Any, cast

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_session_jti_from_refresh_token,
    is_token_expiring_soon,
)
from app.crud.session_activity import is_session_expired, update_last_activity
from app.db.session import AsyncSessionLocal

logger = structlog.get_logger(__name__)


class SlidingWindowSessionMiddleware(BaseHTTPMiddleware):
    """
    Middleware to implement sliding window session management.

    Features:
    - Automatically refreshes access tokens when they're about to expire
    - Updates last activity timestamp on each request
    - Enforces absolute maximum session duration
    - Returns new tokens in response headers when refreshed
    - Gracefully handles cases when sliding window is disabled
    """

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        # Skip if sliding window is disabled
        if not settings.SLIDING_WINDOW_ENABLED:
            return cast(Response, await call_next(request))

        # Skip health checks and static files
        if request.url.path in [
            "/health",
            "/",
            "/favicon.ico",
        ] or request.url.path.startswith("/uploads"):
            return cast(Response, await call_next(request))

        # Get authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return cast(Response, await call_next(request))

        access_token = auth_header[7:]  # Remove "Bearer " prefix

        # Decode the access token
        token_payload = decode_token(access_token)
        if not token_payload or token_payload.get("type") != "access":
            return cast(Response, await call_next(request))

        # Get refresh token from cookie or header (if provided by client)
        refresh_token = request.cookies.get("refresh_token") or request.headers.get(
            "X-Refresh-Token"
        )

        # Check if token is expiring soon
        if is_token_expiring_soon(
            token_payload, settings.SLIDING_WINDOW_THRESHOLD_MINUTES
        ):
            if refresh_token:
                # Get user_id and ensure it's a string
                user_id = token_payload.get("sub")
                if not user_id or not isinstance(user_id, str):
                    return cast(Response, await call_next(request))

                # Try to refresh the session
                new_tokens = await self._refresh_session(user_id, refresh_token)

                if new_tokens:
                    # Process the request
                    response = cast(Response, await call_next(request))

                    # Add new tokens to response headers
                    response.headers["X-New-Access-Token"] = new_tokens["access_token"]
                    response.headers["X-New-Refresh-Token"] = new_tokens[
                        "refresh_token"
                    ]

                    logger.info(
                        "sliding_window_refresh",
                        user_id=user_id,
                        path=request.url.path,
                    )

                    return response

        # Update last activity if we have a refresh token with session tracking
        if refresh_token:
            await self._update_session_activity(refresh_token)

        # Continue with normal request processing
        return cast(Response, await call_next(request))

    async def _refresh_session(
        self, user_id: str, refresh_token: str
    ) -> dict[str, str] | None:
        """
        Refresh the session by issuing new tokens.

        Args:
            user_id: User ID from access token
            refresh_token: Current refresh token

        Returns:
            Dict with new access_token and refresh_token, or None if refresh failed
        """
        try:
            # Get session JTI from refresh token
            jti = get_session_jti_from_refresh_token(refresh_token)
            if not jti:
                return None

            # Check if session has expired (absolute maximum)
            async with AsyncSessionLocal() as db:
                if await is_session_expired(db, jti):
                    logger.warning(
                        "session_expired_absolute_max",
                        user_id=user_id,
                        jti=jti,
                    )
                    return None

                # Update last activity
                await update_last_activity(db, jti)

            # Create new access token
            new_access_token = create_access_token(subject=user_id)

            # Create new refresh token (reuse same session JTI)
            new_refresh_token = create_refresh_token(subject=user_id)

            return {
                "access_token": new_access_token,
                "refresh_token": new_refresh_token,
            }

        except Exception as e:
            logger.error(
                "sliding_window_refresh_failed",
                error=str(e),
                error_type=type(e).__name__,
                user_id=user_id,
            )
            return None

    async def _update_session_activity(self, refresh_token: str) -> None:
        """
        Update the last activity timestamp for a session.

        Args:
            refresh_token: Current refresh token
        """
        try:
            jti = get_session_jti_from_refresh_token(refresh_token)
            if not jti:
                return

            async with AsyncSessionLocal() as db:
                await update_last_activity(db, jti)

        except Exception as e:
            # Log but don't fail the request
            logger.debug(
                "session_activity_update_failed",
                error=str(e),
                error_type=type(e).__name__,
            )
