"""
Notification preferences management.

Provides utilities for managing user and project notification preferences.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from app.models.notification import NotificationPreferences
from app.models.test_notification_preferences import \
    TestNotificationPreferences
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class UserPreferencesService:
    """Service for managing user notification preferences."""

    async def get_user_preferences(
        self, db: AsyncSession, user_id: UUID
    ) -> NotificationPreferences:
        """
        Get notification preferences for a user.

        Creates default preferences if none exist.

        Args:
            db: Database session
            user_id: ID of user

        Returns:
            NotificationPreferences object
        """
        try:
            result = await db.execute(
                select(NotificationPreferences).filter(
                    NotificationPreferences.user_id == user_id
                )
            )
            preferences = result.scalar_one_or_none()

            if not preferences:
                # Create default preferences
                preferences = NotificationPreferences.create_default(user_id)
                db.add(preferences)
                await db.commit()
                await db.refresh(preferences)
                logger.info("preferences_created", user_id=user_id)

            return preferences

        except Exception as e:
            logger.error("get_preferences_failed", error=str(e))
            # Return default preferences without saving
            return NotificationPreferences(user_id=user_id)

    async def update_user_preferences(
        self,
        db: AsyncSession,
        user_id: UUID,
        preferences_data: dict[str, bool],
    ) -> NotificationPreferences:
        """
        Update notification preferences for a user.

        Args:
            db: Database session
            user_id: ID of user
            preferences_data: Dictionary of preference updates

        Returns:
            Updated NotificationPreferences object
        """
        try:
            preferences = await self.get_user_preferences(db, user_id)

            # Update fields
            for key, value in preferences_data.items():
                if hasattr(preferences, key):
                    setattr(preferences, key, value)

            preferences.updated_at = datetime.now(UTC)  # type: ignore[assignment]
            await db.commit()
            await db.refresh(preferences)

            logger.info("preferences_updated", user_id=user_id)
            return preferences

        except Exception as e:
            logger.error("update_preferences_failed", error=str(e))
            await db.rollback()
            raise


class ProjectPreferencesService:
    """Service for managing project test notification preferences."""

    async def get_project_preferences(
        self, db: AsyncSession, project_id: UUID
    ) -> TestNotificationPreferences:
        """
        Get test notification preferences for a project.

        Creates default preferences if none exist.

        Args:
            db: Database session
            project_id: ID of project

        Returns:
            TestNotificationPreferences object
        """
        try:
            result = await db.execute(
                select(TestNotificationPreferences).filter(
                    TestNotificationPreferences.project_id == project_id
                )
            )
            preferences = result.scalar_one_or_none()

            if not preferences:
                # Create default preferences
                preferences = TestNotificationPreferences.create_default(project_id)
                db.add(preferences)
                await db.commit()
                await db.refresh(preferences)
                logger.info("test_preferences_created", project_id=str(project_id))

            return preferences

        except Exception as e:
            logger.error("get_test_preferences_failed", error=str(e))
            # Return default preferences without saving
            return TestNotificationPreferences.create_default(project_id)

    async def update_project_preferences(
        self,
        db: AsyncSession,
        project_id: UUID,
        preferences_data: dict[str, Any],
    ) -> TestNotificationPreferences:
        """
        Update test notification preferences for a project.

        Args:
            db: Database session
            project_id: ID of project
            preferences_data: Dictionary of preference updates

        Returns:
            Updated TestNotificationPreferences object
        """
        try:
            preferences = await self.get_project_preferences(db, project_id)

            # Update fields
            for key, value in preferences_data.items():
                if hasattr(preferences, key):
                    setattr(preferences, key, value)

            preferences.updated_at = datetime.now(UTC)  # type: ignore[assignment]
            await db.commit()
            await db.refresh(preferences)

            logger.info("test_preferences_updated", project_id=str(project_id))
            return preferences

        except Exception as e:
            logger.error("update_test_preferences_failed", error=str(e))
            await db.rollback()
            raise


# Global instances
user_preferences_service = UserPreferencesService()
project_preferences_service = ProjectPreferencesService()
