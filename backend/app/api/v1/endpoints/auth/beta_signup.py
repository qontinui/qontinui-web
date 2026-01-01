"""Beta signup endpoints."""

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.crud.user import get_user_by_email
from app.middleware.rate_limit import auth_rate_limit
from app.services.auth.password_service import password_service
from app.services.auth.user_management_service import user_management_service

logger = structlog.get_logger(__name__)
router = APIRouter()


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
) -> BetaSignupResponse:
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
        user.is_verified = True
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
            html_content=(
                f"<p>Welcome {username}!</p>"
                f"<p>Your temporary password is: {temp_password}</p>"
            ),
            text_content=(
                f"Welcome {username}!\n\n"
                f"Your temporary password is: {temp_password}"
            ),
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
            message=(
                f"Beta access created! Check your email for login instructions. "
                f"Username: {username}, Temporary password: {temp_password}"
            ),
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
