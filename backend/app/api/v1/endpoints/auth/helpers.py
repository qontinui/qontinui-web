"""Shared helper functions for auth endpoints."""

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.device_session import DeviceSession
from app.services.device_session_service import device_session_service

logger = structlog.get_logger(__name__)


async def send_device_verification_email(
    db: AsyncSession,
    device_session: DeviceSession,
    user_email: str,
    username: str,
) -> None:
    """
    Send device verification email to user.

    Args:
        db: Database session
        device_session: Device session that needs verification
        user_email: User's email address
        username: User's username
    """
    from app.services.email.email_template_service import EmailTemplateService
    from app.worker.queue import task_queue

    # Generate verification token
    verification_token = await device_session_service.generate_verification_token(
        db, device_session
    )

    # Build verification URL
    verify_url = f"{settings.FRONTEND_URL}/verify-device?token={verification_token}"

    # Format location string
    location_parts = []
    if device_session.city:
        location_parts.append(device_session.city)
    if device_session.country:
        location_parts.append(device_session.country)
    location = ", ".join(location_parts) if location_parts else "Unknown"

    # Format device info from user agent (simplified)
    device_info = (
        device_session.user_agent[:100] + "..."
        if len(device_session.user_agent) > 100
        else device_session.user_agent
    )

    # Build template context
    context = {
        "username": username,
        "verify_url": verify_url,
        "login_time": device_session.created_at.strftime("%Y-%m-%d %H:%M UTC"),
        "location": location,
        "ip_address": device_session.ip_address,
        "device_info": device_info,
    }

    # Render email template
    template_service = EmailTemplateService()
    html_body = template_service.render_template("device_verification", context)

    # Send email via task queue
    job_id = await task_queue.send_email(
        to_email=user_email,
        subject="Qontinui - New Device Login Detected",
        html_content=html_body,
        text_content=(
            f"New device login detected from {location} "
            f"(IP: {device_session.ip_address}). "
            "If this was you, please verify your device using the link sent to your email."
        ),
    )

    if job_id:
        logger.info(
            "device_verification_email_sent",
            user_email=user_email,
            device_id=str(device_session.id),
            job_id=job_id,
        )
    else:
        logger.error(
            "device_verification_email_failed",
            user_email=user_email,
            device_id=str(device_session.id),
        )
