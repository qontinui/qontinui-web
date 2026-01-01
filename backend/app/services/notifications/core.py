"""
Core notification service for collaboration events.

Provides business logic for:
- Creating and sending in-app notifications
- Managing notification preferences
- Email notifications for collaboration events
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationType
from app.services.notifications.collaboration import CollaborationNotifications
from app.services.notifications.email import notification_email_service
from app.services.notifications.preferences import user_preferences_service
from app.services.websocket_manager import connection_manager

logger = structlog.get_logger(__name__)


class NotificationService(CollaborationNotifications):
    """Service for managing notifications."""

    # ========================================================================
    # Core Notification Methods
    # ========================================================================

    async def create_notification(
        self,
        db: AsyncSession,
        user_id: UUID,
        notification_type: NotificationType,
        title: str,
        message: str,
        actor_id: UUID | None = None,
        project_id: UUID | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        send_email: bool = True,
    ) -> Notification | None:
        """
        Create a new notification.

        Args:
            db: Database session
            user_id: ID of user to notify
            notification_type: Type of notification
            title: Notification title
            message: Notification message
            actor_id: ID of user who triggered the notification
            project_id: Related project ID
            resource_type: Type of resource (workflow, state, comment, etc.)
            resource_id: ID of the resource
            metadata: Additional metadata for deep links
            send_email: Whether to send email notification

        Returns:
            Created Notification object
        """
        try:
            # Get user preferences
            preferences = await user_preferences_service.get_user_preferences(
                db, user_id
            )

            # Check if in-app notification should be sent
            if not preferences.should_send_in_app(notification_type):
                logger.info(
                    "notification_skipped_in_app",
                    user_id=user_id,
                    type=notification_type.value,
                    reason="user_preferences",
                )
                return None

            # Create notification
            notification = Notification(
                user_id=user_id,
                type=notification_type,
                title=title,
                message=message,
                actor_id=actor_id,
                project_id=project_id,
                resource_type=resource_type,
                resource_id=resource_id,
                notification_metadata=metadata,
            )

            db.add(notification)
            await db.commit()
            await db.refresh(notification)

            logger.info(
                "notification_created",
                notification_id=notification.id,
                user_id=user_id,
                type=notification_type.value,
            )

            # Send email if enabled and user preferences allow
            if send_email and preferences.should_send_email(notification_type):
                await notification_email_service.send_notification_email(
                    db, notification, notification_type
                )

            # Broadcast notification via WebSocket
            await self._broadcast_notification(
                user_id,
                notification,
                notification_type,
                title,
                message,
                project_id,
                resource_type,
                resource_id,
                actor_id,
                metadata,
            )

            return notification

        except Exception as e:
            logger.error("notification_creation_failed", error=str(e))
            await db.rollback()
            raise

    async def _broadcast_notification(
        self,
        user_id: UUID,
        notification: Notification,
        notification_type: NotificationType,
        title: str,
        message: str,
        project_id: UUID | None,
        resource_type: str | None,
        resource_id: str | None,
        actor_id: UUID | None,
        metadata: dict[str, Any] | None,
    ) -> None:
        """Broadcast notification via WebSocket."""
        try:
            notification_data = {
                "id": str(notification.id),
                "type": notification_type.value,
                "title": title,
                "message": message,
                "project_id": project_id,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "actor_id": str(actor_id) if actor_id else None,
                "metadata": metadata,
                "created_at": notification.created_at.isoformat() + "Z",
            }
            await connection_manager.broadcast_notification(user_id, notification_data)
            logger.debug(
                "notification_broadcast",
                notification_id=notification.id,
                user_id=user_id,
            )
        except Exception as e:
            logger.error(
                "notification_broadcast_failed",
                error=str(e),
                notification_id=notification.id,
            )

    async def mark_as_read(
        self, db: AsyncSession, notification_id: UUID, user_id: UUID
    ) -> bool:
        """Mark a notification as read."""
        try:
            result = await db.execute(
                select(Notification).filter(
                    and_(
                        Notification.id == notification_id,
                        Notification.user_id == user_id,
                    )
                )
            )
            notification = result.scalar_one_or_none()

            if not notification:
                logger.warning(
                    "notification_not_found",
                    notification_id=notification_id,
                    user_id=user_id,
                )
                return False

            notification.mark_as_read()
            await db.commit()

            logger.info(
                "notification_marked_read",
                notification_id=notification_id,
                user_id=user_id,
            )
            return True

        except Exception as e:
            logger.error("mark_as_read_failed", error=str(e))
            await db.rollback()
            return False

    async def mark_all_as_read(self, db: AsyncSession, user_id: UUID) -> int:
        """Mark all notifications as read for a user."""
        try:
            result = await db.execute(
                select(Notification).filter(
                    and_(
                        Notification.user_id == user_id,
                        Notification.read.is_(False),
                    )
                )
            )
            notifications = result.scalars().all()

            count = 0
            for notification in notifications:
                notification.mark_as_read()
                count += 1

            await db.commit()

            logger.info("all_notifications_marked_read", user_id=user_id, count=count)
            return count

        except Exception as e:
            logger.error("mark_all_as_read_failed", error=str(e))
            await db.rollback()
            return 0

    async def get_unread_count(self, db: AsyncSession, user_id: UUID) -> dict:
        """Get count of unread notifications for a user."""
        try:
            # Total unread count
            result = await db.execute(
                select(func.count(Notification.id)).filter(
                    and_(
                        Notification.user_id == user_id,
                        Notification.read.is_(False),
                    )
                )
            )
            total_count = result.scalar() or 0

            # Count by type
            result = await db.execute(
                select(Notification.type, func.count(Notification.id))
                .filter(
                    and_(
                        Notification.user_id == user_id,
                        Notification.read.is_(False),
                    )
                )
                .group_by(Notification.type)
            )
            by_type = {row[0].value: row[1] for row in result.all()}

            return {"count": total_count, "by_type": by_type}

        except Exception as e:
            logger.error("get_unread_count_failed", error=str(e))
            return {"count": 0, "by_type": {}}

    async def get_notifications(
        self,
        db: AsyncSession,
        user_id: UUID,
        notification_type: str | None = None,
        read: bool | None = None,
        project_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Notification]:
        """Get notifications for a user with filters."""
        try:
            query = select(Notification).filter(Notification.user_id == user_id)

            if notification_type:
                query = query.filter(
                    Notification.type == NotificationType(notification_type)
                )
            if read is not None:
                query = query.filter(Notification.read == read)
            if project_id:
                query = query.filter(Notification.project_id == project_id)

            query = (
                query.order_by(Notification.created_at.desc())
                .limit(limit)
                .offset(offset)
            )

            result = await db.execute(query)
            notifications = result.scalars().all()

            return list(notifications)

        except Exception as e:
            logger.error("get_notifications_failed", error=str(e))
            return []

    async def delete_notification(
        self, db: AsyncSession, notification_id: UUID, user_id: UUID
    ) -> bool:
        """Delete a notification."""
        try:
            result = await db.execute(
                select(Notification).filter(
                    and_(
                        Notification.id == notification_id,
                        Notification.user_id == user_id,
                    )
                )
            )
            notification = result.scalar_one_or_none()

            if not notification:
                logger.warning(
                    "notification_not_found_for_delete",
                    notification_id=notification_id,
                    user_id=user_id,
                )
                return False

            await db.delete(notification)
            await db.commit()

            logger.info(
                "notification_deleted",
                notification_id=notification_id,
                user_id=user_id,
            )
            return True

        except Exception as e:
            logger.error("delete_notification_failed", error=str(e))
            await db.rollback()
            return False

    # ========================================================================
    # Notification Preferences (delegated to preferences service)
    # ========================================================================

    async def get_user_preferences(self, db: AsyncSession, user_id: UUID):
        """Get notification preferences for a user."""
        return await user_preferences_service.get_user_preferences(db, user_id)

    async def update_user_preferences(
        self,
        db: AsyncSession,
        user_id: UUID,
        preferences_data: dict[str, bool],
    ):
        """Update notification preferences for a user."""
        return await user_preferences_service.update_user_preferences(
            db, user_id, preferences_data
        )


# Global instance
notification_service = NotificationService()
