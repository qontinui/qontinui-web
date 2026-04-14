"""Admin notification settings endpoints."""

from typing import Any

import structlog
from app.api.deps import get_async_db
from app.api.v1.endpoints.admin.dependencies import require_admin
from app.models.user import User
from app.schemas.admin import (
    AdminNotificationSettingsResponse,
    AdminNotificationSettingsUpdate,
)
from app.services.admin_notification_service import admin_notification_service
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.get("/notifications/settings", response_model=AdminNotificationSettingsResponse)
async def get_notification_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> AdminNotificationSettingsResponse:
    """
    Get admin notification settings.

    Returns the current configuration for admin email notifications including:
    - Email address for notifications
    - Which events trigger notifications (user signup, project creation)
    - Whether notifications are enabled

    If no settings exist, creates default settings using the current user's email.
    """
    settings = await admin_notification_service.get_or_create_settings(
        db, default_email=current_user.email
    )

    return AdminNotificationSettingsResponse(
        id=str(settings.id),
        notification_email=str(settings.notification_email),
        notify_on_user_signup=bool(settings.notify_on_user_signup),
        notify_on_project_created=bool(settings.notify_on_project_created),
        notifications_enabled=bool(settings.notifications_enabled),
        created_at=settings.created_at,  # type: ignore[arg-type]
        updated_at=settings.updated_at,  # type: ignore[arg-type]
    )


@router.put("/notifications/settings", response_model=AdminNotificationSettingsResponse)
async def update_notification_settings(
    settings_update: AdminNotificationSettingsUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> AdminNotificationSettingsResponse:
    """
    Update admin notification settings.

    Allows updating:
    - notification_email: Email address to receive notifications
    - notify_on_user_signup: Enable/disable user signup notifications
    - notify_on_project_created: Enable/disable project creation notifications
    - notifications_enabled: Master toggle for all notifications

    Only provided fields will be updated.
    """
    updates = settings_update.model_dump(exclude_none=True)

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid fields to update",
        )

    settings = await admin_notification_service.update_settings(db, updates)

    logger.info(
        "admin_notification_settings_updated",
        admin_id=str(current_user.id),
        admin_email=current_user.email,
        updated_fields=list(updates.keys()),
    )

    return AdminNotificationSettingsResponse(
        id=str(settings.id),
        notification_email=str(settings.notification_email),
        notify_on_user_signup=bool(settings.notify_on_user_signup),
        notify_on_project_created=bool(settings.notify_on_project_created),
        notifications_enabled=bool(settings.notifications_enabled),
        created_at=settings.created_at,  # type: ignore[arg-type]
        updated_at=settings.updated_at,  # type: ignore[arg-type]
    )


@router.post("/notifications/test")
async def send_test_notification(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """
    Send a test notification email to verify settings are working.

    Sends a test email to the configured notification email address.
    Returns success or failure status.
    """
    from app.services.email.email_transport_service import EmailTransportService

    settings = await admin_notification_service.get_or_create_settings(
        db, default_email=current_user.email
    )

    if not settings.notifications_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin notifications are disabled. Enable them first.",
        )

    email_transport = EmailTransportService()

    success = await email_transport.send_email(
        to_email=str(settings.notification_email),
        subject="Qontinui Admin Notification Test",
        text_body=(
            f"This is a test notification from Qontinui.\n\n"
            f"Your admin notification settings are configured correctly.\n\n"
            f"Sent by: {current_user.username} ({current_user.email})"
        ),
        html_body=None,
    )

    if success:
        logger.info(
            "admin_test_notification_sent",
            admin_id=str(current_user.id),
            to_email=settings.notification_email,
        )
        return {
            "success": True,
            "message": f"Test notification sent to {settings.notification_email}",
        }
    else:
        logger.error(
            "admin_test_notification_failed",
            admin_id=str(current_user.id),
            to_email=settings.notification_email,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send test notification. Check email configuration.",
        )
