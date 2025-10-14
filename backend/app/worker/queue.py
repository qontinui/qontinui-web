"""Convenient wrapper for enqueuing background tasks."""

import logging
from typing import Any

from app.worker.arq_pool import enqueue_task

logger = logging.getLogger(__name__)


class TaskQueue:
    """Helper class for enqueuing background tasks."""

    @staticmethod
    async def send_email(
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str | None = None,
    ) -> str | None:
        """
        Send an email in the background.

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML email body
            text_content: Plain text email body (optional)

        Returns:
            Job ID if enqueued successfully, None otherwise
        """
        return await enqueue_task(
            "send_email_task",
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
        )

    @staticmethod
    async def send_verification_email(
        to_email: str,
        username: str,
        verification_token: str,
    ) -> str | None:
        """
        Send email verification in the background.

        Args:
            to_email: Recipient email address
            username: User's username
            verification_token: Verification token

        Returns:
            Job ID if enqueued successfully, None otherwise
        """
        return await enqueue_task(
            "send_verification_email_task",
            to_email=to_email,
            username=username,
            verification_token=verification_token,
        )

    @staticmethod
    async def send_password_reset_email(
        to_email: str,
        username: str,
        reset_token: str,
    ) -> str | None:
        """
        Send password reset email in the background.

        Args:
            to_email: Recipient email address
            username: User's username
            reset_token: Password reset token

        Returns:
            Job ID if enqueued successfully, None otherwise
        """
        return await enqueue_task(
            "send_password_reset_email_task",
            to_email=to_email,
            username=username,
            reset_token=reset_token,
        )

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
        user_id: int,
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
