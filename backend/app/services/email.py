"""
Email service - facade for email operations.

This module provides backwards-compatible email service using the new
refactored architecture with separated concerns:
- EmailTransportService: SMTP sending
- EmailTemplateService: Template rendering
- Email Composers: Type-specific email composition
"""

import structlog
from app.models.user import User
from app.services.email.email_composers import (
    BetaWelcomeEmailComposer, EmailVerificationComposer,
    PasswordResetEmailComposer, ResendVerificationEmailComposer)
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService

logger = structlog.get_logger(__name__)


class EmailService:
    """
    Email service facade providing backwards-compatible interface.

    Uses composition with separated services for transport, templates, and composers.
    """

    def __init__(self):
        """Initialize email service with its dependencies."""
        self.transport = EmailTransportService()
        self.templates = EmailTemplateService()

        # Initialize composers with dependencies
        self.beta_welcome_composer = BetaWelcomeEmailComposer(
            self.templates, self.transport
        )
        self.password_reset_composer = PasswordResetEmailComposer(
            self.templates, self.transport
        )
        self.email_verification_composer = EmailVerificationComposer(
            self.templates, self.transport
        )
        self.resend_verification_composer = ResendVerificationEmailComposer(
            self.templates, self.transport
        )

    async def send_email(
        self, to_email: str, subject: str, body: str, html_body: str | None = None
    ) -> bool:
        """
        Send an email using SMTP (backwards-compatible method).

        Args:
            to_email: Recipient email address
            subject: Email subject
            body: Plain text body
            html_body: HTML body (optional)

        Returns:
            True if email sent successfully
        """
        return await self.transport.send_email(
            to_email=to_email,
            subject=subject,
            text_body=body,
            html_body=html_body,
        )

    async def send_beta_welcome_email(
        self, to_email: str, username: str, temp_password: str
    ) -> bool:
        """
        Send welcome email to beta users.

        Args:
            to_email: Recipient email
            username: User's username
            temp_password: Temporary password

        Returns:
            True if email sent successfully
        """
        # Create a minimal User object for the composer
        user = User(email=to_email, username=username)
        return await self.beta_welcome_composer.send(user, temp_password)

    async def send_password_reset_email(
        self, to_email: str, username: str, reset_token: str
    ) -> bool:
        """
        Send password reset email.

        Args:
            to_email: Recipient email
            username: User's username
            reset_token: Password reset token

        Returns:
            True if email sent successfully
        """
        user = User(email=to_email, username=username)
        return await self.password_reset_composer.send(user, reset_token)

    async def send_verification_email(
        self, to_email: str, username: str, verification_token: str
    ) -> bool:
        """
        Send email verification email.

        Args:
            to_email: Recipient email
            username: User's username
            verification_token: Verification token

        Returns:
            True if email sent successfully
        """
        user = User(email=to_email, username=username)
        return await self.email_verification_composer.send(user, verification_token)

    async def send_resend_verification_email(
        self, to_email: str, username: str, verification_token: str
    ) -> bool:
        """
        Send resend verification email.

        Args:
            to_email: Recipient email
            username: User's username
            verification_token: Verification token

        Returns:
            True if email sent successfully
        """
        user = User(email=to_email, username=username)
        return await self.resend_verification_composer.send(user, verification_token)


# Create singleton instance (backwards compatibility)
email_service = EmailService()
