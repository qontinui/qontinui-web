"""Email transport service - handles AWS SES API and SMTP email sending."""

import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib
import boto3
import structlog
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = structlog.get_logger(__name__)

#: Connect/read timeouts, in seconds, for the SES client.
SES_CONNECT_TIMEOUT = 5
SES_READ_TIMEOUT = 10

#: Retry budget. NOTE the units: botocore's ``retries.max_attempts`` counts
#: RETRIES, not total attempts — it normalizes ``max_attempts: 2`` to
#: ``total_max_attempts: 3`` (1 initial + 2 retries). Measured against
#: botocore 1.43.14.
SES_MAX_RETRIES = 2

#: Ceiling for the SMTP FALLBACK leg, in seconds.
#:
#: ``aiosmtplib.send`` defaults to 60s and was previously called with no
#: timeout at all. That leg is not an alternative to the SES budget below —
#: it runs only AFTER SES has already failed, so on any deployment with
#: ``SMTP_HOST`` set the two add up inside one request. See
#: :func:`_ses_client_config` for the combined figure.
SMTP_TIMEOUT = 15


def _ses_client_config() -> BotoConfig:
    """A FRESH bounded config for one SES client.

    Without it botocore's defaults apply — a 60s connect timeout, a 60s read
    timeout and 5 total attempts — so a single unreachable SES endpoint can
    hold a request for minutes. That matters more here than for a typical
    client because the send is awaited INSIDE a request that cannot answer
    until it finishes (the member-added notice reports the send's outcome to
    its caller), so this bound is the only thing that makes the worst case
    finite.

    **The whole-request bound is NOT the SES figure alone.** ``send_email``
    falls through to SMTP when SES raises, so on a deployment with
    ``SMTP_HOST`` set the two legs add up in one request:

    * SES: ``3 × (5 + 10)`` = 45s plus retry backoff, then
    * SMTP: :data:`SMTP_TIMEOUT` = 15s,

    so roughly **60s plus backoff**, awaited after both coord writes have
    already committed. With ``aiosmtplib``'s own 60s default and no explicit
    timeout — the state before :data:`SMTP_TIMEOUT` was introduced — it was
    about 105s, which is past the point where an upstream idle timeout shows
    the operator a 504 for a grant that succeeded.

    A timeout wrapper around the call is NOT a substitute: these numbers
    bound the socket, whereas ``asyncio.wait_for`` cannot interrupt a
    synchronous boto3 call that is already blocking a thread.

    **Why a factory rather than a module-level constant.** Client
    construction MUTATES the config it is handed — after
    ``boto3.client(..., config=cfg)`` the same object reads
    ``{'mode': 'standard', 'total_max_attempts': 3}``, its ``max_attempts``
    key gone. Sharing one instance across clients therefore makes the
    object's observed contents depend on whether a client has been built
    yet, which is exactly the kind of order-dependent state that turns up
    later as a test that passes alone and fails in a suite.
    """
    return BotoConfig(
        connect_timeout=SES_CONNECT_TIMEOUT,
        read_timeout=SES_READ_TIMEOUT,
        retries={"max_attempts": SES_MAX_RETRIES, "mode": "standard"},
    )


class EmailTransportService:
    """Handles email sending via AWS SES API or SMTP fallback."""

    def __init__(self):
        """Initialize the email transport service."""
        self.ses_client = None
        if settings.USE_SES_API:
            try:
                # Initialize boto3 SES client (will use IAM role in AWS, env vars locally)
                self.ses_client = boto3.client(
                    "ses",
                    region_name=settings.AWS_REGION,
                    config=_ses_client_config(),
                )
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
            # Send via SES API.
            #
            # `self.ses_client.send_email` is SYNCHRONOUS boto3 — an HTTPS
            # round-trip to AWS. Calling it directly from this `async def`
            # blocks the event loop, and therefore every other request this
            # uvicorn worker is serving, for the duration of the call. The
            # thread hand-off is what keeps the blocking confined to one
            # worker thread; the timeouts from `_ses_client_config` are what
            # keep that thread's wait bounded. Both are required: a blocked
            # loop cannot fire its own timer, so no `asyncio.wait_for` around
            # this call could have rescued it.
            #
            # `asyncio.to_thread` is the same mechanism the tenant-member
            # route already uses for the equally-synchronous Cognito calls
            # (`asyncio.to_thread(cognito_admin.resolve_identity_for_email, …)`).
            #
            # `send_email` is the SES action the web task role is granted;
            # `SendRawEmail` is not, so this must never become `send_raw_email`.
            response = await asyncio.to_thread(
                self.ses_client.send_email,  # type: ignore[union-attr]
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
            # aiosmtplib's default is 60s, and this leg runs AFTER the SES
            # leg has already failed — so on a deployment with an SMTP host
            # configured it lands on top of the SES budget, inside a request
            # that has already committed both coord writes. Without this the
            # combined worst case is long enough for an upstream idle
            # timeout to show the operator a 504 for a grant that succeeded.
            timeout=SMTP_TIMEOUT,
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
