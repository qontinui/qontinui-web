import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.crud.user import get_user_by_email, get_user_by_username
from app.schemas.token import Token
from app.schemas.user import User, UserCreate
from app.services.auth import (
    authentication_service,
    password_service,
    token_service,
    user_management_service,
)

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


class EmailVerificationRequest(BaseModel):
    email: EmailStr


class EmailVerificationConfirm(BaseModel):
    token: str


@router.post("/login", response_model=Token)
def login(
    db: Session = Depends(get_db), form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    user = authentication_service.authenticate_user(
        db, form_data.username, form_data.password
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return authentication_service.create_user_tokens(user.id)


@router.post("/register", response_model=User)
async def register(*, db: Session = Depends(get_db), user_in: UserCreate) -> Any:
    from app.services.email import email_service

    if get_user_by_email(db, email=user_in.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists",
        )

    if get_user_by_username(db, username=user_in.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this username already exists",
        )

    user = user_management_service.create_user(db, user_in)

    # Generate verification token and send email
    verification_token = token_service.create_email_verification_token(user.email)
    user.email_verification_token = verification_token
    db.commit()

    # Send verification email (async, don't block registration if it fails)
    try:
        await email_service.send_verification_email(
            user.email, user.username, verification_token
        )
        logger.info(f"Verification email sent to {user.email}")
    except Exception as e:
        logger.error(f"Failed to send verification email to {user.email}: {str(e)}")

    return user


@router.post("/refresh", response_model=Token)
def refresh_token(*, db: Session = Depends(get_db), refresh_token: str) -> Any:
    tokens = authentication_service.refresh_user_tokens(refresh_token)

    if not tokens:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return tokens


@router.get("/me", response_model=User)
def get_current_user(
    *,
    db: Session = Depends(get_db),
    authorization: str = Depends(OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")),
) -> Any:
    user_id = token_service.verify_token(authorization)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    from app.crud.user import get_user

    user = get_user(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


@router.post("/logout")
def logout(
    *,
    authorization: str = Depends(OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")),
    refresh_token: str | None = None,
) -> Any:
    authentication_service.logout_user(authorization, refresh_token)
    return {"message": "Successfully logged out"}


@router.post("/beta-signup", response_model=BetaSignupResponse)
async def beta_signup(
    *, db: Session = Depends(get_db), signup_request: BetaSignupRequest
) -> Any:
    from app.services.email import email_service

    existing_user = get_user_by_email(db, email=signup_request.email)
    if existing_user:
        return BetaSignupResponse(
            success=True,
            message="You're already on the list! Check your email for login instructions.",
            temp_password=None,
        )

    temp_password = password_service.generate_secure_password(12)
    username_base = signup_request.email.split("@")[0]
    username = user_management_service.generate_unique_username(db, username_base)

    try:
        user = user_management_service.create_beta_user(
            db, signup_request.email, username, temp_password
        )

        # Beta users get auto-verified for easier onboarding
        user.email_verified = True
        db.commit()

        # Send welcome email with credentials
        try:
            await email_service.send_beta_welcome_email(
                user.email, username, temp_password
            )
            logger.info(f"Beta welcome email sent to {user.email}")
        except Exception as e:
            logger.error(f"Failed to send beta welcome email: {str(e)}")

        logger.info(
            f"New beta signup: {signup_request.email} with username: {username}"
        )

        return BetaSignupResponse(
            success=True,
            message=f"Beta access created! Check your email for login instructions. Username: {username}, Temporary password: {temp_password}",
            temp_password=temp_password,
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
    user = get_user_by_email(db, email=reset_request.email)
    if user:
        reset_token = token_service.create_password_reset_token(reset_request.email)
        logger.info(
            f"Password reset token generated for {reset_request.email}: {reset_token}"
        )

    return {
        "success": True,
        "message": "If that email exists in our system, you will receive a password reset link.",
    }


@router.post("/password-reset-confirm")
def confirm_password_reset(
    *, db: Session = Depends(get_db), reset_confirm: PasswordResetConfirm
) -> Any:
    email = token_service.verify_password_reset_token(reset_confirm.token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user = get_user_by_email(db, email=email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    user_management_service.update_user_password(db, user, reset_confirm.new_password)

    return {
        "success": True,
        "message": "Password has been reset successfully. You can now log in with your new password.",
    }


@router.post("/send-verification")
async def send_verification_email_route(
    *, db: Session = Depends(get_db), request: EmailVerificationRequest
) -> Any:
    """Send or resend email verification link"""
    from app.services.email import email_service

    user = get_user_by_email(db, email=request.email)
    if not user:
        # Don't reveal if user exists or not
        return {
            "success": True,
            "message": "If that email exists in our system, you will receive a verification link.",
        }

    if user.email_verified:
        return {
            "success": True,
            "message": "Your email is already verified.",
        }

    # Generate verification token
    verification_token = token_service.create_email_verification_token(request.email)

    # Store token in database (optional, for tracking)
    user.email_verification_token = verification_token
    db.commit()

    # Send verification email
    await email_service.send_resend_verification_email(
        user.email, user.username, verification_token
    )

    logger.info(f"Verification email sent to {request.email}")

    return {
        "success": True,
        "message": "Verification email sent. Please check your inbox.",
    }


@router.post("/verify-email")
def verify_email(
    *, db: Session = Depends(get_db), verify_request: EmailVerificationConfirm
) -> Any:
    """Verify email address with token"""
    email = token_service.verify_email_verification_token(verify_request.token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )

    user = get_user_by_email(db, email=email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )

    if user.email_verified:
        return {
            "success": True,
            "message": "Your email is already verified.",
        }

    # Update user as verified
    user.email_verified = True
    user.email_verification_token = None
    db.commit()

    logger.info(f"Email verified for user: {user.username}")

    return {
        "success": True,
        "message": "Email verified successfully! You can now access all features.",
    }
