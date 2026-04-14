"""
Collaboration service facade for managing project collaboration features.

This is a facade that delegates to focused services:
- LockingService for resource locking
- ActivityService for activity tracking
- SharingService for access control and email notifications

For new code, prefer importing directly from app.services.collaboration:
    from app.services.collaboration import locking_service, activity_service
"""

from typing import Any
from uuid import UUID

import structlog
from app.models.collaboration import ActivityLog, ProjectLock
from app.models.organization import Organization, OrganizationInvitation
from app.services.collaboration import (activity_service, locking_service,
                                        sharing_service)
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class CollaborationService:
    """
    Facade service for collaboration features.

    Delegates to focused services for:
    - Locking: LockingService
    - Activity: ActivityService
    - Sharing/Email: SharingService
    """

    def __init__(self):
        """Initialize collaboration service facade."""
        self._locking = locking_service
        self._activity = activity_service
        self._sharing = sharing_service

    # ========================================================================
    # Access Control (delegates to SharingService)
    # ========================================================================

    async def check_user_has_access(
        self,
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID,
        required_permission: str = "view",
    ) -> bool:
        """Check if user has required access to a project."""
        return await self._sharing.check_user_has_access(
            db, user_id, project_id, required_permission
        )

    async def get_user_project_permission(
        self, db: AsyncSession, user_id: UUID, project_id: UUID
    ) -> str | None:
        """Get user's permission level for a project."""
        return await self._sharing.get_user_project_permission(db, user_id, project_id)

    # ========================================================================
    # Lock Management (delegates to LockingService)
    # ========================================================================

    async def acquire_project_lock(
        self,
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
        duration_minutes: int = 5,
        metadata: dict[str, Any] | None = None,
    ) -> ProjectLock | None:
        """Acquire a lock on a project resource."""
        lock_info = await self._locking.acquire_lock(
            db,
            user_id,
            project_id,
            resource_type,
            resource_id,
            duration_minutes,
            metadata,
        )
        if lock_info:
            # Return the actual lock from DB for backward compatibility
            return await self._locking.get_resource_lock(
                db, project_id, resource_type, resource_id
            )
        return None

    async def release_project_lock(
        self, db: AsyncSession, lock_id: UUID, user_id: UUID
    ) -> bool:
        """Release a project lock."""
        return await self._locking.release_lock(db, lock_id, user_id)

    async def release_expired_locks(self, db: AsyncSession) -> int:
        """Release all expired locks (background task)."""
        return await self._locking.release_expired_locks(db)

    async def get_resource_lock(
        self,
        db: AsyncSession,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> ProjectLock | None:
        """Get current lock for a resource."""
        return await self._locking.get_resource_lock(
            db, project_id, resource_type, resource_id
        )

    async def acquire_resource_lock(
        self,
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
        duration_minutes: int = 5,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Acquire a lock using distributed locks (preferred method)."""
        lock_info = await self._locking.acquire_lock(
            db,
            user_id,
            project_id,
            resource_type,
            resource_id,
            duration_minutes,
            metadata,
        )
        if lock_info:
            await self.track_activity(
                db, project_id, user_id, "locked", resource_type, resource_id
            )
        return lock_info

    async def release_resource_lock(
        self,
        db: AsyncSession,
        lock_id: UUID,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        """Release a resource lock (preferred method)."""
        success = await self._locking.release_lock(
            db, lock_id, user_id, project_id, resource_type, resource_id
        )
        if success:
            await self.track_activity(
                db, project_id, user_id, "unlocked", resource_type, resource_id
            )
        return success

    async def refresh_resource_lock(
        self,
        db: AsyncSession,
        lock_id: UUID,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
        duration_minutes: int = 5,
    ) -> bool:
        """Refresh/extend a lock's expiration time (heartbeat)."""
        return await self._locking.refresh_lock(
            db,
            lock_id,
            user_id,
            project_id,
            resource_type,
            resource_id,
            duration_minutes,
        )

    # ========================================================================
    # Activity Tracking (delegates to ActivityService)
    # ========================================================================

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
        """Track user activity in a project."""
        return await self._activity.track_activity(
            db,
            project_id,
            user_id,
            action_type,
            resource_type,
            resource_id,
            resource_name,
            changes,
            metadata,
        )

    # ========================================================================
    # Email Notifications (delegates to SharingService)
    # ========================================================================

    async def send_invitation_email(
        self, invitation: OrganizationInvitation, organization: Organization
    ) -> bool:
        """Send organization invitation email."""
        return await self._sharing.send_invitation_email(invitation, organization)

    async def send_project_share_email(
        self,
        to_email: str,
        to_name: str,
        project_name: str,
        shared_by_name: str,
        permission_level: str,
    ) -> bool:
        """Send project sharing notification email."""
        return await self._sharing.send_project_share_email(
            to_email, to_name, project_name, shared_by_name, permission_level
        )


# Global instance
collaboration_service = CollaborationService()
