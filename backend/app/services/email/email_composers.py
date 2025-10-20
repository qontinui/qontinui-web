"""Email composer classes - handle specific email types."""

import structlog

from app.core.config import settings
from app.models.user import User
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService

logger = structlog.get_logger(__name__)


class BaseEmailComposer:
    """Base class for email composers."""

    def __init__(
        self,
        template_service: EmailTemplateService,
        transport_service: EmailTransportService,
    ):
        """
        Initialize the composer.

        Args:
            template_service: Service for rendering templates
            transport_service: Service for sending emails
        """
        self.template_service = template_service
        self.transport_service = transport_service


class BetaWelcomeEmailComposer(BaseEmailComposer):
    """Composes and sends beta welcome emails."""

    async def send(self, user: User, temp_password: str) -> bool:
        """
        Send beta welcome email to a new user.

        Args:
            user: User model instance
            temp_password: Temporary password generated for the user

        Returns:
            True if email sent successfully
        """
        context = {
            "username": user.username,
            "temp_password": temp_password,
            "login_url": f"{settings.FRONTEND_URL}/login",
        }

        html_body, text_body = self.template_service.render_template(
            "beta_welcome", context
        )

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="🎉 Welcome to Qontinui Beta!",
            text_body=text_body,
            html_body=html_body,
        )


class PasswordResetEmailComposer(BaseEmailComposer):
    """Composes and sends password reset emails."""

    async def send(self, user: User, reset_token: str) -> bool:
        """
        Send password reset email.

        Args:
            user: User model instance
            reset_token: Password reset token

        Returns:
            True if email sent successfully
        """
        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"

        context = {
            "username": user.username,
            "reset_url": reset_url,
        }

        html_body, text_body = self.template_service.render_template(
            "password_reset", context
        )

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Password Reset Request",
            text_body=text_body,
            html_body=html_body,
        )


class EmailVerificationComposer(BaseEmailComposer):
    """Composes and sends email verification emails."""

    async def send(self, user: User, verification_token: str) -> bool:
        """
        Send email verification email.

        Args:
            user: User model instance
            verification_token: Email verification token

        Returns:
            True if email sent successfully
        """
        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"

        context = {
            "username": user.username,
            "verify_url": verify_url,
        }

        html_body, text_body = self.template_service.render_template(
            "email_verification", context
        )

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Verify Your Email Address",
            text_body=text_body,
            html_body=html_body,
        )


class ResendVerificationEmailComposer(BaseEmailComposer):
    """Composes and sends resend verification emails."""

    async def send(self, user: User, verification_token: str) -> bool:
        """
        Send resend verification email.

        Args:
            user: User model instance
            verification_token: Email verification token

        Returns:
            True if email sent successfully
        """
        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"

        context = {
            "username": user.username,
            "verify_url": verify_url,
        }

        html_body, text_body = self.template_service.render_template(
            "resend_verification", context
        )

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Verify Your Email Address",
            text_body=text_body,
            html_body=html_body,
        )
