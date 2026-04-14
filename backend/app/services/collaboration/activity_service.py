"""
Activity service for tracking user activities in projects.

Provides activity logging and audit trail functionality.
"""

from typing import Any, cast
from uuid import UUID

import structlog
from app.models.collaboration import ActionType, ActivityLog, ResourceType
from app.repositories.collaboration.activity_repository import activity_repository
from app.schemas.collaboration import ActivityLogResponse
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ActivityService:
    """Service for activity tracking operations."""

    async def track_activity(
        self,
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        action_type: str,
        resource_type: str,
        resource_id: str,
        resource_name: str | None = None,
        changes: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ActivityLog:
        """
        Track user activity in a project.

        Args:
            db: Database session
            project_id: Project ID
            user_id: User performing action
            action_type: Type of action (created, modified, deleted, etc.)
            resource_type: Type of resource (workflow, state, project, etc.)
            resource_id: Resource ID
            resource_name: Optional resource name for display
            changes: Optional change details (diff)
            metadata: Optional additional metadata

        Returns:
            Created ActivityLog
        """
        try:
            activity = await activity_repository.create_activity(
                db,
                project_id=project_id,
                user_id=user_id,
                action_type=ActionType(action_type),
                resource_type=ResourceType(resource_type),
                resource_id=resource_id,
                resource_name=resource_name,
                changes=changes,
                metadata=metadata,
            )

            await db.commit()
            await db.refresh(activity)

            logger.info(
                "activity_tracked",
                project_id=project_id,
                user_id=user_id,
                action_type=action_type,
            )

            return activity

        except Exception as e:
            logger.error("activity_tracking_failed", error=str(e))
            await db.rollback()
            raise

    async def get_project_activities(
        self,
        db: AsyncSession,
        project_id: UUID,
        action_type: str | None = None,
        resource_type: str | None = None,
        user_id: UUID | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[ActivityLogResponse]:
        """
        Get activity feed for a project.

        Args:
            db: Database session
            project_id: Project ID
            action_type: Optional filter by action type
            resource_type: Optional filter by resource type
            user_id: Optional filter by user ID
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            List of activity log responses with user info
        """
        activities = await activity_repository.get_project_activities(
            db,
            project_id=project_id,
            action_type=action_type,
            resource_type=resource_type,
            user_id=user_id,
            offset=offset,
            limit=limit,
        )

        responses = []
        for activity in activities:
            response = ActivityLogResponse.model_validate(activity)

            if activity.user:
                response.username = cast(str, activity.user.username)
                response.email = cast(str, activity.user.email)
                response.avatar_url = activity.user.avatar_url

            responses.append(response)

        return responses


# Global instance
activity_service = ActivityService()
