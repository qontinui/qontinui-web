"""
Test notification service for managing test-related notifications.

Provides business logic for:
- Sending notifications when test runs complete
- Alerting on critical/high severity deficiencies
- Notifying when coverage drops below threshold
- Multi-channel delivery (WebSocket, email, Slack, webhooks)
"""

from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationType
from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun
from app.models.test_deficiency import TestDeficiency
from app.services.notifications.builders import test_notification_builder
from app.services.notifications.channels import channel_delivery_service
from app.services.notifications.core import notification_service
from app.services.notifications.preferences import project_preferences_service
from app.services.notifications.test_email import test_email_service

logger = structlog.get_logger(__name__)


class TestNotificationService:
    """Service for managing test-related notifications."""

    # ========================================================================
    # Notification Preferences (delegated to preferences service)
    # ========================================================================

    async def get_project_preferences(self, db: AsyncSession, project_id: UUID):
        """Get test notification preferences for a project."""
        return await project_preferences_service.get_project_preferences(db, project_id)

    async def update_project_preferences(
        self,
        db: AsyncSession,
        project_id: UUID,
        preferences_data: dict[str, Any],
    ):
        """Update test notification preferences for a project."""
        return await project_preferences_service.update_project_preferences(
            db, project_id, preferences_data
        )

    # ========================================================================
    # Test Run Notifications
    # ========================================================================

    async def notify_test_run_completed(
        self,
        db: AsyncSession,
        test_run_id: UUID,
        project_id: UUID,
        frontend_url: str,
    ) -> bool:
        """Send notification when test run completes."""
        try:
            # Get test run
            result = await db.execute(
                select(SoftwareTestRun).filter(SoftwareTestRun.id == test_run_id)
            )
            test_run = result.scalar_one_or_none()

            if not test_run:
                logger.warning("test_run_not_found", test_run_id=str(test_run_id))
                return False

            # Get preferences
            preferences = await self.get_project_preferences(db, project_id)

            # Check if notification should be sent
            if not preferences.should_notify_test_run(test_run.status):
                logger.info(
                    "test_run_notification_skipped",
                    test_run_id=str(test_run_id),
                    status=test_run.status,
                    reason="user_preferences",
                )
                return False

            # Build notification data
            notification = await test_notification_builder.build_test_run_notification(
                db, test_run, frontend_url
            )

            # Send via enabled channels
            success = await self._send_test_run_via_channels(
                db, preferences, project_id, notification, test_run
            )

            # Create in-app notification
            await self._create_in_app_test_notification(
                db,
                project_id,
                NotificationType.PROJECT_UPDATE,
                f"Test run {test_run.status}",
                f"Test run for workflow '{test_run.workflow_id or 'Unknown'}' {test_run.status}",
                test_run_id=test_run_id,
            )

            logger.info(
                "test_run_notification_sent",
                test_run_id=str(test_run_id),
                status=test_run.status,
            )
            return success

        except Exception as e:
            logger.error(
                "test_run_notification_failed",
                error=str(e),
                test_run_id=str(test_run_id),
            )
            return False

    # ========================================================================
    # Deficiency Notifications
    # ========================================================================

    async def notify_critical_deficiency(
        self,
        db: AsyncSession,
        deficiency_id: UUID,
        project_id: UUID,
        frontend_url: str,
    ) -> bool:
        """Send immediate notification for critical/high severity deficiency."""
        try:
            # Get deficiency
            result = await db.execute(
                select(TestDeficiency).filter(TestDeficiency.id == deficiency_id)
            )
            deficiency = result.scalar_one_or_none()

            if not deficiency:
                logger.warning("deficiency_not_found", deficiency_id=str(deficiency_id))
                return False

            # Get preferences
            preferences = await self.get_project_preferences(db, project_id)

            # Check if notification should be sent
            if not preferences.should_notify_deficiency(deficiency.severity):
                logger.info(
                    "deficiency_notification_skipped",
                    deficiency_id=str(deficiency_id),
                    severity=deficiency.severity,
                    reason="user_preferences",
                )
                return False

            # Build notification data
            notification = (
                await test_notification_builder.build_deficiency_notification(
                    db, deficiency, frontend_url
                )
            )

            # Send via enabled channels
            success = await self._send_deficiency_via_channels(
                db, preferences, project_id, notification, deficiency
            )

            # Create in-app notification
            await self._create_in_app_test_notification(
                db,
                project_id,
                NotificationType.PROJECT_UPDATE,
                f"{deficiency.severity.upper()} deficiency detected",
                f"{deficiency.title}",
                deficiency_id=deficiency_id,
            )

            logger.info(
                "deficiency_notification_sent",
                deficiency_id=str(deficiency_id),
                severity=deficiency.severity,
            )
            return success

        except Exception as e:
            logger.error(
                "deficiency_notification_failed",
                error=str(e),
                deficiency_id=str(deficiency_id),
            )
            return False

    # ========================================================================
    # Coverage Drop Notifications
    # ========================================================================

    async def notify_coverage_drop(
        self,
        db: AsyncSession,
        test_run_id: UUID,
        project_id: UUID,
        current_coverage: Decimal,
        previous_coverage: Decimal | None,
        frontend_url: str,
    ) -> bool:
        """Send notification when coverage drops below threshold."""
        try:
            # Get preferences
            preferences = await self.get_project_preferences(db, project_id)

            # Check if notification should be sent
            if not preferences.should_notify_coverage_drop(current_coverage):
                logger.info(
                    "coverage_drop_notification_skipped",
                    test_run_id=str(test_run_id),
                    current_coverage=float(current_coverage),
                    threshold=float(preferences.coverage_drop_threshold),
                    reason="above_threshold",
                )
                return False

            # Get test run for additional context
            result = await db.execute(
                select(SoftwareTestRun).filter(SoftwareTestRun.id == test_run_id)
            )
            test_run = result.scalar_one_or_none()

            # Build notification data
            notification = (
                await test_notification_builder.build_coverage_alert_notification(
                    test_run,
                    project_id,
                    current_coverage,
                    previous_coverage,
                    preferences.coverage_drop_threshold,
                    frontend_url,
                )
            )

            # Send via enabled channels
            success = await self._send_coverage_via_channels(
                db, preferences, project_id, notification
            )

            # Create in-app notification
            await self._create_in_app_test_notification(
                db,
                project_id,
                NotificationType.PROJECT_UPDATE,
                "Test coverage dropped",
                f"Coverage fell to {current_coverage}% (threshold: {preferences.coverage_drop_threshold}%)",
                test_run_id=test_run_id,
            )

            logger.info(
                "coverage_drop_notification_sent",
                test_run_id=str(test_run_id),
                current_coverage=float(current_coverage),
            )
            return success

        except Exception as e:
            logger.error(
                "coverage_drop_notification_failed",
                error=str(e),
                test_run_id=str(test_run_id),
            )
            return False

    # ========================================================================
    # Channel Delivery Methods
    # ========================================================================

    async def _send_test_run_via_channels(
        self,
        db: AsyncSession,
        preferences: Any,
        project_id: UUID,
        notification: Any,
        test_run: SoftwareTestRun,
    ) -> bool:
        """Send test run notification via enabled channels."""
        success = False

        if preferences.is_channel_enabled("websocket"):
            ws_success = await channel_delivery_service.send_websocket_notification(
                project_id, "test_run_completed", notification.model_dump()
            )
            success = success or ws_success

        if preferences.is_channel_enabled("email"):
            email_success = await test_email_service.send_test_run_email(
                db, test_run, notification, preferences.email_config
            )
            success = success or email_success

        if preferences.is_channel_enabled("slack"):
            slack_success = await channel_delivery_service.send_test_run_slack(
                notification, preferences.slack_config
            )
            success = success or slack_success

        if preferences.is_channel_enabled("webhook"):
            webhook_success = await channel_delivery_service.send_webhook(
                "test_run_completed",
                notification.model_dump(),
                preferences.webhook_config,
            )
            success = success or webhook_success

        return success

    async def _send_deficiency_via_channels(
        self,
        db: AsyncSession,
        preferences: Any,
        project_id: UUID,
        notification: Any,
        deficiency: TestDeficiency,
    ) -> bool:
        """Send deficiency notification via enabled channels."""
        success = False

        if preferences.is_channel_enabled("websocket"):
            ws_success = await channel_delivery_service.send_websocket_notification(
                project_id, "deficiency_detected", notification.model_dump()
            )
            success = success or ws_success

        if preferences.is_channel_enabled("email"):
            email_success = await test_email_service.send_deficiency_email(
                db, deficiency, notification, preferences.email_config
            )
            success = success or email_success

        if preferences.is_channel_enabled("slack"):
            slack_success = await channel_delivery_service.send_deficiency_slack(
                notification, preferences.slack_config
            )
            success = success or slack_success

        if preferences.is_channel_enabled("webhook"):
            webhook_success = await channel_delivery_service.send_webhook(
                "deficiency_detected",
                notification.model_dump(),
                preferences.webhook_config,
            )
            success = success or webhook_success

        return success

    async def _send_coverage_via_channels(
        self, db: AsyncSession, preferences: Any, project_id: UUID, notification: Any
    ) -> bool:
        """Send coverage alert via enabled channels."""
        success = False

        if preferences.is_channel_enabled("websocket"):
            ws_success = await channel_delivery_service.send_websocket_notification(
                project_id, "coverage_drop", notification.model_dump()
            )
            success = success or ws_success

        if preferences.is_channel_enabled("email"):
            email_success = await test_email_service.send_coverage_email(
                db, notification, preferences.email_config
            )
            success = success or email_success

        if preferences.is_channel_enabled("slack"):
            slack_success = await channel_delivery_service.send_coverage_slack(
                notification, preferences.slack_config
            )
            success = success or slack_success

        if preferences.is_channel_enabled("webhook"):
            webhook_success = await channel_delivery_service.send_webhook(
                "coverage_drop", notification.model_dump(), preferences.webhook_config
            )
            success = success or webhook_success

        return success

    # ========================================================================
    # In-App Notifications
    # ========================================================================

    async def _create_in_app_test_notification(
        self,
        db: AsyncSession,
        project_id: UUID,
        notification_type: NotificationType,
        title: str,
        message: str,
        test_run_id: UUID | None = None,
        deficiency_id: UUID | None = None,
    ) -> None:
        """Create in-app notification for project team members."""
        try:
            # Get project to find team members
            result = await db.execute(select(Project).filter(Project.id == project_id))
            project = result.scalar_one_or_none()

            if not project:
                return

            # Build metadata
            metadata = {
                "project_id": str(project_id),
                "deep_link": f"/projects/{project_id}/testing",
            }

            if test_run_id:
                metadata["test_run_id"] = str(test_run_id)
                metadata["deep_link"] = (
                    f"/projects/{project_id}/testing/runs/{test_run_id}"
                )

            if deficiency_id:
                metadata["deficiency_id"] = str(deficiency_id)
                metadata["deep_link"] = (
                    f"/projects/{project_id}/testing/deficiencies/{deficiency_id}"
                )

            # Create notification for project owner
            from uuid import UUID as UUIDType

            owner_id: UUIDType = project.owner_id  # type: ignore[assignment]
            await notification_service.create_notification(
                db=db,
                user_id=owner_id,
                notification_type=notification_type,
                title=title,
                message=message,
                project_id=project_id,
                resource_type="test_run" if test_run_id else "deficiency",
                resource_id=str(test_run_id or deficiency_id or ""),
                metadata=metadata,
                send_email=False,
            )

        except Exception as e:
            logger.error("in_app_test_notification_failed", error=str(e))


# Global instance
test_notification_service = TestNotificationService()
