"""
Test notification email delivery.

Provides utilities for sending test-related notification emails.
"""

from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun
from app.models.test_deficiency import TestDeficiency
from app.schemas.test_notifications import (
    CoverageAlertNotification,
    DeficiencyNotification,
    TestRunNotification,
)
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService

logger = structlog.get_logger(__name__)


class TestEmailService:
    """Service for sending test-related notification emails."""

    def __init__(self):
        """Initialize email service."""
        self.email_transport = EmailTransportService()
        self.email_templates = EmailTemplateService()

    async def send_test_run_email(
        self,
        db: AsyncSession,
        test_run: SoftwareTestRun,
        notification: TestRunNotification,
        email_config: dict[str, Any],
    ) -> bool:
        """Send test run notification via email."""
        try:
            recipients = email_config.get("email_recipients", [])
            if not recipients:
                logger.debug("no_email_recipients", test_run_id=str(test_run.id))
                return False

            # Get project for context
            result = await db.execute(
                select(Project).filter(Project.id == test_run.project_id)
            )
            project = result.scalar_one_or_none()

            # Build email context
            context = {
                "project_name": project.name if project else "Unknown Project",
                "workflow_name": test_run.workflow_id or "Unknown Workflow",
                "status": test_run.status,
                "status_emoji": "✅" if test_run.status == "completed" else "❌",
                "coverage": f"{notification.coverage_percentage}%",
                "total_transitions": notification.total_transitions,
                "successful_transitions": notification.successful_transitions,
                "failed_transitions": notification.failed_transitions,
                "deficiencies_found": notification.deficiencies_found,
                "critical_deficiencies": notification.critical_deficiencies,
                "high_deficiencies": notification.high_deficiencies,
                "dashboard_url": notification.dashboard_url,
                "report_url": notification.report_url,
            }

            # Render template
            html_body = f"""
            <h2>Test Run {test_run.status.title()}</h2>
            <p>Workflow: {context["workflow_name"]}</p>
            <p>Coverage: {context["coverage"]}</p>
            <p>Transitions: {context["successful_transitions"]}/{context["total_transitions"]} successful</p>
            {f"<p>⚠️ Found {context['deficiencies_found']} deficiencies</p>" if int(context["deficiencies_found"] or 0) > 0 else ""}
            <p><a href="{context["dashboard_url"]}">View Dashboard</a></p>
            """

            # Send to all recipients
            success = True
            for recipient in recipients:
                sent = await self.email_transport.send_email(
                    to_email=recipient,
                    subject=f"Test Run {test_run.status.title()}: {context['workflow_name']}",
                    text_body=f"Test run {test_run.status}",
                    html_body=html_body,
                )
                success = success and sent

            return success

        except Exception as e:
            logger.error("test_run_email_failed", error=str(e))
            return False

    async def send_deficiency_email(
        self,
        db: AsyncSession,
        deficiency: TestDeficiency,
        notification: DeficiencyNotification,
        email_config: dict[str, Any],
    ) -> bool:
        """Send deficiency notification via email."""
        try:
            recipients = email_config.get("email_recipients", [])
            if not recipients:
                return False

            # Build HTML body
            html_body = f"""
            <h2>🚨 {deficiency.severity.upper()} Deficiency Detected</h2>
            <p><strong>{deficiency.title}</strong></p>
            <p>{deficiency.description}</p>
            <p>Type: {deficiency.deficiency_type}</p>
            <p>Reproducible: {"Yes" if deficiency.reproducible else "No"}</p>
            {f'<p><a href="{notification.deficiency_url}">View Details</a></p>' if notification.deficiency_url else ""}
            """

            # Send to all recipients
            success = True
            for recipient in recipients:
                sent = await self.email_transport.send_email(
                    to_email=recipient,
                    subject=f"{deficiency.severity.upper()} Deficiency: {deficiency.title}",
                    text_body=deficiency.description,
                    html_body=html_body,
                )
                success = success and sent

            return success

        except Exception as e:
            logger.error("deficiency_email_failed", error=str(e))
            return False

    async def send_coverage_email(
        self,
        db: AsyncSession,
        notification: CoverageAlertNotification,
        email_config: dict[str, Any],
    ) -> bool:
        """Send coverage drop alert via email."""
        try:
            recipients = email_config.get("email_recipients", [])
            if not recipients:
                return False

            drop_text = ""
            if notification.coverage_drop:
                drop_text = f" (↓ {notification.coverage_drop:.2f}%)"

            html_body = f"""
            <h2>⚠️ Test Coverage Drop Alert</h2>
            <p>Coverage fell to {notification.current_coverage}%{drop_text}</p>
            <p>Threshold: {notification.threshold}%</p>
            {f'<p><a href="{notification.dashboard_url}">View Dashboard</a></p>' if notification.dashboard_url else ""}
            """

            # Send to all recipients
            success = True
            for recipient in recipients:
                sent = await self.email_transport.send_email(
                    to_email=recipient,
                    subject=f"Coverage Drop Alert: {notification.current_coverage}%",
                    text_body=f"Coverage dropped to {notification.current_coverage}%",
                    html_body=html_body,
                )
                success = success and sent

            return success

        except Exception as e:
            logger.error("coverage_email_failed", error=str(e))
            return False


# Global instance
test_email_service = TestEmailService()
