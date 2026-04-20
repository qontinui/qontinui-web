from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.core.config import settings
from app.core.error_codes import ErrorCode
from app.crud import runner as runner_crud
from app.middleware.error_handler import forbidden_error, not_found_error
from app.middleware.rate_limit import user_limiter
from app.models.runner_device import RunnerDevice
from app.models.user import User
from app.schemas.runner_device import RunnerDevice as RunnerDeviceSchema
from app.schemas.runner_device import (
    RunnerDeviceConnectionInfo,
    RunnerDeviceHeartbeat,
    RunnerDeviceHeartbeatResponse,
    RunnerDeviceRegister,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/register",
    response_model=RunnerDeviceSchema,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {
            "description": "Device registered successfully",
            "content": {
                "application/json": {
                    "example": {
                        "id": "123e4567-e89b-12d3-a456-426614174000",
                        "user_id": "789e4567-e89b-12d3-a456-426614174000",
                        "device_id": "abc123-device-uuid",
                        "device_name": "Joshua's MacBook Pro",
                        "platform": "darwin",
                        "is_active": True,
                        "created_at": "2024-01-15T10:30:00Z",
                        "updated_at": "2024-01-15T10:30:00Z",
                    }
                }
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        409: {
            "description": "Device already registered",
            "content": {
                "application/json": {"example": {"detail": "Device already registered"}}
            },
        },
    },
)
@user_limiter.limit("10 per minute")
async def register_device(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    device_in: RunnerDeviceRegister,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Register a new runner device.

    Creates a new device registration for the authenticated user.
    If the device_id already exists, update the existing record instead.
    """
    logger.info(
        "register_device_request",
        user_id=current_user.id,
        device_id=device_in.device_id,
        platform=device_in.platform,
    )

    # Check if device already exists
    result = await db.execute(
        select(RunnerDevice).where(RunnerDevice.device_id == device_in.device_id)
    )
    existing_device = result.scalar_one_or_none()

    if existing_device:
        # Update existing device
        existing_device.device_name = device_in.device_name  # type: ignore[assignment]
        existing_device.platform = device_in.platform  # type: ignore[assignment]
        existing_device.user_id = current_user.id  # type: ignore[assignment]
        existing_device.is_active = True  # type: ignore[assignment]
        existing_device.updated_at = datetime.now(UTC)  # type: ignore[assignment]
        existing_device.last_seen_at = datetime.now(UTC)  # type: ignore[assignment]

        await db.commit()
        await db.refresh(existing_device)

        logger.info(
            "register_device_updated",
            user_id=current_user.id,
            device_id=device_in.device_id,
            device_db_id=existing_device.id,
        )

        return RunnerDeviceSchema.model_validate(existing_device)

    # Create new device
    device = RunnerDevice(
        user_id=current_user.id,
        device_id=device_in.device_id,
        device_name=device_in.device_name,
        platform=device_in.platform,
        is_active=True,
        last_seen_at=datetime.now(UTC),
    )

    db.add(device)
    await db.commit()
    await db.refresh(device)

    logger.info(
        "register_device_success",
        user_id=current_user.id,
        device_id=device_in.device_id,
        device_db_id=device.id,
    )

    return RunnerDeviceSchema.model_validate(device)


@router.get(
    "",
    response_model=list[RunnerDeviceSchema],
    responses={
        200: {
            "description": "List of registered devices",
            "content": {
                "application/json": {
                    "example": [
                        {
                            "id": "123e4567-e89b-12d3-a456-426614174000",
                            "user_id": "789e4567-e89b-12d3-a456-426614174000",
                            "device_id": "abc123-device-uuid",
                            "device_name": "Joshua's MacBook Pro",
                            "platform": "darwin",
                            "is_active": True,
                            "last_seen_at": "2024-01-15T10:30:00Z",
                            "created_at": "2024-01-15T10:30:00Z",
                            "updated_at": "2024-01-15T10:30:00Z",
                        }
                    ]
                }
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("60 per minute")
async def list_devices(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    include_inactive: bool = False,
) -> Any:
    """
    Get all devices registered to the current user.

    By default, only returns active devices.
    Set include_inactive=true to include deactivated devices.
    """
    logger.info(
        "list_devices_request",
        user_id=current_user.id,
        include_inactive=include_inactive,
    )

    # Query devices
    query = select(RunnerDevice).where(RunnerDevice.user_id == current_user.id)
    if not include_inactive:
        query = query.where(RunnerDevice.is_active == True)  # noqa: E712

    query = query.order_by(RunnerDevice.last_seen_at.desc().nullslast())

    result = await db.execute(query)
    devices = result.scalars().all()

    logger.info(
        "list_devices_response",
        user_id=current_user.id,
        device_count=len(devices),
    )

    return [RunnerDeviceSchema.model_validate(device) for device in devices]


@router.delete(
    "/{device_id}",
    status_code=status.HTTP_200_OK,
    responses={
        200: {
            "description": "Device deactivated successfully",
            "content": {
                "application/json": {
                    "example": {"message": "Device deactivated successfully"}
                }
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        403: {
            "description": "Insufficient permissions",
            "content": {
                "application/json": {
                    "example": {"detail": "Not authorized to delete this device"}
                }
            },
        },
        404: {
            "description": "Device not found",
            "content": {
                "application/json": {"example": {"detail": "Device not found"}}
            },
        },
    },
)
@user_limiter.limit("20 per minute")
async def delete_device(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    device_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Deactivate a runner device.

    Marks the device as inactive. The device will no longer be able to connect.
    Only the device owner can deactivate it.
    """
    logger.info(
        "delete_device_request",
        user_id=current_user.id,
        device_id=device_id,
    )

    # Find device
    result = await db.execute(
        select(RunnerDevice).where(RunnerDevice.device_id == device_id)
    )
    device = result.scalar_one_or_none()

    if not device:
        raise not_found_error("Device not found", ErrorCode.RESOURCE_NOT_FOUND)

    # Check ownership
    if device.user_id != current_user.id:
        raise forbidden_error(
            "Not authorized to delete this device",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Deactivate device
    device.is_active = False  # type: ignore[assignment]
    device.updated_at = datetime.now(UTC)  # type: ignore[assignment]

    await db.commit()

    logger.info(
        "delete_device_success",
        user_id=current_user.id,
        device_id=device_id,
        device_db_id=device.id,
    )

    return {"message": "Device deactivated successfully"}


@router.post(
    "/{device_id}/heartbeat",
    response_model=RunnerDeviceHeartbeatResponse,
    status_code=status.HTTP_200_OK,
    responses={
        200: {
            "description": "Heartbeat received successfully",
            "content": {
                "application/json": {
                    "example": {
                        "message": "Heartbeat received",
                        "has_active_connection": True,
                    }
                }
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        403: {
            "description": "Insufficient permissions",
            "content": {
                "application/json": {
                    "example": {"detail": "Not authorized to update this device"}
                }
            },
        },
        404: {
            "description": "Device not found",
            "content": {
                "application/json": {"example": {"detail": "Device not found"}}
            },
        },
    },
)
@user_limiter.limit("120 per minute")
async def device_heartbeat(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    device_id: str,
    heartbeat: RunnerDeviceHeartbeat,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Update device last seen timestamp.

    Devices should call this periodically to indicate they are online.
    """
    logger.debug(
        "device_heartbeat_request",
        user_id=current_user.id,
        device_id=device_id,
        project_id=heartbeat.project_id,
    )

    # Find device
    result = await db.execute(
        select(RunnerDevice).where(RunnerDevice.device_id == device_id)
    )
    device = result.scalar_one_or_none()

    if not device:
        raise not_found_error("Device not found", ErrorCode.RESOURCE_NOT_FOUND)

    # Check ownership
    if device.user_id != current_user.id:
        raise forbidden_error(
            "Not authorized to update this device",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Update last seen
    device.last_seen_at = datetime.now(UTC)  # type: ignore[assignment]
    device.updated_at = datetime.now(UTC)  # type: ignore[assignment]

    await db.commit()

    # Check if user has any active WebSocket connections
    active_connections = await runner_crud.get_active_connections(db, current_user.id)
    has_active = len(active_connections) > 0

    return {"message": "Heartbeat received", "has_active_connection": has_active}


@router.get(
    "/{device_id}/connection-info",
    response_model=RunnerDeviceConnectionInfo,
    responses={
        200: {
            "description": "Connection information retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "device_id": "abc123-device-uuid",
                        "websocket_url": "ws://localhost:8000",
                        "http_url": "http://localhost:8000",
                        "user_id": "789e4567-e89b-12d3-a456-426614174000",
                        "is_active": True,
                    }
                }
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        403: {
            "description": "Insufficient permissions",
            "content": {
                "application/json": {
                    "example": {"detail": "Not authorized to access this device"}
                }
            },
        },
        404: {
            "description": "Device not found",
            "content": {
                "application/json": {"example": {"detail": "Device not found"}}
            },
        },
    },
)
@user_limiter.limit("60 per minute")
async def get_connection_info(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    device_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get WebSocket connection information for a device.

    Returns the URLs and configuration needed for the device to connect.
    """
    logger.info(
        "get_connection_info_request",
        user_id=current_user.id,
        device_id=device_id,
    )

    # Find device
    result = await db.execute(
        select(RunnerDevice).where(RunnerDevice.device_id == device_id)
    )
    device = result.scalar_one_or_none()

    if not device:
        raise not_found_error("Device not found", ErrorCode.RESOURCE_NOT_FOUND)

    # Check ownership
    if device.user_id != current_user.id:
        raise forbidden_error(
            "Not authorized to access this device",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Determine WebSocket URL (ws:// or wss:// based on backend URL)
    # NOTE: Return just the base URL - the Python client constructs the full path
    # Full path will be: {ws_url}/api/v1/automation/ws/automation/runner?token=...
    backend_url = settings.BACKEND_URL or "http://localhost:8000"
    ws_url = backend_url.replace("https://", "wss://").replace("http://", "ws://")

    logger.info(
        "get_connection_info_success",
        user_id=current_user.id,
        device_id=device_id,
        device_db_id=device.id,
    )

    return RunnerDeviceConnectionInfo(
        device_id=str(device.device_id),
        websocket_url=ws_url,
        http_url=backend_url,
        user_id=str(current_user.id),
        is_active=bool(device.is_active),
    )
