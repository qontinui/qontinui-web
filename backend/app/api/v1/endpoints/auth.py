"""
Authentication endpoints using fastapi-users.

This replaces the custom authentication implementation with fastapi-users,
while maintaining custom endpoints like beta signup.
"""

import uuid as uuid_lib
from datetime import datetime, timedelta

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.auth.config import auth_backend, fastapi_users
from app.core.config import settings
from app.core.security import verify_password
from app.crud.user import get_user_by_email
from app.models.device_session import DeviceSession
from app.models.user import User
from app.schemas.device_session import DeviceSessionSummary, DeviceSessionUpdate
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.auth.password_service import password_service
from app.services.auth.user_management_service import user_management_service
from app.services.auth_analytics_service import auth_analytics_service
from app.services.device_fingerprint_service import device_fingerprint_service
from app.services.device_session_service import device_session_service

logger = structlog.get_logger(__name__)

router = APIRouter()

# ===== FASTAPI-USERS ROUTERS =====

# Register auth routes (login, logout)
# NOTE: We include the full auth router but will override /jwt/login below
router.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/jwt",
    tags=["auth"],
)

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

from fastapi.security import OAuth2PasswordRequestForm

from app.core.security import create_access_token, create_refresh_token


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
async def login(
    *,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    remember_me: bool = False,
):
    """
    Custom login endpoint that returns both access and refresh tokens.

    Uses the same authentication as fastapi-users but returns refresh token.
    Also tracks device fingerprints for security.

    Args:
        remember_me: If True, issues 90-day refresh token; if False, 30-day token
    """
    # Get user by email
    user = await get_user_by_email(db, email=form_data.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="LOGIN_BAD_CREDENTIALS",
        )

    # Verify password using core.security (same as fastapi-users uses)
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="LOGIN_BAD_CREDENTIALS",
        )

    # Check if user is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="LOGIN_USER_NOT_VERIFIED",
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

    # Log remember_me usage for audit trail
    logger.info(
        "user_logged_in",
        user_id=str(user.id),
        email=user.email,
        remember_me=remember_me,
        refresh_token_days=settings.REMEMBER_ME_TOKEN_EXPIRE_DAYS
        if remember_me
        else settings.REFRESH_TOKEN_EXPIRE_DAYS,
        device_fingerprint=fingerprint,
        is_new_device=is_new_device,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
    )


class RefreshTokenRequest(BaseModel):
    refresh_token: str
    extend_session: bool = False


@router.post("/jwt/refresh", response_model=TokenResponse)
async def refresh_token(
    *, db: AsyncSession = Depends(get_async_db), request: RefreshTokenRequest
):
    """
    Refresh access token using refresh token.

    Returns new access and refresh tokens (token rotation).
    Preserves the long_lived status from the original refresh token.

    Args:
        request.refresh_token: Current refresh token
        request.extend_session: If True, resets absolute expiry to current time + MAX_SESSION_DAYS
    """
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
    payload = decode_refresh_token(request.refresh_token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id: str = payload.get("sub")
    token_type = payload.get("type")
    token_jti = payload.get("jti")
    # Preserve the long_lived flag from the original token
    is_long_lived = payload.get("long_lived", False)

    if not user_id or token_type != "refresh" or not token_jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Check if token is blacklisted
    if await token_blacklist_service.is_blacklisted(token_jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    # Get user from database to ensure they still exist and are active
    user = await get_user(db, user_id=uuid.UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Check session activity if sliding window is enabled
    if settings.SLIDING_WINDOW_ENABLED:
        # Check if session has exceeded absolute maximum
        if await is_session_expired(db, token_jti):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please log in again.",
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
    if request.extend_session and settings.SLIDING_WINDOW_ENABLED:
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
            "extend_session": request.extend_session,
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

    logger.info(
        "token_refreshed",
        user_id=str(user.id),
        long_lived=is_long_lived,
        extend_session=request.extend_session,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
    )


class BetaSignupRequest(BaseModel):
    email: EmailStr


class BetaSignupResponse(BaseModel):
    success: bool
    message: str
    temp_password: str | None = None


@router.post("/beta-signup", response_model=BetaSignupResponse)
async def beta_signup(
    *, db: AsyncSession = Depends(get_async_db), signup_request: BetaSignupRequest
):
    """
    Custom beta signup endpoint for creating beta users with temporary passwords.

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
    """
    Update a device session (e.g., mark as trusted, set device name).

    Args:
        device_id: Device session ID
        device_update: Fields to update
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

    Args:
        device_id: Device session ID
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
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


class ResendDeviceVerificationRequest(BaseModel):
    """Request to resend device verification email."""

    device_id: uuid_lib.UUID


@router.post("/resend-device-verification", tags=["auth"])
async def resend_device_verification(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    request_data: ResendDeviceVerificationRequest,
):
    """
    Resend device verification email.

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
        username=current_user.username
        if hasattr(current_user, "username")
        else current_user.email,
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
    html_body, text_body = template_service.render_template(
        "device_verification", context
    )

    # Send email via task queue
    job_id = await task_queue.send_email(
        to_email=user_email,
        subject="Qontinui - New Device Login Detected",
        html_content=html_body,
        text_content=text_body,
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
