"""
Authentication endpoints using fastapi-users.

This replaces the custom authentication implementation with fastapi-users,
while maintaining custom endpoints like beta signup.
"""

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.auth.config import auth_backend, fastapi_users
from app.core.security import verify_password
from app.crud.user import get_user_by_email
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.auth.password_service import password_service
from app.services.auth.user_management_service import user_management_service

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


@router.post("/jwt/login", response_model=TokenResponse, tags=["auth"])
async def login(
    *,
    db: AsyncSession = Depends(get_async_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    """
    Custom login endpoint that returns both access and refresh tokens.

    Uses the same authentication as fastapi-users but returns refresh token.
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

    # Generate tokens using existing security functions
    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))

    logger.info("user_logged_in", user_id=str(user.id), email=user.email)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


class RefreshTokenRequest(BaseModel):
    refresh_token: str


@router.post("/jwt/refresh", response_model=TokenResponse)
async def refresh_token(
    *, db: AsyncSession = Depends(get_async_db), request: RefreshTokenRequest
):
    """
    Refresh access token using refresh token.

    Returns new access and refresh tokens (token rotation).
    """
    import uuid

    from app.core.security import decode_token
    from app.crud.user import get_user

    # Decode and validate the refresh token
    payload = decode_token(request.refresh_token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id: str = payload.get("sub")
    token_type = payload.get("type")

    if not user_id or token_type != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Get user from database to ensure they still exist and are active
    user = await get_user(db, user_id=uuid.UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Generate new tokens using existing security functions
    access_token = create_access_token(subject=str(user.id))
    new_refresh_token = create_refresh_token(subject=str(user.id))

    logger.info("token_refreshed", user_id=str(user.id))

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
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
