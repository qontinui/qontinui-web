"""
Authentication endpoints using fastapi-users.

This replaces the custom authentication implementation with fastapi-users,
while maintaining custom endpoints like beta signup.
"""

import uuid as uuid_lib
from datetime import datetime, timedelta

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.auth.config import fastapi_users
from app.core.config import settings
from app.core.error_codes import ErrorCode
from app.core.security import create_access_token, create_refresh_token, verify_password
from app.crud.user import get_user_by_email
from app.middleware.error_handler import unauthorized_error, validation_error
from app.middleware.rate_limit import auth_rate_limit
from app.models.device_session import DeviceSession
from app.models.user import User
from app.schemas.device_session import DeviceSessionSummary, DeviceSessionUpdate
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.auth.password_service import password_service
from app.services.auth.user_management_service import user_management_service
from app.services.auth_analytics_service import auth_analytics_service
from app.services.cookie_service import cookie_service
from app.services.device_fingerprint_service import device_fingerprint_service
from app.services.device_session_service import device_session_service

logger = structlog.get_logger(__name__)

router = APIRouter()

# ===== FASTAPI-USERS ROUTERS =====

# NOTE: We use custom auth routes (login, logout, refresh) below instead of
# fastapi-users auto-generated routes because we need HttpOnly cookie support.
# The custom transport (CookieOrBearerTransport) is used by the authentication
# dependency system, but not for route generation.

# Register user registration route
router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    tags=["auth"],
)

# Register password reset routes
router.include_router(
    fastapi_users.get_reset_password_router(),
    tags=["auth"],
)

# Register email verification routes
router.include_router(
    fastapi_users.get_verify_router(UserRead),
    tags=["auth"],
)

# Register user management routes (me, update, etc.)
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)


# ===== CUSTOM ENDPOINTS (NOT PROVIDED BY FASTAPI-USERS) =====


