"""
Admin notification service for sending email notifications to admins.

Handles:
- User signup notifications
- Project creation notifications
- Managing admin notification settings
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.admin_notification_settings import AdminNotificationSettings
from app.models.user import User
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService

logger = structlog.get_logger(__name__)


class AdminNotificationService:
    """Service for managing admin notifications."""

    def __init__(self):
        """Initialize admin notification service."""
        self.email_transport = EmailTransportService()
        self.email_templates = EmailTemplateService()

    # ========================================================================
    # Settings Management
    # ========================================================================

    async def get_settings(self, db: AsyncSession) -> AdminNotificationSettings | None:
        """
        Get admin notification settings.

        Returns None if settings don't exist yet.

        Args:
            db: Database session

        Returns:
            AdminNotificationSettings or None
        """
        try:
            result = await db.execute(select(AdminNotificationSettings).limit(1))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error("get_admin_notification_settings_failed", error=str(e))
            return None

    async def get_or_create_settings(
        self, db: AsyncSession, default_email: str | None = None
    ) -> AdminNotificationSettings:
        """
        Get existing settings or create default settings.

        Args:
            db: Database session
            default_email: Email to use if creating new settings

        Returns:
            AdminNotificationSettings
        """
        settings_obj = await self.get_settings(db)
        if settings_obj:
            return settings_obj

        # Create default settings
        # Use provided email or fall back to a first superuser's email
        if not default_email:
            result = await db.execute(
                select(User).filter(User.is_superuser).limit(1)  # type: ignore[arg-type]
            )
            superuser = result.scalar_one_or_none()
            if superuser:
                default_email = superuser.email
            else:
                # Fallback - shouldn't happen in production
                default_email = "admin@qontinui.io"

        settings_obj = AdminNotificationSettings(
            notification_email=default_email,
            notify_on_user_signup=True,
            notify_on_project_created=True,
            notifications_enabled=True,
        )

        db.add(settings_obj)
        await db.commit()
        await db.refresh(settings_obj)

        logger.info(
            "admin_notification_settings_created",
            email=default_email,
        )

        return settings_obj

    async def update_settings(
        self,
        db: AsyncSession,
        updates: dict[str, Any],
    ) -> AdminNotificationSettings:
        """
        Update admin notification settings.

        Args:
            db: Database session
            updates: Dictionary of fields to update

        Returns:
            Updated AdminNotificationSettings
        """
        settings_obj = await self.get_or_create_settings(db)

        for key, value in updates.items():
            if value is not None and hasattr(settings_obj, key):
                setattr(settings_obj, key, value)

        await db.commit()
        await db.refresh(settings_obj)

        logger.info(
            "admin_notification_settings_updated",
            updates=list(updates.keys()),
        )

        return settings_obj

    # ========================================================================
    # Notification Sending
    # ========================================================================

    async def notify_user_signup(
        self,
        db: AsyncSession,
        user_email: str,
        username: str,
        user_id: UUID,
    ) -> bool:
        """
        Send notification email when a new user signs up.

        Args:
            db: Database session
            user_email: Email of the new user
            username: Username of the new user
            user_id: ID of the new user

        Returns:
            True if notification was sent successfully
        """
        try:
            settings_obj = await self.get_settings(db)

            if not settings_obj:
                logger.debug("admin_notification_no_settings")
                return False

            if not settings_obj.notifications_enabled:
                logger.debug("admin_notifications_disabled")
                return False

            if not settings_obj.notify_on_user_signup:
                logger.debug("user_signup_notification_disabled")
                return False

            # Build email content
            subject = f"New User Signup: {username}"

            context = {
                "event_type": "User Signup",
                "title": f"New User: {username}",
                "user_email": user_email,
                "username": username,
                "user_id": str(user_id),
                "admin_url": f"{settings.FRONTEND_URL}/admin?tab=users",
                "frontend_url": settings.FRONTEND_URL,
            }

            # Try to render template, fall back to plain text
            try:
                html_body = self.email_templates.render_template(
                    "admin_notification", context
                )
            except Exception:
                html_body = None

            text_body = (
                f"New user signed up!\n\n"
                f"Username: {username}\n"
                f"Email: {user_email}\n"
                f"User ID: {user_id}\n\n"
                f"View in admin: {settings.FRONTEND_URL}/admin?tab=users"
            )

            success = await self.email_transport.send_email(
                to_email=settings_obj.notification_email,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
            )

            if success:
                logger.info(
                    "admin_user_signup_notification_sent",
                    to_email=settings_obj.notification_email,
                    new_user=username,
                )
            else:
                logger.error(
                    "admin_user_signup_notification_failed",
                    to_email=settings_obj.notification_email,
                    new_user=username,
                )

            return success

        except Exception as e:
            logger.error(
                "admin_user_signup_notification_error",
                error=str(e),
                user_email=user_email,
            )
            return False

    async def notify_project_created(
        self,
        db: AsyncSession,
        project_name: str,
        project_id: UUID,
        owner_email: str,
        owner_username: str,
        owner_id: UUID,
    ) -> bool:
        """
        Send notification email when a new project is created.

        Args:
            db: Database session
            project_name: Name of the new project
            project_id: ID of the new project
            owner_email: Email of the project owner
            owner_username: Username of the project owner
            owner_id: ID of the project owner

        Returns:
            True if notification was sent successfully
        """
        try:
            settings_obj = await self.get_settings(db)

            if not settings_obj:
                logger.debug("admin_notification_no_settings")
                return False

            if not settings_obj.notifications_enabled:
                logger.debug("admin_notifications_disabled")
                return False

            if not settings_obj.notify_on_project_created:
                logger.debug("project_created_notification_disabled")
                return False

            # Build email content
            subject = f"New Project Created: {project_name}"

            context = {
                "event_type": "Project Created",
                "title": f"New Project: {project_name}",
                "project_name": project_name,
                "project_id": str(project_id),
                "owner_email": owner_email,
                "owner_username": owner_username,
                "owner_id": str(owner_id),
                "admin_url": f"{settings.FRONTEND_URL}/admin?tab=projects",
                "frontend_url": settings.FRONTEND_URL,
            }

            # Try to render template, fall back to plain text
            try:
                html_body = self.email_templates.render_template(
                    "admin_notification", context
                )
            except Exception:
                html_body = None

            text_body = (
                f"New project created!\n\n"
                f"Project: {project_name}\n"
                f"Project ID: {project_id}\n"
                f"Owner: {owner_username} ({owner_email})\n\n"
                f"View in admin: {settings.FRONTEND_URL}/admin?tab=projects"
            )

            success = await self.email_transport.send_email(
                to_email=settings_obj.notification_email,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
            )

            if success:
                logger.info(
                    "admin_project_created_notification_sent",
                    to_email=settings_obj.notification_email,
                    project_name=project_name,
                    owner=owner_username,
                )
            else:
                logger.error(
                    "admin_project_created_notification_failed",
                    to_email=settings_obj.notification_email,
                    project_name=project_name,
                )

            return success

        except Exception as e:
            logger.error(
                "admin_project_created_notification_error",
                error=str(e),
                project_name=project_name,
            )
            return False


# Global instance
admin_notification_service = AdminNotificationService()
