"""
Notification preferences management.

Provides utilities for managing user notification preferences.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationPreferences

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


# Global instances
user_preferences_service = UserPreferencesService()
