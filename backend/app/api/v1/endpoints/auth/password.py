"""Password management endpoints."""

import structlog
from app.api.deps import current_active_user, get_async_db
from app.core.config import settings
from app.core.error_codes import ErrorCode
from app.core.security import verify_password
from app.middleware.error_handler import unauthorized_error, validation_error
from app.middleware.rate_limit import auth_rate_limit
from app.models.user import User
from app.services.auth_analytics_service import auth_analytics_service
from app.services.device_session_service import device_session_service
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


class ChangePasswordRequest(BaseModel):
    """Request to change user password."""

    current_password: str
    new_password: str


class ChangePasswordResponse(BaseModel):
    """Response for password change request."""

    success: bool
    message: str


@router.post("/change-password", response_model=ChangePasswordResponse)
@auth_rate_limit("5 per hour")
async def change_password(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    password_data: ChangePasswordRequest,
) -> ChangePasswordResponse:
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
    if settings.REDIS_ENABLED:
        user_sessions = await device_session_service.get_user_device_sessions(
            db, current_user.id
        )

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
