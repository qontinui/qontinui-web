"""JWT authentication endpoints (login, logout, refresh, runner token)."""

import uuid
from datetime import datetime, timedelta

import structlog
from fastapi import APIRouter, Depends, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.core.config import settings
from app.core.error_codes import ErrorCode
from app.core.security import create_access_token, create_refresh_token
from app.middleware.error_handler import unauthorized_error
from app.middleware.rate_limit import auth_rate_limit
from app.models.user import User
from app.services.auth_analytics_service import auth_analytics_service
from app.services.cookie_service import cookie_service
from app.services.device_fingerprint_service import device_fingerprint_service
from app.services.device_session_service import device_session_service

logger = structlog.get_logger(__name__)
router = APIRouter()


class TokenResponse(BaseModel):
    """Response model for login and refresh endpoints."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # Seconds until access token expires
    refresh_expires_in: int  # Seconds until refresh token expires


class RefreshTokenRequest(BaseModel):
    """Request model for token refresh endpoint."""

    refresh_token: str | None = None  # Optional for backward compatibility
    extend_session: bool = False


class RunnerTokenResponse(BaseModel):
    """Response model for runner token endpoint."""

    token: str
    expires_in: int  # Seconds until token expires


@router.post("/jwt/login", response_model=TokenResponse)
@auth_rate_limit("5 per minute")
async def login(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    remember_me: bool = False,
) -> TokenResponse:
    """
    Custom login endpoint that returns both access and refresh tokens.

    Uses the same authentication as fastapi-users but returns refresh token.
    Also tracks device fingerprints for security.

    Tokens are set as HttpOnly cookies for XSS protection and also returned
    in response body for backward compatibility during migration.

    Rate limited to 5 attempts per minute to prevent brute force attacks.
    """
    from app.api.v1.endpoints.auth.helpers import send_device_verification_email
    from app.crud.user import authenticate_user

    user = await authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise unauthorized_error(
            "Invalid username/email or password", ErrorCode.LOGIN_BAD_CREDENTIALS
        )

    if not user.is_active:
        raise unauthorized_error(
            "User account is not verified", ErrorCode.LOGIN_USER_NOT_VERIFIED
        )

    # Generate device fingerprint
    fingerprint, device_info = (
        device_fingerprint_service.generate_fingerprint_from_request(request)
    )

    # Get or create device session
    device_session, is_new_device = (
        await device_session_service.get_or_create_device_session(
            db=db,
            user_id=user.id,
            device_fingerprint=fingerprint,
            ip_address=device_info["ip_address"],
            user_agent=device_info["user_agent"],
            accept_language=device_info.get("accept_language"),
        )
    )

    # Calculate account age in days
    account_age_days = (
        (datetime.utcnow() - user.created_at).days if user.created_at else 0
    )

    # Update user analytics fields
    user.login_count += 1
    if remember_me:
        user.remember_me_usage_count += 1
    user.last_login_at = datetime.utcnow()
    user.last_device_fingerprint = fingerprint

    # Track login event
    await auth_analytics_service.track_event(
        db=db,
        event_name="user_login",
        user_id=user.id,
        properties={
            "remember_me": remember_me,
            "device_new": is_new_device,
            "device_trusted": device_session.is_trusted,
            "account_age_days": account_age_days,
            "subscription_tier": user.subscription_tier,
            "ip_address": device_info["ip_address"],
            "user_agent": device_info["user_agent"],
        },
    )

    # Log warning if new device detected
    if is_new_device:
        logger.warning(
            "new_device_login",
            user_id=str(user.id),
            email=user.email,
            device_fingerprint=fingerprint,
            ip_address=device_info["ip_address"],
            user_agent=device_info["user_agent"],
        )

        if settings.REQUIRE_DEVICE_VERIFICATION:
            await send_device_verification_email(
                db=db,
                device_session=device_session,
                user_email=user.email,
                username=user.username if hasattr(user, "username") else user.email,
            )
    else:
        logger.info(
            "known_device_login",
            user_id=str(user.id),
            email=user.email,
            device_fingerprint=fingerprint,
            ip_address=device_info["ip_address"],
        )

    # Generate tokens
    access_token = create_access_token(
        subject=str(user.id), additional_claims={"device_fp": fingerprint}
    )
    refresh_token = create_refresh_token(subject=str(user.id), long_lived=remember_me)

    # Create session activity record if sliding window is enabled
    if settings.SLIDING_WINDOW_ENABLED:
        from app.core.security import get_session_jti_from_refresh_token
        from app.crud.session_activity import create_session_activity

        jti = get_session_jti_from_refresh_token(refresh_token)
        if jti:
            await create_session_activity(db, user.id, jti)
            logger.info(
                "session_activity_created",
                user_id=str(user.id),
                jti=jti,
            )

    # Calculate token expiry times
    access_expires_in = settings.ACCESS_TOKEN_EXPIRE_SECONDS
    refresh_expires_in = (
        settings.REMEMBER_ME_TOKEN_EXPIRE_DAYS * 24 * 3600
        if remember_me
        else settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    )

    # Set HttpOnly cookies
    cookie_service.set_auth_cookies(
        response=response,
        access_token=access_token,
        refresh_token=refresh_token,
        remember_me=remember_me,
    )

    logger.info(
        "user_logged_in",
        user_id=str(user.id),
        email=user.email,
        remember_me=remember_me,
        refresh_token_days=(
            settings.REMEMBER_ME_TOKEN_EXPIRE_DAYS
            if remember_me
            else settings.REFRESH_TOKEN_EXPIRE_DAYS
        ),
        device_fingerprint=fingerprint,
        is_new_device=is_new_device,
        cookies_set=True,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
    )


@router.post("/jwt/logout")
async def logout(
    *,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> dict[str, str]:
    """
    Logout user and clear authentication cookies.

    Clears HttpOnly cookies containing access and refresh tokens.
    """
    cookie_service.clear_auth_cookies(response)

    logger.info(
        "user_logged_out",
        user_id=str(current_user.id),
        email=current_user.email,
        cookies_cleared=True,
    )

    return {"detail": "Successfully logged out"}


@router.post("/jwt/refresh", response_model=TokenResponse)
@auth_rate_limit("10 per minute")
async def refresh_token(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    body: RefreshTokenRequest | None = None,
) -> TokenResponse:
    """
    Refresh access token using refresh token.

    Returns new access and refresh tokens (token rotation).
    Preserves the long_lived status from the original refresh token.

    Reads refresh token from HttpOnly cookie (preferred) or request body.
    Sets new tokens as HttpOnly cookies in response.

    Rate limited to 10 attempts per minute to prevent token abuse.
    """
    # Try to read refresh token from cookie first
    refresh_token_value = request.cookies.get("refresh_token")

    # Fallback to request body
    if not refresh_token_value and body and body.refresh_token:
        refresh_token_value = body.refresh_token

    if not refresh_token_value:
        raise unauthorized_error(
            "No refresh token provided (cookie or body)", ErrorCode.TOKEN_MISSING
        )

    extend_session = body.extend_session if body else False

    from app.core.security import (
        decode_refresh_token,
        get_session_jti_from_refresh_token,
        get_token_expiry_time,
    )
    from app.crud.session_activity import (
        create_session_activity,
        delete_session,
        is_session_expired,
        update_last_activity,
    )
    from app.crud.user import get_user
    from app.services.auth.token_blacklist_service import token_blacklist_service

    payload = decode_refresh_token(refresh_token_value)

    if not payload:
        raise unauthorized_error("Invalid refresh token", ErrorCode.TOKEN_INVALID)

    user_id_value = payload.get("sub")
    if not user_id_value or not isinstance(user_id_value, str):
        raise unauthorized_error("Invalid refresh token", ErrorCode.TOKEN_INVALID)

    user_id: str = user_id_value
    token_type = payload.get("type")
    token_jti = payload.get("jti")
    is_long_lived = payload.get("long_lived", False)

    if not user_id or token_type != "refresh" or not token_jti:
        raise unauthorized_error("Invalid refresh token", ErrorCode.TOKEN_INVALID)

    if await token_blacklist_service.is_blacklisted(token_jti):
        raise unauthorized_error("Token has been revoked", ErrorCode.TOKEN_REVOKED)

    user = await get_user(db, user_id=uuid.UUID(user_id))
    if not user or not user.is_active:
        raise unauthorized_error("User not found or inactive", ErrorCode.USER_NOT_FOUND)

    # Check session activity if sliding window is enabled
    if settings.SLIDING_WINDOW_ENABLED:
        if await is_session_expired(db, token_jti):
            raise unauthorized_error(
                "Session expired. Please log in again.", ErrorCode.SESSION_EXPIRED
            )
        await update_last_activity(db, token_jti)

    # Blacklist the old refresh token (token rotation)
    expiry = get_token_expiry_time(payload)
    await token_blacklist_service.blacklist_token(token_jti, expiry)

    # Generate new tokens
    access_token = create_access_token(subject=str(user.id))
    new_refresh_token = create_refresh_token(
        subject=str(user.id), long_lived=is_long_lived
    )

    # Handle session extension if requested
    if extend_session and settings.SLIDING_WINDOW_ENABLED:
        await delete_session(db, token_jti)
        new_jti = get_session_jti_from_refresh_token(new_refresh_token)
        if new_jti:
            await create_session_activity(db, user.id, new_jti)
            logger.info(
                "session_extended",
                user_id=str(user.id),
                old_jti=token_jti,
                new_jti=new_jti,
            )

    # Track token refresh event
    await auth_analytics_service.track_event(
        db=db,
        event_name="token_refresh",
        user_id=user.id,
        properties={
            "long_lived": is_long_lived,
            "extend_session": extend_session,
            "subscription_tier": user.subscription_tier,
        },
    )

    # Calculate token expiry times
    access_expires_in = settings.ACCESS_TOKEN_EXPIRE_SECONDS
    refresh_expires_in = (
        settings.REMEMBER_ME_TOKEN_EXPIRE_DAYS * 24 * 3600
        if is_long_lived
        else settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    )

    # Set new tokens as HttpOnly cookies
    cookie_service.set_auth_cookies(
        response=response,
        access_token=access_token,
        refresh_token=new_refresh_token,
        remember_me=is_long_lived,
    )

    logger.info(
        "token_refreshed",
        user_id=str(user.id),
        long_lived=is_long_lived,
        extend_session=extend_session,
        cookies_set=True,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
    )


@router.post("/runner-token", response_model=RunnerTokenResponse)
async def get_runner_token(
    *,
    current_user: User = Depends(current_active_user),
) -> RunnerTokenResponse:
    """
    Get a short-lived access token for runner API calls.

    This endpoint generates a 5-minute access token that can be passed to
    the qontinui-runner for making authenticated API calls to the backend.

    Since HttpOnly cookies cannot be accessed by JavaScript (for XSS protection),
    this endpoint provides a way to get a token that can be explicitly passed
    to the runner for server-to-server communication.

    The token is short-lived (5 minutes) to minimize security risk if compromised.
    """
    runner_token_expires = 300  # 5 minutes in seconds

    token = create_access_token(
        subject=str(current_user.id),
        expires_delta=timedelta(seconds=runner_token_expires),
    )

    logger.info(
        "runner_token_issued",
        user_id=str(current_user.id),
        email=current_user.email,
        expires_in=runner_token_expires,
    )

    return RunnerTokenResponse(
        token=token,
        expires_in=runner_token_expires,
    )
