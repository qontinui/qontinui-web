"""Email transport service - handles SMTP email sending."""

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)


class EmailTransportService:
    """Handles SMTP email sending operations."""

    async def send_email(
        self, to_email: str, subject: str, text_body: str, html_body: str | None = None
    ) -> bool:
        """
        Send an email using SMTP.

        Args:
            to_email: Recipient email address
            subject: Email subject line
            text_body: Plain text version of the email
            html_body: HTML version of the email (optional)

        Returns:
            True if email sent successfully, False otherwise
        """
        # Check if email is configured
        if not settings.SMTP_HOST:
            logger.warning("smtp_not_configured", message="SMTP not configured, skipping email send")
            logger.info("would_send_email", to_email=to_email, subject=subject)
            return False

        try:
            logger.info("smtp_send_start", to_email=to_email, subject=subject, smtp_host=settings.SMTP_HOST)
            message = self._create_message(to_email, subject, text_body, html_body)
            await self._send_via_smtp(message)

            logger.info("smtp_send_success", to_email=to_email, subject=subject)
            return True

        except Exception as e:
            import traceback
            logger.error(
                "smtp_send_failed",
                to_email=to_email,
                subject=subject,
                error=str(e),
                error_type=type(e).__name__,
                traceback=traceback.format_exc(),
                smtp_host=settings.SMTP_HOST,
                smtp_port=settings.SMTP_PORT,
            )
            return False

    def _create_message(
        self, to_email: str, subject: str, text_body: str, html_body: str | None
    ) -> MIMEMultipart:
        """
        Create MIME message with text and optional HTML parts.

        Args:
            to_email: Recipient email address
            subject: Email subject
            text_body: Plain text content
            html_body: HTML content (optional)

        Returns:
            Constructed MIME message
        """
        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = settings.SMTP_FROM_EMAIL
        message["To"] = to_email

        # Add plain text part
        text_part = MIMEText(text_body, "plain")
        message.attach(text_part)

        # Add HTML part if provided
        if html_body:
            html_part = MIMEText(html_body, "html")
            message.attach(html_part)

        return message

    async def _send_via_smtp(self, message: MIMEMultipart) -> None:
        """
        Send message via SMTP.

        Args:
            message: MIME message to send

        Raises:
            Exception: If SMTP sending fails
        """
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            start_tls=settings.SMTP_TLS,
            username=settings.SMTP_USER if settings.SMTP_USER else None,
            password=settings.SMTP_PASSWORD if settings.SMTP_PASSWORD else None,
        )
