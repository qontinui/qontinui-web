"""
Notification API endpoints for collaboration event notifications.

Provides endpoints for:
- Listing and filtering notifications
- Marking notifications as read
- Managing notification preferences
- Getting unread counts
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.notification import Notification, NotificationPreferences
from app.models.user import User
from app.schemas.notification import (
    MarkAllReadResponse,
    NotificationFilterParams,
    NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
    NotificationResponse,
    NotificationUpdate,
    UnreadCountResponse,
)
from app.services.notification_service import notification_service

logger = structlog.get_logger(__name__)

router = APIRouter()


# ============================================================================
# Notification Endpoints
# ============================================================================


@router.get("", response_model=list[NotificationResponse])
async def get_notifications(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    type: str | None = Query(None, description="Filter by notification type"),
    read: bool | None = Query(None, description="Filter by read status"),
    project_id: int | None = Query(None, description="Filter by project"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> Any:
    """
    Get notifications for the current user.

    Supports filtering by type, read status, and project.
    """
    logger.info(
        "get_notifications_request",
        user_id=current_user.id,
        type=type,
        read=read,
        project_id=project_id,
    )

    notifications = await notification_service.get_notifications(
        db=db,
        user_id=current_user.id,
        notification_type=type,
        read=read,
        project_id=project_id,
        limit=limit,
        offset=offset,
    )

    # Populate actor and project information
    response_notifications = []
    for notification in notifications:
        # Fetch actor details
        actor_data = {}
        if notification.actor_id:
            result = await db.execute(
                select(User).filter(User.id == notification.actor_id)
            )
            actor = result.scalar_one_or_none()
            if actor:
                actor_data = {
                    "actor_username": actor.username,
                    "actor_email": actor.email,
                    "actor_avatar_url": actor.avatar_url,
                }

        # Fetch project details
        project_data = {}
        if notification.project_id:
            from app.models.project import Project

            result = await db.execute(
                select(Project).filter(Project.id == notification.project_id)
            )
            project = result.scalar_one_or_none()
            if project:
                project_data = {"project_name": project.name}

        # Build response
        notification_dict = {
            "id": notification.id,
            "user_id": notification.user_id,
            "type": notification.type.value,
            "title": notification.title,
            "message": notification.message,
            "project_id": notification.project_id,
            "resource_type": notification.resource_type,
            "resource_id": notification.resource_id,
            "actor_id": notification.actor_id,
            "read": notification.read,
            "read_at": notification.read_at,
            "metadata": notification.notification_metadata,
            "created_at": notification.created_at,
            **actor_data,
            **project_data,
        }
        response_notifications.append(NotificationResponse(**notification_dict))

    logger.info(
        "get_notifications_success",
        user_id=current_user.id,
        count=len(response_notifications),
    )

    return response_notifications


@router.get("/unread/count", response_model=UnreadCountResponse)
async def get_unread_count(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get count of unread notifications for current user."""
    logger.info("get_unread_count_request", user_id=current_user.id)

    count_data = await notification_service.get_unread_count(
        db=db, user_id=current_user.id
    )

    logger.info(
        "get_unread_count_success",
        user_id=current_user.id,
        count=count_data["count"],
    )

    return UnreadCountResponse(**count_data)


