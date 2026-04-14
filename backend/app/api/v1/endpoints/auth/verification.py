"""Device verification endpoints."""

import uuid as uuid_lib
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from app.api.deps import current_active_user, get_async_db
from app.core.error_codes import ErrorCode
from app.middleware.error_handler import validation_error
from app.middleware.rate_limit import auth_rate_limit
from app.models.user import User
from app.services.device_session_service import device_session_service
from fastapi import (APIRouter, Depends, HTTPException, Request, Response,
                     status)
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


class ResendDeviceVerificationRequest(BaseModel):
    """Request to resend device verification email."""

    device_id: uuid_lib.UUID


@router.get("/verify-device/{token}")
async def verify_device(
    *,
    token: str,
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
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


@router.post("/resend-device-verification")
@auth_rate_limit("3 per 5 minutes")
async def resend_device_verification(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    request_data: ResendDeviceVerificationRequest,
) -> dict[str, Any]:
    """
    Resend device verification email.

    Rate limited to 3 attempts per 5 minutes to prevent email spam.

    Args:
        request_data: Contains device_id to resend verification for

    Returns:
        Success message if email sent
    """
    from app.api.v1.endpoints.auth.helpers import \
        send_device_verification_email

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
        time_since_last = datetime.now(UTC) - device_session.verification_sent_at
        if time_since_last < timedelta(minutes=5):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Please wait {5 - time_since_last.seconds // 60} more minutes "
                    "before resending"
                ),
            )

    # Send verification email
    await send_device_verification_email(
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
