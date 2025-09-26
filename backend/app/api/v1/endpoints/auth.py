import logging
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import (
    blacklist_token,
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password_reset_token,
)
from app.crud.user import (
    authenticate_user,
    create_user,
    get_user_by_email,
    get_user_by_username,
)
from app.schemas.token import Token
from app.schemas.user import User, UserCreate

logger = logging.getLogger(__name__)

router = APIRouter()


class BetaSignupRequest(BaseModel):
    email: EmailStr


class BetaSignupResponse(BaseModel):
    success: bool
    message: str
    temp_password: str | None = None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


@router.post("/login", response_model=Token)
def login(
    db: Session = Depends(get_db), form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@router.post("/register", response_model=User)
def register(*, db: Session = Depends(get_db), user_in: UserCreate) -> Any:
    # Check if user with email already exists
    user = get_user_by_email(db, email=user_in.email)
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists",
        )

    # Check if user with username already exists
    user = get_user_by_username(db, username=user_in.username)
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this username already exists",
        )

    user = create_user(db, user_in)
    return user


@router.post("/refresh", response_model=Token)
def refresh_token(*, db: Session = Depends(get_db), refresh_token: str) -> Any:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise credentials_exception

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    # Blacklist the old refresh token
    blacklist_token(refresh_token)

    # Create new tokens
    access_token = create_access_token(user_id)
    new_refresh_token = create_refresh_token(user_id)

    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.post("/logout")
def logout(
    *,
    authorization: str = Depends(OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")),
    refresh_token: str | None = None,
) -> Any:
    """Logout endpoint that blacklists the provided tokens"""

    # Blacklist the access token
    if authorization:
        blacklist_token(authorization)

    # Blacklist the refresh token if provided
    if refresh_token:
        blacklist_token(refresh_token)

    return {"message": "Successfully logged out"}


@router.post("/beta-signup", response_model=BetaSignupResponse)
def beta_signup(
    *, db: Session = Depends(get_db), signup_request: BetaSignupRequest
) -> Any:
    """Beta signup endpoint that creates a new user account with beta access"""

    # Check if user with this email already exists
    existing_user = get_user_by_email(db, email=signup_request.email)
    if existing_user:
        return BetaSignupResponse(
            success=True,
            message="You're already on the list! Check your email for login instructions.",
            temp_password=None,
        )

    # Generate a random temporary password
    temp_password = secrets.token_urlsafe(12)

    # Create username from email (before @ symbol)
    username_base = signup_request.email.split("@")[0]
    username = username_base

    # Ensure username is unique by adding numbers if needed
    counter = 1
    while get_user_by_username(db, username=username):
        username = f"{username_base}{counter}"
        counter += 1

    # Create the user with beta access
    user_in = UserCreate(
        email=signup_request.email,
        username=username,
        password=temp_password,
        full_name="",
    )

    try:
        # Create user (this will hash the password)
        user = create_user(db, user_in)

        # Update user to set beta flag (need to do this separately)
        user.is_beta = True
        user.is_active = True  # Auto-activate beta users
        db.commit()

        # Log the signup for monitoring
        logger.info(
            f"New beta signup: {signup_request.email} with username: {username}"
        )

        # Note: Email sending disabled for now as SMTP is not configured
        # In production, configure SMTP settings and uncomment:
        # await email_service.send_beta_welcome_email(
        #     signup_request.email,
        #     username,
        #     temp_password
        # )

        # In production, remove the temp_password from response
        return BetaSignupResponse(
            success=True,
            message=f"Beta access created! Check your email for login instructions. Username: {username}, Temporary password: {temp_password}",
            temp_password=temp_password,  # TODO: Remove this in production!
        )

    except Exception as e:
        logger.error(f"Error creating beta user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create beta account. Please try again.",
        )


@router.post("/password-reset")
async def request_password_reset(
    *, db: Session = Depends(get_db), reset_request: PasswordResetRequest
) -> Any:
    """Request a password reset token"""

    user = get_user_by_email(db, email=reset_request.email)
    if user:
        # Generate reset token
        reset_token = create_password_reset_token(reset_request.email)

        # Note: Email sending disabled for now as SMTP is not configured
        # In production, configure SMTP settings and uncomment:
        # await email_service.send_password_reset_email(
        #     reset_request.email,
        #     user.username,
        #     reset_token
        # )

        logger.info(
            f"Password reset token generated for {reset_request.email}: {reset_token}"
        )

    # Always return success to prevent email enumeration
    return {
        "success": True,
        "message": "If that email exists in our system, you will receive a password reset link.",
    }


@router.post("/password-reset-confirm")
def confirm_password_reset(
    *, db: Session = Depends(get_db), reset_confirm: PasswordResetConfirm
) -> Any:
    """Reset password using token"""

    # Verify token and get email
    email = verify_password_reset_token(reset_confirm.token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    # Get user by email
    user = get_user_by_email(db, email=email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    # Update password
    user.hashed_password = get_password_hash(reset_confirm.new_password)
    db.commit()

    return {
        "success": True,
        "message": "Password has been reset successfully. You can now log in with your new password.",
    }
