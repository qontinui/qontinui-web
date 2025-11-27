"""
Notification service for managing collaboration event notifications.

Provides business logic for:
- Creating and sending notifications
- Managing notification preferences
- Email notifications for collaboration events
- In-app notification delivery
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import (
    Notification,
    NotificationPreferences,
    NotificationType,
)
from app.models.project import Project
from app.models.user import User
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService
from app.services.websocket_manager import connection_manager

logger = structlog.get_logger(__name__)


class NotificationService:
    """Service for managing notifications."""

    def __init__(self):
        """Initialize notification service."""
        self.email_transport = EmailTransportService()
        self.email_templates = EmailTemplateService()

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
        project_id: int | None = None,
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
            preferences = await self.get_user_preferences(db, user_id)

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
                await self._send_notification_email(db, notification, notification_type)

            # Broadcast notification via WebSocket
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
                await connection_manager.broadcast_notification(
                    user_id, notification_data
                )
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

            return notification

        except Exception as e:
            logger.error("notification_creation_failed", error=str(e))
            await db.rollback()
            raise

    async def mark_as_read(
        self, db: AsyncSession, notification_id: UUID, user_id: UUID
    ) -> bool:
        """
        Mark a notification as read.

        Args:
            db: Database session
            notification_id: ID of notification to mark
            user_id: ID of user (for authorization)

        Returns:
            True if marked successfully
        """
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
        """
        Mark all notifications as read for a user.

        Args:
            db: Database session
            user_id: ID of user

        Returns:
            Number of notifications marked as read
        """
        try:
            result = await db.execute(
                select(Notification).filter(
                    and_(
                        Notification.user_id == user_id,
                        Notification.read == False,
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
        """
        Get count of unread notifications for a user.

        Args:
            db: Database session
            user_id: ID of user

        Returns:
            Dictionary with total count and count by type
        """
        try:
            # Total unread count
            result = await db.execute(
                select(func.count(Notification.id)).filter(
                    and_(
                        Notification.user_id == user_id,
                        Notification.read == False,
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
                        Notification.read == False,
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
        project_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Notification]:
        """
        Get notifications for a user with filters.

        Args:
            db: Database session
            user_id: ID of user
            notification_type: Filter by notification type
            read: Filter by read status
            project_id: Filter by project
            limit: Maximum number of results
            offset: Offset for pagination

        Returns:
            List of Notification objects
        """
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
        """
        Delete a notification.

        Args:
            db: Database session
            notification_id: ID of notification to delete
            user_id: ID of user (for authorization)

        Returns:
            True if deleted successfully
        """
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
    # Specific Notification Types
    # ========================================================================

    async def send_mention_notification(
        self,
        db: AsyncSession,
        mentioned_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: int,
        project_name: str,
        comment_id: UUID,
        comment_content: str,
        resource_type: str = "comment",
    ) -> Notification | None:
        """
        Send notification when user is mentioned in a comment.

        Args:
            db: Database session
            mentioned_user_id: ID of user being mentioned
            actor_id: ID of user who mentioned
            actor_username: Username of actor
            project_id: ID of project
            project_name: Name of project
            comment_id: ID of comment
            comment_content: Content of comment (truncated)
            resource_type: Type of resource (default: comment)

        Returns:
            Created Notification or None
        """
        # Don't notify users if they mention themselves
        if mentioned_user_id == actor_id:
            return None

        title = f"{actor_username} mentioned you in {project_name}"
        message = f"{actor_username} mentioned you: {comment_content[:100]}..."

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "comment_id": str(comment_id),
            "deep_link": f"/projects/{project_id}/comments/{comment_id}",
        }

        return await self.create_notification(
            db=db,
            user_id=mentioned_user_id,
            notification_type=NotificationType.MENTION,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type=resource_type,
            resource_id=str(comment_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_share_notification(
        self,
        db: AsyncSession,
        shared_with_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: int,
        project_name: str,
        permission_level: str,
    ) -> Notification | None:
        """
        Send notification when project is shared with user.

        Args:
            db: Database session
            shared_with_user_id: ID of user receiving access
            actor_id: ID of user who shared
            actor_username: Username of actor
            project_id: ID of project
            project_name: Name of project
            permission_level: Permission level granted

        Returns:
            Created Notification or None
        """
        title = f"{actor_username} shared {project_name} with you"
        message = f"You now have {permission_level} access to {project_name}"

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "permission_level": permission_level,
            "deep_link": f"/projects/{project_id}",
        }

        return await self.create_notification(
            db=db,
            user_id=shared_with_user_id,
            notification_type=NotificationType.SHARE,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type="project",
            resource_id=str(project_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_comment_notification(
        self,
        db: AsyncSession,
        notify_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: int,
        project_name: str,
        comment_id: UUID,
        comment_content: str,
    ) -> Notification | None:
        """
        Send notification when comment is added to a resource.

        Args:
            db: Database session
            notify_user_id: ID of user to notify
            actor_id: ID of user who commented
            actor_username: Username of actor
            project_id: ID of project
            project_name: Name of project
            comment_id: ID of comment
            comment_content: Content of comment (truncated)

        Returns:
            Created Notification or None
        """
        # Don't notify user of their own comments
        if notify_user_id == actor_id:
            return None

        title = f"{actor_username} commented on {project_name}"
        message = f"{actor_username}: {comment_content[:100]}..."

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "comment_id": str(comment_id),
            "deep_link": f"/projects/{project_id}/comments/{comment_id}",
        }

        return await self.create_notification(
            db=db,
            user_id=notify_user_id,
            notification_type=NotificationType.COMMENT,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type="comment",
            resource_id=str(comment_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_reply_notification(
        self,
        db: AsyncSession,
        notify_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: int,
        project_name: str,
        comment_id: UUID,
        parent_comment_id: UUID,
        reply_content: str,
    ) -> Notification | None:
        """
        Send notification when someone replies to a comment.

        Args:
            db: Database session
            notify_user_id: ID of user to notify (parent comment author)
            actor_id: ID of user who replied
            actor_username: Username of actor
            project_id: ID of project
            project_name: Name of project
            comment_id: ID of reply comment
            parent_comment_id: ID of parent comment
            reply_content: Content of reply (truncated)

        Returns:
            Created Notification or None
        """
        # Don't notify user of their own replies
        if notify_user_id == actor_id:
            return None

        title = f"{actor_username} replied to your comment"
        message = f"{actor_username}: {reply_content[:100]}..."

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "comment_id": str(comment_id),
            "parent_comment_id": str(parent_comment_id),
            "deep_link": f"/projects/{project_id}/comments/{parent_comment_id}",
        }

        return await self.create_notification(
            db=db,
            user_id=notify_user_id,
            notification_type=NotificationType.REPLY,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type="comment",
            resource_id=str(comment_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_lock_released_notification(
        self,
        db: AsyncSession,
        notify_user_id: UUID,
        project_id: int,
        resource_type: str,
        resource_id: str,
        resource_name: str | None = None,
    ) -> Notification | None:
        """
        Send notification when a lock is released.

        Args:
            db: Database session
            notify_user_id: ID of user to notify
            project_id: ID of project
            resource_type: Type of resource
            resource_id: ID of resource
            resource_name: Name of resource

        Returns:
            Created Notification or None
        """
        title = f"Resource available: {resource_name or resource_id}"
        message = f"The {resource_type} is now available for editing"

        metadata = {
            "project_id": project_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "deep_link": f"/projects/{project_id}",
        }

        return await self.create_notification(
            db=db,
            user_id=notify_user_id,
            notification_type=NotificationType.LOCK_RELEASED,
            title=title,
            message=message,
            project_id=project_id,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata=metadata,
            send_email=False,  # Don't send email for lock releases
        )

    # ========================================================================
    # Notification Preferences
    # ========================================================================

    async def get_user_preferences(
        self, db: AsyncSession, user_id: UUID
    ) -> NotificationPreferences:
        """
        Get notification preferences for a user.

        Creates default preferences if none exist.

        Args:
            db: Database session
            user_id: ID of user

        Returns:
            NotificationPreferences object
        """
        try:
            result = await db.execute(
                select(NotificationPreferences).filter(
                    NotificationPreferences.user_id == user_id
                )
            )
            preferences = result.scalar_one_or_none()

            if not preferences:
                # Create default preferences
                preferences = NotificationPreferences.create_default(user_id)
                db.add(preferences)
                await db.commit()
                await db.refresh(preferences)
                logger.info("preferences_created", user_id=user_id)

            return preferences

        except Exception as e:
            logger.error("get_preferences_failed", error=str(e))
            # Return default preferences without saving
            return NotificationPreferences(user_id=user_id)

    async def update_user_preferences(
        self,
        db: AsyncSession,
        user_id: UUID,
        preferences_data: dict[str, bool],
    ) -> NotificationPreferences:
        """
        Update notification preferences for a user.

        Args:
            db: Database session
            user_id: ID of user
            preferences_data: Dictionary of preference updates

        Returns:
            Updated NotificationPreferences object
        """
        try:
            preferences = await self.get_user_preferences(db, user_id)

            # Update fields
            for key, value in preferences_data.items():
                if hasattr(preferences, key):
                    setattr(preferences, key, value)

            preferences.updated_at = datetime.utcnow()  # type: ignore[assignment]
            await db.commit()
            await db.refresh(preferences)

            logger.info("preferences_updated", user_id=user_id)
            return preferences

        except Exception as e:
            logger.error("update_preferences_failed", error=str(e))
            await db.rollback()
            raise

    # ========================================================================
    # Email Notifications
    # ========================================================================

    async def _send_notification_email(
        self,
        db: AsyncSession,
        notification: Notification,
        notification_type: NotificationType,
    ) -> bool:
        """
        Send email for a notification.

        Args:
            db: Database session
            notification: Notification object
            notification_type: Type of notification

        Returns:
            True if email sent successfully
        """
        try:
            # Get user
            result = await db.execute(
                select(User).where(User.id == notification.user_id)  # type: ignore[arg-type]
            )
            user = result.scalar_one_or_none()

            if not user:
                logger.warning("email_user_not_found", user_id=notification.user_id)
                return False

            # Get actor
            actor = None
            if notification.actor_id:
                result = await db.execute(
                    select(User).where(User.id == notification.actor_id)  # type: ignore[arg-type]
                )
                actor = result.scalar_one_or_none()

            # Get project
            project = None
            if notification.project_id:
                result = await db.execute(
                    select(Project).filter(Project.id == notification.project_id)
                )
                project = result.scalar_one_or_none()

            # Build email context
            from app.core.config import settings

            context = {
                "recipient_name": user.full_name or user.username,
                "title": notification.title,
                "message": notification.message,
                "actor_name": (
                    actor.full_name or actor.username if actor else "Someone"
                ),
                "project_name": project.name if project else "a project",
                "notification_url": f"{settings.FRONTEND_URL}{notification.notification_metadata.get('deep_link', '/notifications') if notification.notification_metadata else '/notifications'}",
                "notification_type": notification_type.value,
                "frontend_url": settings.FRONTEND_URL,
            }

            # Render template
            html_body = self.email_templates.render_template("notification", context)

            # Send email
            success = await self.email_transport.send_email(
                to_email=user.email,
                subject=str(notification.title),
                text_body=str(notification.message),
                html_body=html_body,
            )

            if success:
                logger.info(
                    "notification_email_sent",
                    notification_id=notification.id,
                    user_id=user.id,
                )
            else:
                logger.error(
                    "notification_email_failed",
                    notification_id=notification.id,
                    user_id=user.id,
                )

            return success

        except Exception as e:
            logger.error("send_notification_email_failed", error=str(e))
            return False


# Global instance
notification_service = NotificationService()