class TokenResponse(BaseModel):
    """Response model for login and refresh endpoints."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # Seconds until access token expires
    refresh_expires_in: int  # Seconds until refresh token expires


class LoginRequest(BaseModel):
    """Login request with optional remember_me flag."""

    username: str
    password: str
    remember_me: bool = False


@router.post("/jwt/login", response_model=TokenResponse, tags=["auth"])
@auth_rate_limit("5 per minute")
async def login(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    remember_me: bool = False,
):
    """
    Custom login endpoint that returns both access and refresh tokens.

    Uses the same authentication as fastapi-users but returns refresh token.
    Also tracks device fingerprints for security.

    Tokens are set as HttpOnly cookies for XSS protection and also returned
    in response body for backward compatibility during migration.

    Rate limited to 5 attempts per minute to prevent brute force attacks.
    """
    # Authenticate user (supports both username and email)
    from app.crud.user import authenticate_user

    user = await authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise unauthorized_error(
            "Invalid username/email or password", ErrorCode.LOGIN_BAD_CREDENTIALS
        )

    # Check if user is active
    if not user.is_active:
        raise unauthorized_error(
            "User account is not verified", ErrorCode.LOGIN_USER_NOT_VERIFIED
        )

    # Generate device fingerprint
    fingerprint, device_info = (
        device_fingerprint_service.generate_fingerprint_from_request(request)
    )

    # Get or create device session
    (
        device_session,
        is_new_device,
    ) = await device_session_service.get_or_create_device_session(
        db=db,
        user_id=user.id,
        device_fingerprint=fingerprint,
        ip_address=device_info["ip_address"],
        user_agent=device_info["user_agent"],
        accept_language=device_info.get("accept_language"),
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

    # Track login event with comprehensive properties
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

        # Send device verification email if enabled
        if settings.REQUIRE_DEVICE_VERIFICATION:
            await _send_device_verification_email(
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

    # Generate tokens using existing security functions
    # Include device fingerprint in token claims for validation
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

    # Set HttpOnly cookies for secure token storage (XSS protection)
    cookie_service.set_auth_cookies(
        response=response,
        access_token=access_token,
        refresh_token=refresh_token,
        remember_me=remember_me,
    )

    # Log remember_me usage for audit trail
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

    # BACKWARD COMPATIBILITY: Also return tokens in body during migration
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
    )


@router.post("/jwt/logout", tags=["auth"])
async def logout(
    *,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """
    Logout user and clear authentication cookies.

    Clears HttpOnly cookies containing access and refresh tokens.
    """
    # Clear authentication cookies
    cookie_service.clear_auth_cookies(response)

    logger.info(
        "user_logged_out",
        user_id=str(current_user.id),
        email=current_user.email,
        cookies_cleared=True,
    )

    return {"detail": "Successfully logged out"}


class RunnerTokenResponse(BaseModel):
    """Response model for runner token endpoint."""

    token: str
    expires_in: int  # Seconds until token expires


@router.post("/runner-token", response_model=RunnerTokenResponse, tags=["auth"])
async def get_runner_token(
    *,
    current_user: User = Depends(current_active_user),
):
    """
    Get a short-lived access token for runner API calls.

    This endpoint generates a 5-minute access token that can be passed to
    the qontinui-runner for making authenticated API calls to the backend.

    Since HttpOnly cookies cannot be accessed by JavaScript (for XSS protection),
    this endpoint provides a way to get a token that can be explicitly passed
    to the runner for server-to-server communication.

    The token is short-lived (5 minutes) to minimize security risk if compromised.
    """
    # Generate a short-lived token (5 minutes) for runner API calls
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


class RefreshTokenRequest(BaseModel):
    """Request model for token refresh endpoint."""

    refresh_token: str | None = None  # Optional for backward compatibility
    extend_session: bool = False


@router.post("/jwt/refresh", response_model=TokenResponse)
@auth_rate_limit("10 per minute")
async def refresh_token(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    body: RefreshTokenRequest | None = None,
):
    """
    Refresh access token using refresh token.

    Returns new access and refresh tokens (token rotation).
    Preserves the long_lived status from the original refresh token.

    Reads refresh token from HttpOnly cookie (preferred) or request body (backward compatibility).
    Sets new tokens as HttpOnly cookies in response.

    Rate limited to 10 attempts per minute to prevent token abuse.
    """
    # Try to read refresh token from cookie first (preferred method)
    refresh_token_value = request.cookies.get("refresh_token")

    # Fallback to request body for backward compatibility
    if not refresh_token_value and body and body.refresh_token:
        refresh_token_value = body.refresh_token

    if not refresh_token_value:
        raise unauthorized_error(
            "No refresh token provided (cookie or body)", ErrorCode.TOKEN_MISSING
        )

    # Get extend_session flag from request body if provided
    extend_session = body.extend_session if body else False
    import uuid

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

    # Decode and validate the refresh token using the dedicated function
    payload = decode_refresh_token(refresh_token_value)

    if not payload:
        raise unauthorized_error("Invalid refresh token", ErrorCode.TOKEN_INVALID)

    user_id_value = payload.get("sub")
    if not user_id_value or not isinstance(user_id_value, str):
        raise unauthorized_error("Invalid refresh token", ErrorCode.TOKEN_INVALID)
    user_id: str = user_id_value
    token_type = payload.get("type")
    token_jti = payload.get("jti")
    # Preserve the long_lived flag from the original token
    is_long_lived = payload.get("long_lived", False)

    if not user_id or token_type != "refresh" or not token_jti:
        raise unauthorized_error("Invalid refresh token", ErrorCode.TOKEN_INVALID)

    # Check if token is blacklisted
    if await token_blacklist_service.is_blacklisted(token_jti):
        raise unauthorized_error("Token has been revoked", ErrorCode.TOKEN_REVOKED)

    # Get user from database to ensure they still exist and are active
    user = await get_user(db, user_id=uuid.UUID(user_id))
    if not user or not user.is_active:
        raise unauthorized_error("User not found or inactive", ErrorCode.USER_NOT_FOUND)

    # Check session activity if sliding window is enabled
    if settings.SLIDING_WINDOW_ENABLED:
        # Check if session has exceeded absolute maximum
        if await is_session_expired(db, token_jti):
            raise unauthorized_error(
                "Session expired. Please log in again.", ErrorCode.SESSION_EXPIRED
            )

        # Update last activity
        await update_last_activity(db, token_jti)

    # Blacklist the old refresh token (token rotation)
    expiry = get_token_expiry_time(payload)
    await token_blacklist_service.blacklist_token(token_jti, expiry)

    # Generate new tokens using existing security functions
    # Preserve the long_lived status from the original refresh token
    access_token = create_access_token(subject=str(user.id))
    new_refresh_token = create_refresh_token(
        subject=str(user.id), long_lived=is_long_lived
    )

    # Handle session extension if requested
    if extend_session and settings.SLIDING_WINDOW_ENABLED:
        # Delete old session
        await delete_session(db, token_jti)

        # Create new session with fresh absolute expiry
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

    # BACKWARD COMPATIBILITY: Also return tokens in body during migration
    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
    )


class BetaSignupRequest(BaseModel):
    """Request model for beta signup endpoint."""

    email: EmailStr


class BetaSignupResponse(BaseModel):
    """Response model for beta signup endpoint."""

    success: bool
    message: str
    temp_password: str | None = None


@router.post("/beta-signup", response_model=BetaSignupResponse)
@auth_rate_limit("3 per hour")
async def beta_signup(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    signup_request: BetaSignupRequest,
):
    """
    Custom beta signup endpoint for creating beta users with temporary passwords.

    Rate limited to 3 attempts per hour to prevent abuse.

    This endpoint:
    1. Creates a user with a temporary password
    2. Auto-verifies their email
    3. Sends welcome email with credentials
    """
    from app.worker.queue import task_queue

    existing_user = await get_user_by_email(db, email=signup_request.email)
    if existing_user:
        return BetaSignupResponse(
            success=True,
            message="You're already on the list! Check your email for login instructions.",
            temp_password=None,
        )

    temp_password = password_service.generate_secure_password(12)
    username_base = signup_request.email.split("@")[0]
    username = await user_management_service.generate_unique_username(db, username_base)

    try:
        user = await user_management_service.create_beta_user(
            db, signup_request.email, username, temp_password
        )

        # Beta users get auto-verified for easier onboarding
        user.is_verified = True  # Changed from email_verified
        await db.commit()

        # Create personal organization for beta user
        from app.services.organization_service import organization_service

        personal_org = await organization_service.create_personal_organization(
            db=db,
            user=user,
        )

        if personal_org:
            logger.info(
                "beta_user_org_created",
                user_email=user.email,
                org_id=str(personal_org.id),
            )
        else:
            logger.warning(
                "beta_user_org_creation_failed",
                user_email=user.email,
            )

        # Send welcome email with credentials in background
        job_id = await task_queue.send_email(
            to_email=user.email,
            subject="Welcome to Qontinui Beta!",
            html_content=f"<p>Welcome {username}!</p><p>Your temporary password is: {temp_password}</p>",
            text_content=f"Welcome {username}!\n\nYour temporary password is: {temp_password}",
        )
        if job_id:
            logger.info(
                "beta_welcome_email_enqueued", user_email=user.email, job_id=job_id
            )
        else:
            logger.error("beta_welcome_email_enqueue_failed", user_email=user.email)

        logger.info(
            "beta_signup_success", email=signup_request.email, username=username
        )

        return BetaSignupResponse(
            success=True,
            message=f"Beta access created! Check your email for login instructions. Username: {username}, Temporary password: {temp_password}",
            temp_password=temp_password,
        )

    except Exception as e:
        logger.error(
            "beta_user_creation_failed", error=str(e), error_type=type(e).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create beta account. Please try again.",
        )


# ===== DEVICE MANAGEMENT ENDPOINTS =====


@router.get("/devices", response_model=list[DeviceSessionSummary], tags=["auth"])
async def get_user_devices(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """
    Get all devices associated with the current user.

    Returns a list of device sessions showing:
    - Device information (User-Agent, IP addresses)
    - Trust status
    - First and last seen timestamps
    """
    devices = await device_session_service.get_user_device_sessions(db, current_user.id)

    return [
        DeviceSessionSummary(
            id=device.id,
            device_name=device.device_name,
            user_agent=device.user_agent,
            ip_address=device.ip_address,
            last_ip=device.last_ip,
            is_trusted=device.is_trusted,
            email_verified=device.email_verified,
            country=device.country,
            city=device.city,
            first_seen=device.first_seen,
            last_seen=device.last_seen,
        )
        for device in devices
    ]


@router.patch(
    "/devices/{device_id}", response_model=DeviceSessionSummary, tags=["auth"]
)
async def update_device(
    *,
    device_id: uuid_lib.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    device_update: DeviceSessionUpdate,
):
    """Update a device session (e.g., mark as trusted, set device name)."""
    # Get device session with ownership verification
    device_session = await device_session_service.get_device_session_by_id(
        db, device_id, current_user.id
    )

    if not device_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found or you don't have permission to access it",
        )

    # Update fields
    if device_update.is_trusted is not None:
        if device_update.is_trusted:
            # Use trust_device method to enforce verification check
            try:
                device_session = await device_session_service.trust_device(
                    db, device_session
                )
            except ValueError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=str(e),
                )
        else:
            device_session.is_trusted = False
            await db.commit()
            await db.refresh(device_session)

    if device_update.device_name is not None:
        device_session.device_name = device_update.device_name
        await db.commit()
        await db.refresh(device_session)

    logger.info(
        "device_session_updated",
        user_id=str(current_user.id),
        device_id=str(device_id),
        updates=device_update.dict(exclude_unset=True),
    )

    return DeviceSessionSummary(
        id=device_session.id,
        device_name=device_session.device_name,
        user_agent=device_session.user_agent,
        ip_address=device_session.ip_address,
        last_ip=device_session.last_ip,
        is_trusted=device_session.is_trusted,
        email_verified=device_session.email_verified,
        country=device_session.country,
        city=device_session.city,
        first_seen=device_session.first_seen,
        last_seen=device_session.last_seen,
    )


@router.delete(
    "/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"]
)
async def delete_device(
    *,
    device_id: uuid_lib.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """
    Delete a device session.

    This removes the device from the user's trusted devices list.
    The user will need to re-authenticate from this device.
    """
    # Get device session with ownership verification
    device_session = await device_session_service.get_device_session_by_id(
        db, device_id, current_user.id
    )

    if not device_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found or you don't have permission to access it",
        )

    await device_session_service.delete_device_session(db, device_session)

    logger.info(
        "device_session_deleted_by_user",
        user_id=str(current_user.id),
        device_id=str(device_id),
    )

    return None


# ===== DEVICE VERIFICATION ENDPOINTS =====


@router.get("/verify-device/{token}", tags=["auth"])
async def verify_device(
    *,
    token: str,
    db: AsyncSession = Depends(get_async_db),
):
    """
    Verify a device using a verification token from email.

    Args:
        token: Verification token from email link

    Returns:
        Success message if device verified
    """
    device_session = await device_session_service.verify_device_by_token(db, token)

    if not device_session:
        raise validation_error(
            "Invalid or expired verification token", error_code=ErrorCode.TOKEN_INVALID
        )

    logger.info(
        "device_verified_via_email",
        user_id=str(device_session.user_id),
        device_id=str(device_session.id),
    )

    return {
        "success": True,
        "message": "Device verified successfully",
        "device_id": str(device_session.id),
    }


class ChangePasswordRequest(BaseModel):
    """Request to change user password."""

    current_password: str
    new_password: str


class ChangePasswordResponse(BaseModel):
    """Response for password change request."""

    success: bool
    message: str


@router.post("/change-password", response_model=ChangePasswordResponse, tags=["auth"])
@auth_rate_limit("5 per hour")
async def change_password(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    password_data: ChangePasswordRequest,
):
    """
    Change user password (self-service for authenticated users).

    Requires current password verification. After successful password change,
    all existing sessions are invalidated for security.

    Rate limited to 5 attempts per hour to prevent abuse.

    Args:
        password_data: Current and new passwords

    Returns:
        Success message if password changed
    """
    # Verify current password
    if not verify_password(
        password_data.current_password, current_user.hashed_password
    ):
        raise unauthorized_error(
            "Current password is incorrect", ErrorCode.LOGIN_BAD_CREDENTIALS
        )

    # Validate new password strength
    if len(password_data.new_password) < 8:
        raise validation_error(
            "New password must be at least 8 characters long",
            "new_password",
            ErrorCode.INVALID_PASSWORD,
        )

    # Check if new password is different from current
    if verify_password(password_data.new_password, current_user.hashed_password):
        raise validation_error(
            "New password must be different from current password",
            "new_password",
            ErrorCode.INVALID_PASSWORD,
        )

    # Hash and update password
    from app.core.security import get_password_hash

    current_user.hashed_password = get_password_hash(password_data.new_password)
    await db.commit()

    # Invalidate all existing sessions for security
    # Users will need to log in again with the new password
    if settings.REDIS_ENABLED:

        # Get all device sessions for this user
        user_sessions = await device_session_service.get_user_device_sessions(
            db, current_user.id
        )

        # Delete all device sessions (user will need to re-authenticate)
        for session in user_sessions:
            await device_session_service.delete_device_session(db, session)

        logger.info(
            "password_changed_sessions_revoked",
            user_id=str(current_user.id),
            sessions_revoked=len(user_sessions),
        )

    # Track password change event
    await auth_analytics_service.track_event(
        db=db,
        event_name="password_changed",
        user_id=current_user.id,
        properties={
            "subscription_tier": current_user.subscription_tier,
        },
    )

    logger.info(
        "user_password_changed",
        user_id=str(current_user.id),
        email=current_user.email,
    )

    return ChangePasswordResponse(
        success=True,
        message="Password changed successfully. Please log in again with your new password.",
    )


class ResendDeviceVerificationRequest(BaseModel):
    """Request to resend device verification email."""

    device_id: uuid_lib.UUID


@router.post("/resend-device-verification", tags=["auth"])
@auth_rate_limit("3 per 5 minutes")
async def resend_device_verification(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    request_data: ResendDeviceVerificationRequest,
):
    """
    Resend device verification email.

    Rate limited to 3 attempts per 5 minutes to prevent email spam.

    Args:
        request_data: Contains device_id to resend verification for

    Returns:
        Success message if email sent
    """
    # Get device session with ownership verification
    device_session = await device_session_service.get_device_session_by_id(
        db, request_data.device_id, current_user.id
    )

    if not device_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found or you don't have permission to access it",
        )

    # Check if already verified
    if device_session.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device is already verified",
        )

    # Check rate limiting - don't allow resending within 5 minutes
    if device_session.verification_sent_at:
        time_since_last = datetime.utcnow() - device_session.verification_sent_at
        if time_since_last < timedelta(minutes=5):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {5 - time_since_last.seconds // 60} more minutes before resending",
            )

    # Send verification email
    await _send_device_verification_email(
        db=db,
        device_session=device_session,
        user_email=current_user.email,
        username=(
            current_user.username
            if hasattr(current_user, "username")
            else current_user.email
        ),
    )

    return {
        "success": True,
        "message": "Verification email sent",
    }


# ===== DEVICE VERIFICATION HELPER FUNCTIONS =====


async def _send_device_verification_email(
    db: AsyncSession,
    device_session: DeviceSession,
    user_email: str,
    username: str,
) -> None:
    """
    Send device verification email to user.

    Args:
        db: Database session
        device_session: Device session that needs verification
        user_email: User's email address
        username: User's username
    """
    from app.services.email.email_template_service import EmailTemplateService
    from app.worker.queue import task_queue

    # Generate verification token
    verification_token = await device_session_service.generate_verification_token(
        db, device_session
    )

    # Build verification URL
    verify_url = f"{settings.FRONTEND_URL}/verify-device?token={verification_token}"

    # Format location string
    location_parts = []
    if device_session.city:
        location_parts.append(device_session.city)
    if device_session.country:
        location_parts.append(device_session.country)
    location = ", ".join(location_parts) if location_parts else "Unknown"

    # Format device info from user agent (simplified)
    device_info = (
        device_session.user_agent[:100] + "..."
        if len(device_session.user_agent) > 100
        else device_session.user_agent
    )

    # Build template context
    context = {
        "username": username,
        "verify_url": verify_url,
        "login_time": device_session.created_at.strftime("%Y-%m-%d %H:%M UTC"),
        "location": location,
        "ip_address": device_session.ip_address,
        "device_info": device_info,
    }

    # Render email template
    template_service = EmailTemplateService()
    html_body = template_service.render_template("device_verification", context)

    # Send email via task queue
    job_id = await task_queue.send_email(
        to_email=user_email,
        subject="Qontinui - New Device Login Detected",
        html_content=html_body,
        text_content=f"New device login detected from {location} (IP: {device_session.ip_address}). If this was you, please verify your device using the link sent to your email.",
    )

    if job_id:
        logger.info(
            "device_verification_email_sent",
            user_email=user_email,
            device_id=str(device_session.id),
            job_id=job_id,
        )
    else:
        logger.error(
            "device_verification_email_failed",
            user_email=user_email,
            device_id=str(device_session.id),
        )
