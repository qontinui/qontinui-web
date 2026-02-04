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

        html_body = self.template_service.render_template("beta_welcome", context)

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="🎉 Welcome to Qontinui Beta!",
            text_body="",
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

        html_body = self.template_service.render_template("password_reset", context)

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Password Reset Request",
            text_body="",
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

        html_body = self.template_service.render_template("email_verification", context)

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Verify Your Email Address",
            text_body="",
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

        html_body = self.template_service.render_template(
            "resend_verification", context
        )

        return await self.transport_service.send_email(
            to_email=user.email,
            subject="Qontinui - Verify Your Email Address",
            text_body="",
            html_body=html_body,
        )


class FeedbackEmailComposer(BaseEmailComposer):
    """Composes and sends feedback emails."""

    async def send(
        self,
        name: str,
        email: str,
        message: str,
        page_url: str | None = None,
    ) -> bool:
        """
        Send feedback email to admin.

        Args:
            name: User's name
            email: User's email address
            message: Feedback message
            page_url: URL where feedback was submitted (optional)

        Returns:
            True if email sent successfully
        """
        # Create email body without template
        text_body = f"""
New Feedback Received from Qontinui Beta

Name: {name}
Email: {email}
Page: {page_url or "Not provided"}

Message:
{message}

---
This feedback was submitted through the Qontinui Beta feedback form.
"""

        html_body = f"""
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <h2 style="color: #6366f1;">New Feedback Received from Qontinui Beta</h2>

    <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Name:</strong> {name}</p>
        <p><strong>Email:</strong> <a href="mailto:{email}">{email}</a></p>
        <p><strong>Page:</strong> {page_url or "Not provided"}</p>
    </div>

    <div style="margin: 20px 0;">
        <p><strong>Message:</strong></p>
        <div style="background-color: #fff; border-left: 4px solid #6366f1; padding: 15px; margin: 10px 0;">
            {message.replace("\n", "<br>")}
        </div>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    <p style="color: #6b7280; font-size: 14px;">
        This feedback was submitted through the Qontinui Beta feedback form.
    </p>
</body>
</html>
"""

        return await self.transport_service.send_email(
            to_email="jspinak@hotmail.com",
            subject=f"Qontinui Beta Feedback from {name}",
            text_body=text_body,
            html_body=html_body,
        )
