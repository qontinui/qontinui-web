"""
Email notification delivery.

Provides utilities for sending notification emails using templates.
"""

import structlog
from app.models.notification import Notification, NotificationType
from app.models.project import Project
from app.models.user import User
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class NotificationEmailService:
    """Service for sending notification emails."""

    def __init__(self):
        """Initialize email service."""
        self.email_transport = EmailTransportService()
        self.email_templates = EmailTemplateService()

    async def send_notification_email(
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
notification_email_service = NotificationEmailService()
