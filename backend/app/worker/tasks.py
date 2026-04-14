"""Background task definitions for ARQ worker."""

from typing import Any
from uuid import UUID

import structlog

logger = structlog.get_logger(__name__)


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
    logger.info("sending_email", to_email=to_email, subject=subject)

    try:
        from app.services.email.email_transport_service import \
            EmailTransportService

        transport = EmailTransportService()
        await transport.send_email(
            to_email=to_email,
            subject=subject,
            html_body=html_content,
            text_body=text_content,
        )

        logger.info("email_sent_successfully", to_email=to_email)
        return {"status": "success", "to_email": to_email, "subject": subject}

    except Exception as e:
        logger.error(
            "email_send_failed",
            to_email=to_email,
            error=str(e),
            error_type=type(e).__name__,
        )
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
    logger.info("sending_verification_email", to_email=to_email)

    try:
        from app.core.config import settings
        from app.services.email.email_template_service import \
            EmailTemplateService
        from app.services.email.email_transport_service import \
            EmailTransportService

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

        logger.info("verification_email_sent_successfully", to_email=to_email)
        return {"status": "success", "to_email": to_email}

    except Exception as e:
        logger.error(
            "verification_email_send_failed",
            to_email=to_email,
            error=str(e),
            error_type=type(e).__name__,
        )
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
    logger.info("sending_password_reset_email", to_email=to_email)

    try:
        from app.core.config import settings
        from app.services.email.email_template_service import \
            EmailTemplateService
        from app.services.email.email_transport_service import \
            EmailTransportService

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

        logger.info("password_reset_email_sent_successfully", to_email=to_email)
        return {"status": "success", "to_email": to_email}

    except Exception as e:
        logger.error(
            "password_reset_email_send_failed",
            to_email=to_email,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {"status": "error", "error": str(e), "to_email": to_email}


async def process_uploaded_image(
    ctx: dict[str, Any],
    s3_key: str,
    user_id: str,
    project_id: str,
    image_id: str,
) -> dict[str, Any]:
    """
    Process uploaded image in background: generate thumbnails and upload to S3.

    This task runs asynchronously after image upload to generate thumbnail
    variants without blocking the upload response.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)
        s3_key: S3 key of the original uploaded image
        user_id: User ID who uploaded the image
        project_id: Project ID the image belongs to
        image_id: Unique image identifier

    Returns:
        Dict with status, variant keys, and processing info
    """
    logger.info(
        "processing_uploaded_image",
        s3_key=s3_key,
        user_id=user_id,
        project_id=project_id,
        image_id=image_id,
    )

    try:
        from app.db.session import AsyncSessionLocal
        from app.services.image_processing_service import \
            ImageProcessingService
        from app.services.object_storage import object_storage
        from app.services.storage_service import StorageService

        # Step 1: Download original image from S3
        logger.debug("downloading_original_from_s3", s3_key=s3_key)
        try:
            original_bytes = object_storage.download_file(s3_key)
        except Exception as e:
            logger.error(
                "s3_download_failed",
                s3_key=s3_key,
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "status": "failed",
                "error": f"Failed to download original image: {str(e)}",
                "s3_key": s3_key,
            }

        # Step 2: Generate thumbnails (using parallel processing for 40-50% speed improvement)
        logger.debug("generating_thumbnails_parallel", image_id=image_id)
        try:
            thumbnails = ImageProcessingService.generate_thumbnails_parallel(
                original_bytes
            )
            logger.info(
                "thumbnails_generated_parallel",
                image_id=image_id,
                variants=list(thumbnails.keys()),
            )
        except Exception as e:
            logger.error(
                "thumbnail_generation_failed",
                image_id=image_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "status": "failed",
                "error": f"Failed to generate thumbnails: {str(e)}",
                "s3_key": s3_key,
            }

        # Step 3: Upload thumbnails to S3
        variant_keys = {}
        total_thumbnail_size = 0

        for variant_name, thumbnail_bytes in thumbnails.items():
            # Construct S3 key: images/{user_id}/{project_id}/{image_id}_{variant}.webp
            variant_key = (
                f"images/{user_id}/{project_id}/{image_id}_{variant_name}.webp"
            )

            try:
                # Upload thumbnail
                import io

                file_obj = io.BytesIO(thumbnail_bytes)
                object_storage.backend.upload_file(
                    file_obj=file_obj,
                    key=variant_key,
                    content_type="image/webp",
                    metadata={
                        "user_id": user_id,
                        "project_id": project_id,
                        "image_id": image_id,
                        "variant": variant_name,
                        "original_s3_key": s3_key,
                    },
                )

                variant_keys[variant_name] = variant_key
                total_thumbnail_size += len(thumbnail_bytes)

                logger.debug(
                    "thumbnail_uploaded",
                    variant=variant_name,
                    key=variant_key,
                    size_bytes=len(thumbnail_bytes),
                )

            except Exception as e:
                logger.error(
                    "thumbnail_upload_failed",
                    variant=variant_name,
                    key=variant_key,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                # Continue with other variants even if one fails
                continue

        # Step 4: Update storage_usage metadata with variant paths
        async with AsyncSessionLocal() as db:
            try:
                metadata = {
                    "variants": variant_keys,
                    "processing_status": "completed",
                    "image_id": image_id,
                    "thumbnail_size_bytes": total_thumbnail_size,
                }

                updated = await StorageService.update_metadata(
                    db=db,
                    file_path=s3_key,
                    user_id=UUID(user_id),
                    metadata=metadata,
                )

                if not updated:
                    logger.warning(
                        "storage_metadata_update_failed",
                        s3_key=s3_key,
                        reason="record_not_found",
                    )

            except Exception as e:
                logger.error(
                    "storage_metadata_update_failed",
                    s3_key=s3_key,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                # Don't fail the whole task if metadata update fails

        logger.info(
            "image_processing_completed",
            s3_key=s3_key,
            image_id=image_id,
            variants_count=len(variant_keys),
            total_thumbnail_size=total_thumbnail_size,
        )

        return {
            "status": "completed",
            "s3_key": s3_key,
            "image_id": image_id,
            "variants": variant_keys,
            "thumbnail_size_bytes": total_thumbnail_size,
        }

    except Exception as e:
        logger.exception(
            "image_processing_failed",
            s3_key=s3_key,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "status": "failed",
            "error": str(e),
            "s3_key": s3_key,
            "image_id": image_id,
        }


async def cleanup_old_data_task(
    ctx: dict[str, Any], days_to_keep: int = 90
) -> dict[str, Any]:
    """
    Clean up old audit logs and usage metrics (periodic task).

    This task should be run daily via cron or scheduled job.
    Keeps audit logs and detailed metrics for the specified number of days.

    Args:
        ctx: ARQ context
        days_to_keep: Number of days to keep detailed data (default 90)

    Returns:
        Dict with cleanup statistics
    """
    logger.info("running_cleanup_task", days_to_keep=days_to_keep)

    try:
        from datetime import timedelta

        from app.db.session import AsyncSessionLocal
        from app.models.audit_log import AuditLog
        from app.models.usage_metric import UsageMetric
        from qontinui_schemas.common import utc_now
        from sqlalchemy import delete

        cutoff_date = utc_now() - timedelta(days=days_to_keep)
        audit_logs_deleted = 0
        metrics_deleted = 0

        async with AsyncSessionLocal() as db:
            # Clean up old audit logs
            audit_delete_stmt = delete(AuditLog).where(
                AuditLog.created_at < cutoff_date
            )
            result = await db.execute(audit_delete_stmt)
            audit_logs_deleted = result.rowcount

            # Clean up old usage metrics
            # Note: Keep aggregated monthly summaries, only delete detailed metrics
            metrics_delete_stmt = delete(UsageMetric).where(
                UsageMetric.timestamp < cutoff_date
            )
            result = await db.execute(metrics_delete_stmt)
            metrics_deleted = result.rowcount

            await db.commit()

        logger.info(
            "cleanup_completed",
            audit_logs_deleted=audit_logs_deleted,
            metrics_deleted=metrics_deleted,
        )

        return {
            "status": "success",
            "audit_logs_deleted": audit_logs_deleted,
            "metrics_deleted": metrics_deleted,
            "cutoff_date": cutoff_date.isoformat(),
        }

    except Exception as e:
        logger.exception("cleanup_failed", error=str(e), error_type=type(e).__name__)
        return {"status": "error", "error": str(e)}


async def send_analytics_report_task(
    ctx: dict[str, Any],
    user_id: UUID,
    report_type: str = "weekly",
) -> dict[str, Any]:
    """
    Generate and send analytics report to admin users.

    This task generates a comprehensive usage report and emails it to admin users.
    Should be scheduled to run weekly for admins.

    Args:
        ctx: ARQ context
        user_id: User ID to generate report for (must be admin)
        report_type: Type of report (daily, weekly, monthly)

    Returns:
        Dict with status
    """
    logger.info("generating_analytics_report", report_type=report_type, user_id=user_id)

    try:
        from app.core.config import settings
        from app.db.session import AsyncSessionLocal
        from app.models.user import User
        from app.services.analytics_service import analytics_service
        from app.services.email.email_transport_service import \
            EmailTransportService
        from qontinui_schemas.common import utc_now
        from sqlalchemy import select

        # Determine days based on report type
        days_map = {"daily": 1, "weekly": 7, "monthly": 30}
        days = days_map.get(report_type, 7)

        async with AsyncSessionLocal() as db:
            # Get user
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()

            if not user:
                return {
                    "status": "error",
                    "error": f"User {user_id} not found",
                    "user_id": user_id,
                }

            if not user.is_superuser:
                return {
                    "status": "error",
                    "error": f"User {user_id} is not an admin",
                    "user_id": user_id,
                }

            # Generate analytics summary
            summary = await analytics_service.get_analytics_summary(user_id, days, db)

            # Format email content
            period_start = summary.period_start.strftime("%Y-%m-%d")
            period_end = summary.period_end.strftime("%Y-%m-%d")

            html_content = f"""
            <html>
            <head>
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
                    .header {{ background-color: #4CAF50; color: white; padding: 20px; text-align: center; }}
                    .content {{ padding: 20px; }}
                    .metric {{ background-color: #f4f4f4; padding: 15px; margin: 10px 0; border-left: 4px solid #4CAF50; }}
                    .metric-label {{ font-weight: bold; color: #333; }}
                    .metric-value {{ font-size: 24px; color: #4CAF50; }}
                    .footer {{ background-color: #f4f4f4; padding: 20px; text-align: center; color: #666; }}
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Qontinui {report_type.capitalize()} Analytics Report</h1>
                    <p>{period_start} to {period_end}</p>
                </div>

                <div class="content">
                    <h2>Usage Summary</h2>

                    <div class="metric">
                        <div class="metric-label">API Calls</div>
                        <div class="metric-value">{summary.api_calls:,}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Projects Created</div>
                        <div class="metric-value">{summary.projects_created}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">States Created</div>
                        <div class="metric-value">{summary.states_created}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Images Uploaded</div>
                        <div class="metric-value">{summary.images_uploaded}</div>
                    </div>

                    <h2>Overall Statistics</h2>

                    <div class="metric">
                        <div class="metric-label">Total Projects</div>
                        <div class="metric-value">{summary.total_projects}</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Storage Used</div>
                        <div class="metric-value">{summary.total_storage_bytes / (1024**2):.2f} MB</div>
                    </div>

                    <div class="metric">
                        <div class="metric-label">Avg Response Time</div>
                        <div class="metric-value">{summary.avg_response_time_seconds:.3f}s</div>
                    </div>
                </div>

                <div class="footer">
                    <p>Generated on {utc_now().strftime("%Y-%m-%d %H:%M:%S")} UTC</p>
                    <p><a href="{settings.FRONTEND_URL}/admin/analytics">View Detailed Analytics</a></p>
                </div>
            </body>
            </html>
            """

            text_content = f"""
            Qontinui {report_type.capitalize()} Analytics Report
            {period_start} to {period_end}

            Usage Summary:
            - API Calls: {summary.api_calls:,}
            - Projects Created: {summary.projects_created}
            - States Created: {summary.states_created}
            - Images Uploaded: {summary.images_uploaded}

            Overall Statistics:
            - Total Projects: {summary.total_projects}
            - Storage Used: {summary.total_storage_bytes / (1024**2):.2f} MB
            - Avg Response Time: {summary.avg_response_time_seconds:.3f}s

            Generated on {utc_now().strftime("%Y-%m-%d %H:%M:%S")} UTC
            View details: {settings.FRONTEND_URL}/admin/analytics
            """

            # Send email
            transport = EmailTransportService()
            await transport.send_email(
                to_email=user.email,
                subject=f"Qontinui {report_type.capitalize()} Analytics Report - {period_start} to {period_end}",
                html_body=html_content,
                text_body=text_content,
            )

        logger.info(
            "analytics_report_sent_successfully",
            to_email=user.email,
            user_id=user_id,
            report_type=report_type,
        )
        return {
            "status": "success",
            "user_id": user_id,
            "report_type": report_type,
            "to_email": user.email,
        }

    except Exception as e:
        logger.exception(
            "analytics_report_generation_failed",
            user_id=user_id,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {"status": "error", "error": str(e), "user_id": user_id}


# Export all task functions
__all__ = [
    "send_email_task",
    "send_verification_email_task",
    "send_password_reset_email_task",
    "process_uploaded_image",
    "cleanup_old_data_task",
    "send_analytics_report_task",
]
