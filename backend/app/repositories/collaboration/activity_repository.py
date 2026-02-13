"""Repository for activity log database operations.

Provides data access for the audit trail of user actions within projects.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.collaboration import ActionType, ActivityLog, ResourceType


class ActivityRepository:
    """Repository for activity log data access operations."""

    async def create_activity(
        self,
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        action_type: ActionType,
        resource_type: ResourceType,
        resource_id: str,
        resource_name: str | None = None,
        changes: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ActivityLog:
        """Create an activity log entry."""
        activity = ActivityLog.create_activity(
            project_id=project_id,
            user_id=user_id,
            action_type=action_type,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_name=resource_name,
            changes=changes,
            activity_metadata=metadata,
        )
        db.add(activity)
        await db.flush()
        await db.refresh(activity)
        return activity

    async def get_project_activities(
        self,
        db: AsyncSession,
        project_id: UUID,
        action_type: str | None = None,
        resource_type: str | None = None,
        user_id: UUID | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[ActivityLog]:
        """Get activity logs for a project."""
        query = (
            select(ActivityLog)
            .filter(ActivityLog.project_id == project_id)
            .options(joinedload(ActivityLog.user))
        )

        if action_type:
            query = query.filter(ActivityLog.action_type == ActionType(action_type))

        if resource_type:
            query = query.filter(
                ActivityLog.resource_type == ResourceType(resource_type)
            )

        if user_id:
            query = query.filter(ActivityLog.user_id == user_id)

        result = await db.execute(
            query.offset(offset).limit(limit).order_by(ActivityLog.created_at.desc())
        )
        return list(result.unique().scalars().all())


activity_repository = ActivityRepository()