@router.put("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    *,
    db: AsyncSession = Depends(get_async_db),
    notification_id: UUID,
    update_data: NotificationUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Mark a notification as read or unread.

    Only the notification owner can update it.
    """
    logger.info(
        "mark_notification_request",
        notification_id=notification_id,
        user_id=current_user.id,
        read=update_data.read,
    )

    # Get notification
    result = await db.execute(
        select(Notification).filter(
            and_(
                Notification.id == notification_id,
                Notification.user_id == current_user.id,
            )
        )
    )
    notification = result.scalar_one_or_none()

    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    # Update read status
    if update_data.read is not None:
        if update_data.read:
            notification.mark_as_read()
        else:
            notification.mark_as_unread()

        await db.commit()
        await db.refresh(notification)

    # Populate actor and project information
    actor_data = {}
    if notification.actor_id:
        result = await db.execute(
            select(User).filter(User.id == notification.actor_id)
        )
        actor = result.scalar_one_or_none()
        if actor:
            actor_data = {
                "actor_username": actor.username,
                "actor_email": actor.email,
                "actor_avatar_url": actor.avatar_url,
            }

    project_data = {}
    if notification.project_id:
        from app.models.project import Project

        result = await db.execute(
            select(Project).filter(Project.id == notification.project_id)
        )
        project = result.scalar_one_or_none()
        if project:
            project_data = {"project_name": project.name}

    notification_dict = {
        "id": notification.id,
        "user_id": notification.user_id,
        "type": notification.type.value,
        "title": notification.title,
        "message": notification.message,
        "project_id": notification.project_id,
        "resource_type": notification.resource_type,
        "resource_id": notification.resource_id,
        "actor_id": notification.actor_id,
        "read": notification.read,
        "read_at": notification.read_at,
        "metadata": notification.notification_metadata,
        "created_at": notification.created_at,
        **actor_data,
        **project_data,
    }

    logger.info(
        "mark_notification_success",
        notification_id=notification_id,
        user_id=current_user.id,
    )

    return NotificationResponse(**notification_dict)


@router.put("/read-all", response_model=MarkAllReadResponse)
async def mark_all_notifications_read(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Mark all notifications as read for current user."""
    logger.info("mark_all_read_request", user_id=current_user.id)

    count = await notification_service.mark_all_as_read(
        db=db, user_id=current_user.id
    )

    logger.info("mark_all_read_success", user_id=current_user.id, count=count)

    return MarkAllReadResponse(marked_count=count)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(
    *,
    db: AsyncSession = Depends(get_async_db),
    notification_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """
    Delete a notification.

    Only the notification owner can delete it.
    """
    logger.info(
        "delete_notification_request",
        notification_id=notification_id,
        user_id=current_user.id,
    )

    success = await notification_service.delete_notification(
        db=db, notification_id=notification_id, user_id=current_user.id
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    logger.info(
        "delete_notification_success",
        notification_id=notification_id,
        user_id=current_user.id,
    )


# ============================================================================
# Notification Preferences Endpoints
# ============================================================================


@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_notification_preferences(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get notification preferences for current user."""
    logger.info("get_preferences_request", user_id=current_user.id)

    preferences = await notification_service.get_user_preferences(
        db=db, user_id=current_user.id
    )

    logger.info("get_preferences_success", user_id=current_user.id)

    return NotificationPreferencesResponse(
        id=preferences.id,
        user_id=preferences.user_id,
        email_mentions=preferences.email_mentions,
        email_comments=preferences.email_comments,
        email_shares=preferences.email_shares,
        email_replies=preferences.email_replies,
        email_team_invites=preferences.email_team_invites,
        in_app_mentions=preferences.in_app_mentions,
        in_app_comments=preferences.in_app_comments,
        in_app_shares=preferences.in_app_shares,
        in_app_replies=preferences.in_app_replies,
        in_app_team_invites=preferences.in_app_team_invites,
        in_app_project_updates=preferences.in_app_project_updates,
        created_at=preferences.created_at,
        updated_at=preferences.updated_at,
    )


@router.put("/preferences", response_model=NotificationPreferencesResponse)
async def update_notification_preferences(
    *,
    db: AsyncSession = Depends(get_async_db),
    preferences_update: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update notification preferences for current user."""
    logger.info("update_preferences_request", user_id=current_user.id)

    # Convert to dict, excluding None values
    update_data = preferences_update.model_dump(exclude_none=True)

    preferences = await notification_service.update_user_preferences(
        db=db, user_id=current_user.id, preferences_data=update_data
    )

    logger.info("update_preferences_success", user_id=current_user.id)

    return NotificationPreferencesResponse(
        id=preferences.id,
        user_id=preferences.user_id,
        email_mentions=preferences.email_mentions,
        email_comments=preferences.email_comments,
        email_shares=preferences.email_shares,
        email_replies=preferences.email_replies,
        email_team_invites=preferences.email_team_invites,
        in_app_mentions=preferences.in_app_mentions,
        in_app_comments=preferences.in_app_comments,
        in_app_shares=preferences.in_app_shares,
        in_app_replies=preferences.in_app_replies,
        in_app_team_invites=preferences.in_app_team_invites,
        in_app_project_updates=preferences.in_app_project_updates,
        created_at=preferences.created_at,
        updated_at=preferences.updated_at,
    )
