"""Email transport service - handles AWS SES API and SMTP email sending."""

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib
import boto3
import structlog
from app.core.config import settings
from botocore.exceptions import BotoCoreError, ClientError

logger = structlog.get_logger(__name__)


class EmailTransportService:
    """Handles email sending via AWS SES API or SMTP fallback."""

    def __init__(self):
        """Initialize the email transport service."""
        self.ses_client = None
        if settings.USE_SES_API:
            try:
                # Initialize boto3 SES client (will use IAM role in AWS, env vars locally)
                self.ses_client = boto3.client("ses", region_name=settings.AWS_REGION)
                logger.info(
                    "ses_client_initialized",
                    region=settings.AWS_REGION,
                    use_ses_api=True,
                )
            except Exception as e:
                logger.warning(
                    "ses_client_init_failed",
                    error=str(e),
                    error_type=type(e).__name__,
                    message="Will fallback to SMTP if available",
                )

    async def send_email(
        self, to_email: str, subject: str, text_body: str, html_body: str | None = None
    ) -> bool:
        """
        Send an email using AWS SES API (preferred) or SMTP (fallback).

        Args:
            to_email: Recipient email address
            subject: Email subject line
            text_body: Plain text version of the email
            html_body: HTML version of the email (optional)

        Returns:
            True if email sent successfully, False otherwise
        """
        # Try SES API first (preferred method)
        if settings.USE_SES_API and self.ses_client:
            try:
                return await self._send_via_ses_api(
                    to_email, subject, text_body, html_body
                )
            except Exception as e:
                logger.warning(
                    "ses_api_failed_trying_smtp",
                    to_email=to_email,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                # Continue to SMTP fallback

        # Fallback to SMTP if SES API not available or failed
        if settings.SMTP_HOST:
            try:
                return await self._send_via_smtp(
                    to_email, subject, text_body, html_body
                )
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

        # No email transport configured
        logger.warning(
            "no_email_transport_configured",
            message="Neither SES API nor SMTP configured, skipping email send",
        )
        logger.info("would_send_email", to_email=to_email, subject=subject)
        return False

    async def _send_via_ses_api(
        self, to_email: str, subject: str, text_body: str, html_body: str | None
    ) -> bool:
        """
        Send email using AWS SES API (boto3).

        Args:
            to_email: Recipient email address
            subject: Email subject
            text_body: Plain text content
            html_body: HTML content (optional)

        Returns:
            True if sent successfully

        Raises:
            Exception: If SES API call fails
        """
        logger.info(
            "ses_api_send_start",
            to_email=to_email,
            subject=subject,
            region=settings.AWS_REGION,
        )

        # Build the email body
        body = {"Text": {"Charset": "UTF-8", "Data": text_body}}
        if html_body:
            body["Html"] = {"Charset": "UTF-8", "Data": html_body}

        try:
            # Send via SES API
            response = self.ses_client.send_email(
                Source=settings.SMTP_FROM_EMAIL,
                Destination={"ToAddresses": [to_email]},
                Message={
                    "Subject": {"Charset": "UTF-8", "Data": subject},
                    "Body": body,
                },
            )

            logger.info(
                "ses_api_send_success",
                to_email=to_email,
                subject=subject,
                message_id=response.get("MessageId"),
            )
            return True

        except (BotoCoreError, ClientError) as e:
            logger.error(
                "ses_api_send_failed",
                to_email=to_email,
                subject=subject,
                error=str(e),
                error_type=type(e).__name__,
                region=settings.AWS_REGION,
            )
            raise

    async def _send_via_smtp(
        self, to_email: str, subject: str, text_body: str, html_body: str | None
    ) -> bool:
        """
        Send email using SMTP.

        Args:
            to_email: Recipient email address
            subject: Email subject
            text_body: Plain text content
            html_body: HTML content (optional)

        Returns:
            True if sent successfully

        Raises:
            Exception: If SMTP sending fails
        """
        logger.info(
            "smtp_send_start",
            to_email=to_email,
            subject=subject,
            smtp_host=settings.SMTP_HOST,
        )

        message = self._create_message(to_email, subject, text_body, html_body)

        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            start_tls=settings.SMTP_TLS,
            username=settings.SMTP_USER if settings.SMTP_USER else None,
            password=settings.SMTP_PASSWORD if settings.SMTP_PASSWORD else None,
        )

        logger.info("smtp_send_success", to_email=to_email, subject=subject)
        return True

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
