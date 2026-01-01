"""Device management endpoints."""

import uuid as uuid_lib

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.schemas.device_session import DeviceSessionSummary, DeviceSessionUpdate
from app.services.device_session_service import device_session_service

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.get("/devices", response_model=list[DeviceSessionSummary])
async def get_user_devices(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> list[DeviceSessionSummary]:
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


@router.patch("/devices/{device_id}", response_model=DeviceSessionSummary)
async def update_device(
    *,
    device_id: uuid_lib.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    device_update: DeviceSessionUpdate,
) -> DeviceSessionSummary:
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


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    *,
    device_id: uuid_lib.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """
    Delete a device session.

    This removes the device from the user's trusted devices list.
    The user will need to re-authenticate from this device.
    """
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
