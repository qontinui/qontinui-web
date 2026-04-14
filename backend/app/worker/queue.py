"""Convenient wrapper for enqueuing background tasks."""

from typing import Any
from uuid import UUID

import structlog
from app.worker.arq_pool import enqueue_task

logger = structlog.get_logger(__name__)


class TaskQueue:
    """Helper class for enqueuing background tasks with fallback to sync execution."""

    @staticmethod
    async def send_email(
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str | None = None,
    ) -> str | None:
        """
        Send an email in the background, or synchronously if queue unavailable.

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML email body
            text_content: Plain text email body (optional)

        Returns:
            Job ID if enqueued successfully, "sync" if sent synchronously, None on error
        """
        job_id = await enqueue_task(
            "send_email_task",
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
        )

        # Fallback to synchronous email sending if queue unavailable
        if job_id is None:
            try:
                from app.services.email.email_transport_service import \
                    EmailTransportService

                logger.info(
                    "email_sent_synchronously",
                    to_email=to_email,
                    reason="queue_unavailable",
                )
                transport = EmailTransportService()
                # Use html_content as text_body if text_content is None
                text_body_content = (
                    text_content if text_content is not None else html_content
                )
                await transport.send_email(
                    to_email=to_email,
                    subject=subject,
                    html_body=html_content,
                    text_body=text_body_content,
                )
                return "sync"
            except Exception as e:
                logger.error(
                    "email_send_failed",
                    to_email=to_email,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                return None

        return job_id

    @staticmethod
    async def send_verification_email(
        to_email: str,
        username: str,
        verification_token: str,
    ) -> str | None:
        """
        Send email verification in the background, or synchronously if queue unavailable.

        Args:
            to_email: Recipient email address
            username: User's username
            verification_token: Verification token

        Returns:
            Job ID if enqueued successfully, "sync" if sent synchronously, None on error
        """
        job_id = await enqueue_task(
            "send_verification_email_task",
            to_email=to_email,
            username=username,
            verification_token=verification_token,
        )

        # Fallback to synchronous execution
        if job_id is None:
            try:
                from app.core.config import settings
                from app.services.email.email_template_service import \
                    EmailTemplateService
                from app.services.email.email_transport_service import \
                    EmailTransportService

                logger.info(
                    "verification_email_sent_synchronously",
                    to_email=to_email,
                    reason="queue_unavailable",
                )

                verify_url = (
                    f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"
                )
                context = {"username": username, "verify_url": verify_url}

                template_service = EmailTemplateService()
                html_body = template_service.render_template(
                    "email_verification", context
                )
                # Render text template separately
                text_template = template_service.env.get_template(
                    "email_verification.txt"
                )
                text_body = text_template.render(**context)

                transport = EmailTransportService()
                await transport.send_email(
                    to_email=to_email,
                    subject="Qontinui - Verify Your Email Address",
                    html_body=html_body,
                    text_body=text_body,
                )
                return "sync"
            except Exception as e:
                logger.error(
                    "verification_email_failed",
                    to_email=to_email,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                return None

        return job_id

    @staticmethod
    async def send_password_reset_email(
        to_email: str,
        username: str,
        reset_token: str,
    ) -> str | None:
        """
        Send password reset email in the background, or synchronously if queue unavailable.

        Args:
            to_email: Recipient email address
            username: User's username
            reset_token: Password reset token

        Returns:
            Job ID if enqueued successfully, "sync" if sent synchronously, None on error
        """
        job_id = await enqueue_task(
            "send_password_reset_email_task",
            to_email=to_email,
            username=username,
            reset_token=reset_token,
        )

        # Fallback to synchronous execution
        if job_id is None:
            try:
                from app.core.config import settings
                from app.services.email.email_template_service import \
                    EmailTemplateService
                from app.services.email.email_transport_service import \
                    EmailTransportService

                logger.info(
                    "password_reset_email_sent_synchronously",
                    to_email=to_email,
                    reason="queue_unavailable",
                )

                reset_url = (
                    f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
                )
                context = {"username": username, "reset_url": reset_url}

                template_service = EmailTemplateService()
                html_body = template_service.render_template("password_reset", context)
                # Render text template separately
                text_template = template_service.env.get_template("password_reset.txt")
                text_body = text_template.render(**context)

                transport = EmailTransportService()
                await transport.send_email(
                    to_email=to_email,
                    subject="Qontinui - Password Reset Request",
                    html_body=html_body,
                    text_body=text_body,
                )
                return "sync"
            except Exception as e:
                logger.error(
                    "password_reset_email_failed",
                    to_email=to_email,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                return None

        return job_id

    @staticmethod
    async def process_image(
        image_path: str,
        operation: str,
        **kwargs: Any,
    ) -> str | None:
        """
        Process an image in the background.

        Args:
            image_path: Path to the image file
            operation: Operation to perform (e.g., 'remove_background', 'resize')
            **kwargs: Additional operation-specific parameters

        Returns:
            Job ID if enqueued successfully, None otherwise
        """
        return await enqueue_task(
            "process_image_task",
            image_path=image_path,
            operation=operation,
            **kwargs,
        )

    @staticmethod
    async def send_analytics_report(
        user_id: UUID,
        report_type: str,
    ) -> str | None:
        """
        Generate and send analytics report.

        Args:
            user_id: User ID to generate report for
            report_type: Type of report (daily, weekly, monthly)

        Returns:
            Job ID if enqueued successfully, None otherwise
        """
        return await enqueue_task(
            "send_analytics_report_task",
            user_id=user_id,
            report_type=report_type,
        )


# Singleton instance
task_queue = TaskQueue()
