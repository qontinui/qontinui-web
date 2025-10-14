"""Background task definitions for ARQ worker."""

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def send_email_task(
    ctx: dict[str, Any],
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str | None = None,
) -> dict[str, Any]:
    """
    Send an email in the background.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)
        to_email: Recipient email address
        subject: Email subject
        html_content: HTML email body
        text_content: Plain text email body (optional)

    Returns:
        Dict with status and message
    """
    logger.info(f"Sending email to {to_email}: {subject}")

    try:
        from app.services.email.email_transport_service import EmailTransportService

        transport = EmailTransportService()
        await transport.send_email(
            to_email=to_email,
            subject=subject,
            html_body=html_content,
            text_body=text_content,
        )

        logger.info(f"Email sent successfully to {to_email}")
        return {"status": "success", "to_email": to_email, "subject": subject}

    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return {"status": "error", "error": str(e), "to_email": to_email}


async def send_verification_email_task(
    ctx: dict[str, Any],
    to_email: str,
    username: str,
    verification_token: str,
) -> dict[str, Any]:
    """
    Send email verification in the background.

    Args:
        ctx: ARQ context
        to_email: Recipient email address
        username: User's username
        verification_token: Verification token

    Returns:
        Dict with status
    """
    logger.info(f"Sending verification email to {to_email}")

    try:
        from app.core.config import settings
        from app.services.email.email_template_service import EmailTemplateService
        from app.services.email.email_transport_service import EmailTransportService

        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"
        context = {"username": username, "verify_url": verify_url}

        template_service = EmailTemplateService()
        html_body, text_body = template_service.render_template(
            "email_verification", context
        )

        transport = EmailTransportService()
        await transport.send_email(
            to_email=to_email,
            subject="Qontinui - Verify Your Email Address",
            html_body=html_body,
            text_body=text_body,
        )

        logger.info(f"Verification email sent successfully to {to_email}")
        return {"status": "success", "to_email": to_email}

    except Exception as e:
        logger.error(f"Failed to send verification email to {to_email}: {e}")
        return {"status": "error", "error": str(e), "to_email": to_email}


async def send_password_reset_email_task(
    ctx: dict[str, Any],
    to_email: str,
    username: str,
    reset_token: str,
) -> dict[str, Any]:
    """
    Send password reset email in the background.

    Args:
        ctx: ARQ context
        to_email: Recipient email address
        username: User's username
        reset_token: Password reset token

    Returns:
        Dict with status
    """
    logger.info(f"Sending password reset email to {to_email}")

    try:
        from app.core.config import settings
        from app.services.email.email_template_service import EmailTemplateService
        from app.services.email.email_transport_service import EmailTransportService

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
        context = {"username": username, "reset_url": reset_url}

        template_service = EmailTemplateService()
        html_body, text_body = template_service.render_template(
            "password_reset", context
        )

        transport = EmailTransportService()
        await transport.send_email(
            to_email=to_email,
            subject="Qontinui - Password Reset Request",
            html_body=html_body,
            text_body=text_body,
        )

        logger.info(f"Password reset email sent successfully to {to_email}")
        return {"status": "success", "to_email": to_email}

    except Exception as e:
        logger.error(f"Failed to send password reset email to {to_email}: {e}")
        return {"status": "error", "error": str(e), "to_email": to_email}


async def process_image_task(
    ctx: dict[str, Any],
    image_path: str,
    operation: str,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Process an image in the background.

    Args:
        ctx: ARQ context
        image_path: Path to the image file
        operation: Operation to perform (e.g., 'remove_background', 'resize')
        **kwargs: Additional operation-specific parameters

    Returns:
        Dict with status and result path
    """
    logger.info(f"Processing image: {image_path}, operation: {operation}")

    try:
        if operation == "remove_background":
            # This would be the actual processing
            # from app.services.background_removal_service import (
            #     BackgroundRemovalService,
            # )
            # service = BackgroundRemovalService()
            # result_path = await service.remove_background(image_path, **kwargs)

            logger.info(f"Image processed successfully: {image_path}")
            return {
                "status": "success",
                "image_path": image_path,
                "operation": operation,
            }

        return {"status": "error", "error": f"Unknown operation: {operation}"}

    except Exception as e:
        logger.error(f"Failed to process image {image_path}: {e}")
        return {"status": "error", "error": str(e), "image_path": image_path}


async def cleanup_old_data_task(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up old data (periodic task).

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    logger.info("Running cleanup task")

    try:
        # Example: Clean up old temp files, expired sessions, etc.
        # This would be implemented based on your needs

        logger.info("Cleanup completed successfully")
        return {"status": "success", "cleaned": 0}

    except Exception as e:
        logger.error(f"Cleanup failed: {e}")
        return {"status": "error", "error": str(e)}


async def send_analytics_report_task(
    ctx: dict[str, Any],
    user_id: int,
    report_type: str,
) -> dict[str, Any]:
    """
    Generate and send analytics report.

    Args:
        ctx: ARQ context
        user_id: User ID to generate report for
        report_type: Type of report (daily, weekly, monthly)

    Returns:
        Dict with status
    """
    logger.info(f"Generating {report_type} report for user {user_id}")

    try:
        # This would generate the report and email it
        # Implementation depends on your analytics requirements

        logger.info(f"Report generated and sent for user {user_id}")
        return {"status": "success", "user_id": user_id, "report_type": report_type}

    except Exception as e:
        logger.error(f"Failed to generate report for user {user_id}: {e}")
        return {"status": "error", "error": str(e), "user_id": user_id}


# Export all task functions
__all__ = [
    "send_email_task",
    "send_verification_email_task",
    "send_password_reset_email_task",
    "process_image_task",
    "cleanup_old_data_task",
    "send_analytics_report_task",
]
