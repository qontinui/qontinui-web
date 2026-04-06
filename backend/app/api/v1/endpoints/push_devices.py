"""Push device registration endpoints for mobile push notifications."""

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.middleware.rate_limit import user_limiter
from app.models.push_device import PushDevice
from app.models.user import User
from app.schemas.push_device import PushDeviceRegister, PushDeviceResponse

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/register-push",
    response_model=PushDeviceResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {"description": "Push device registered successfully"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("20 per minute")
async def register_push_device(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    device_in: PushDeviceRegister,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Register a push notification token for the authenticated user.

    Mobile clients call this after login to enable push notifications.
    If the token already exists, updates the existing record.
    """
    logger.info(
        "register_push_device",
        user_id=current_user.id,
        platform=device_in.platform,
        has_device_name=bool(device_in.device_name),
    )

    # Check if token already exists
    result = await db.execute(
        select(PushDevice).where(PushDevice.push_token == device_in.push_token)
    )
    existing = result.scalar_one_or_none()

    if existing:
        # Update existing — reassign to current user if needed
        existing.user_id = current_user.id  # type: ignore[assignment]
        existing.platform = device_in.platform  # type: ignore[assignment]
        existing.device_name = device_in.device_name  # type: ignore[assignment]
        existing.is_active = True  # type: ignore[assignment]
        existing.updated_at = datetime.now(UTC)  # type: ignore[assignment]

        await db.commit()
        await db.refresh(existing)

        logger.info(
            "push_device_updated",
            user_id=current_user.id,
            device_id=existing.id,
        )

        return PushDeviceResponse.model_validate(existing)

    # Create new
    device = PushDevice(
        user_id=current_user.id,
        push_token=device_in.push_token,
        platform=device_in.platform,
        device_name=device_in.device_name,
        is_active=True,
    )

    db.add(device)
    await db.commit()
    await db.refresh(device)

    logger.info(
        "push_device_registered",
        user_id=current_user.id,
        device_id=device.id,
    )

    return PushDeviceResponse.model_validate(device)


@router.get(
    "/push-devices",
    response_model=list[PushDeviceResponse],
    responses={
        200: {"description": "List of registered push devices"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("60 per minute")
async def list_push_devices(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List push devices registered to the authenticated user."""
    result = await db.execute(
        select(PushDevice)
        .where(
            PushDevice.user_id == current_user.id,
            PushDevice.is_active == True,  # noqa: E712
        )
        .order_by(PushDevice.updated_at.desc())
    )
    devices = result.scalars().all()
    return [PushDeviceResponse.model_validate(d) for d in devices]


@router.delete(
    "/push-devices/{push_token}",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Push device deactivated"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("20 per minute")
async def unregister_push_device(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    push_token: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Deactivate a push device (e.g., on logout)."""
    result = await db.execute(
        select(PushDevice).where(
            PushDevice.push_token == push_token,
            PushDevice.user_id == current_user.id,
        )
    )
    device = result.scalar_one_or_none()

    if device:
        device.is_active = False  # type: ignore[assignment]
        device.updated_at = datetime.now(UTC)  # type: ignore[assignment]
        await db.commit()

        logger.info(
            "push_device_deactivated",
            user_id=current_user.id,
            push_token=push_token[:20] + "...",
        )

    return {"message": "Push device deactivated"}
