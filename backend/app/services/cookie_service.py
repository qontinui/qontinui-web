"""
Service for managing authentication cookies.

This service provides helpers for setting and clearing HttpOnly cookies
for secure token storage (XSS protection).
"""

from typing import Literal, TypedDict

from fastapi import Response

from app.core.config import settings


class CookieParams(TypedDict, total=False):
    """Type definition for cookie parameters."""

    key: str
    value: str
    httponly: bool
    max_age: int
    path: str
    secure: bool
    samesite: Literal["lax", "strict", "none"]


class CookieService:
    """Helper service for setting and clearing auth cookies with security best practices."""

    @staticmethod
    def set_auth_cookies(
        response: Response,
        access_token: str,
        refresh_token: str,
        remember_me: bool = False,
    ) -> None:
        """
        Set access and refresh token cookies with security flags.

        Args:
            response: FastAPI response object
            access_token: JWT access token
            refresh_token: JWT refresh token
            remember_me: If True, extends refresh token lifetime to 90 days

        Security features:
        - httponly=True: Prevents JavaScript access (XSS protection)
        - secure=True: HTTPS only in production
        - samesite="lax": CSRF protection
        - path restrictions: Refresh token only sent to auth endpoints
        """
        # Set access token cookie
        # Development: No SameSite to allow cross-port requests (3001 → 8000) without HTTPS
        # Production: SameSite=lax for CSRF protection with HTTPS
        cookie_params: CookieParams = {
            "key": "access_token",
            "value": access_token,
            "httponly": True,
            "max_age": settings.ACCESS_TOKEN_EXPIRE_SECONDS,
            "path": "/",
        }

        if settings.ENVIRONMENT == "production":
            cookie_params["secure"] = True
            cookie_params["samesite"] = "lax"
        else:
            # Development: Use SameSite=lax for same-origin HTTP requests
            # Both frontend (172.27.67.252:3001) and backend (172.27.67.252:8000)
            # are on same IP, so lax mode works without requiring HTTPS
            cookie_params["secure"] = False
            cookie_params["samesite"] = (
                "lax"  # Changed from "none" - browsers reject SameSite=None without Secure=True
            )

        response.set_cookie(**cookie_params)

        # Calculate refresh token max age
        refresh_max_age = (
            settings.REMEMBER_ME_TOKEN_EXPIRE_DAYS * 86400
            if remember_me
            else settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
        )

        # Set refresh token cookie (restricted path for security)
        refresh_cookie_params: CookieParams = {
            "key": "refresh_token",
            "value": refresh_token,
            "httponly": True,
            "max_age": refresh_max_age,
            "path": "/api/v1/auth",  # Only sent to auth endpoints (security best practice)
        }

        if settings.ENVIRONMENT == "production":
            refresh_cookie_params["secure"] = True
            refresh_cookie_params["samesite"] = "lax"
        else:
            # Development: Use SameSite=lax for same-origin HTTP requests
            refresh_cookie_params["secure"] = False
            refresh_cookie_params["samesite"] = (
                "lax"  # Changed from "none" - browsers reject SameSite=None without Secure=True
            )

        response.set_cookie(**refresh_cookie_params)

    @staticmethod
    def clear_auth_cookies(response: Response) -> None:
        """
        Clear authentication cookies on logout.

        Args:
            response: FastAPI response object
        """
        response.delete_cookie(
            key="access_token",
            path="/",
        )

        response.delete_cookie(
            key="refresh_token",
            path="/api/v1/auth",
        )


# Singleton instance
cookie_service = CookieService()
