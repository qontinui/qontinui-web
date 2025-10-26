"""
Device fingerprint validation dependencies.

Provides FastAPI dependencies for validating device fingerprints on protected routes.
"""

import uuid

import structlog
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.core.security import decode_token
from app.services.device_fingerprint_service import device_fingerprint_service
from app.services.device_session_service import device_session_service

logger = structlog.get_logger(__name__)


async def validate_device_fingerprint(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
) -> tuple[str, dict[str, str]]:
    """
    Validate device fingerprint from request.

    This dependency can be used on protected routes to ensure the request
    is coming from a known device. It helps prevent token theft by validating
    that the device fingerprint matches the one stored with the token.

    Args:
        request: FastAPI request
        db: Database session

    Returns:
        Tuple of (device_fingerprint, device_info)

    Raises:
        HTTPException: If device fingerprint is invalid or suspicious
    """
    # Extract Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    token = auth_header.replace("Bearer ", "")

    # Decode token to get user_id and device fingerprint
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id_str = payload.get("sub")
    token_fingerprint = payload.get("device_fp")

    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    # Generate fingerprint from current request
    current_fingerprint, device_info = (
        device_fingerprint_service.generate_fingerprint_from_request(request)
    )

    # If token doesn't have device fingerprint (backward compatibility), just return
    if not token_fingerprint:
        logger.warning(
            "token_without_device_fingerprint",
            user_id=user_id_str,
            message="Token does not contain device fingerprint - backward compatibility mode",
        )
        return current_fingerprint, device_info

    # Verify device fingerprint matches token
    if current_fingerprint != token_fingerprint:
        logger.error(
            "device_fingerprint_mismatch",
            user_id=user_id_str,
            token_fingerprint=token_fingerprint,
            current_fingerprint=current_fingerprint,
            ip_address=device_info["ip_address"],
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Device fingerprint mismatch - possible token theft. Please login again.",
        )

    # Check if device session exists
    user_id = uuid.UUID(user_id_str)
    device_session = await device_session_service.get_device_session(
        db, user_id, current_fingerprint
    )

    if not device_session:
        logger.warning(
            "unknown_device_session",
            user_id=user_id_str,
            device_fingerprint=current_fingerprint,
        )
        # Note: We don't raise an error here because the device might have been
        # deleted from the database but the token is still valid

    else:
        # Update last seen activity
        await device_session_service.update_device_session_activity(
            db, device_session, device_info["ip_address"]
        )

    return current_fingerprint, device_info


async def require_trusted_device(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
) -> None:
    """
    Require that the request comes from a trusted device.

    This is a stricter version of validate_device_fingerprint that also
    checks if the device is marked as trusted. If DEVICE_VERIFICATION_REQUIRED_FOR_TRUSTED
    is enabled, also checks if the device is email verified.

    Args:
        request: FastAPI request
        db: Database session

    Raises:
        HTTPException: If device is not trusted or not verified
    """
    from app.core.config import settings

    fingerprint, device_info = await validate_device_fingerprint(request, db)

    # Extract user ID from token
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "")
    payload = decode_token(token)
    user_id = uuid.UUID(payload.get("sub"))

    # Get device session
    device_session = await device_session_service.get_device_session(
        db, user_id, fingerprint
    )

    if not device_session:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Device session not found. Please login again.",
        )

    # Check if device verification is required for trusted devices
    if (
        settings.DEVICE_VERIFICATION_REQUIRED_FOR_TRUSTED
        and not device_session.email_verified
    ):
        logger.warning(
            "unverified_device_access_attempt",
            user_id=str(user_id),
            device_fingerprint=fingerprint,
        )

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires device verification. Please check your email to verify this device.",
        )

    # Check if device is trusted
    if not device_session.is_trusted:
        logger.warning(
            "untrusted_device_access_attempt",
            user_id=str(user_id),
            device_fingerprint=fingerprint,
        )

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires a trusted device. Please verify this device first.",
        )
