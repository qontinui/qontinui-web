"""
Collaboration service for managing project collaboration features.

Provides business logic for:
- Access control and permissions
- Lock management
- Activity tracking
- Email notifications for invitations
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from app.models.organization import (
    Organization,
    OrganizationInvitation,
    ProjectAccessControl,
    TeamMember,
)
from app.models.project import Project
from app.models.user import User
from app.services.distributed_lock_service import distributed_lock_service
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService
from app.services.permission_service import permission_service
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class CollaborationService:
    """Service for collaboration features."""

    def __init__(self):
        """Initialize collaboration service."""
        self.email_transport = EmailTransportService()
        self.email_templates = EmailTemplateService()
        self.use_distributed_locks = True  # Enable distributed locks by default
        self.permission_service = permission_service  # Use centralized permission service

    # ========================================================================
    # Access Control
    # ========================================================================

    async def check_user_has_access(
        self,
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID,
        required_permission: str = "view",
    ) -> bool:
        """
        Check if user has required access to a project.

        DEPRECATED: Use permission_service.can_user_access_project() directly instead.
        This method now delegates to PermissionService for consistency.

        Args:
            db: Database session
            user_id: User ID to check
            project_id: Project ID
            required_permission: Required permission level (view, comment, edit, admin)

        Returns:
            True if user has access, False otherwise
        """
        try:
            # Map string permission to PermissionLevel enum
            from app.models.organization import PermissionLevel

            permission_map = {
                "view": PermissionLevel.VIEW,
                "comment": PermissionLevel.COMMENT,
                "edit": PermissionLevel.EDIT,
                "admin": PermissionLevel.ADMIN,
            }

            required_level = permission_map.get(required_permission.lower())
            if not required_level:
                logger.warning(
                    "invalid_permission_level",
                    required_permission=required_permission,
                )
                return False

            # Delegate to centralized PermissionService
            return await self.permission_service.can_user_access_project(
                db, user_id, project_id, required_level
            )

        except Exception as e:
            logger.error(
                "access_check_failed",
                error=str(e),
                user_id=user_id,
                project_id=project_id,
            )
            return False

    def _check_permission_level(self, current: str, required: str) -> bool:
        """
        Check if current permission level satisfies required level.

        DEPRECATED: Use PermissionService._check_permission_level() instead.

        Permission hierarchy: view < comment < edit < admin

        Args:
            current: Current permission level
            required: Required permission level

        Returns:
            True if current >= required
        """
        levels = {"view": 0, "comment": 1, "edit": 2, "admin": 3}
        return levels.get(current, 0) >= levels.get(required, 0)

    async def get_user_project_permission(
        self, db: AsyncSession, user_id: UUID, project_id: UUID
    ) -> str | None:
        """
        Get user's permission level for a project.

        DEPRECATED: Use permission_service.get_user_permission_level() directly instead.
        This method now delegates to PermissionService for consistency.

        Args:
            db: Database session
            user_id: User ID
            project_id: Project ID

        Returns:
            Permission level string or None if no access
        """
        try:
            # Delegate to centralized PermissionService
            level = await self.permission_service.get_user_permission_level(
                db, user_id, project_id
            )

            if level is None:
                return None

            # Convert PermissionLevel enum to string for backward compatibility
            return level.value

        except Exception as e:
            logger.error(
                "get_permission_level_failed",
                error=str(e),
                user_id=user_id,
                project_id=project_id,
            )
            return None

    # ========================================================================
    # Lock Management
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
        """
        Acquire a lock on a project resource.

        Args:
            db: Database session
            user_id: User requesting lock
            project_id: Project ID
            resource_type: Type of resource (workflow, state, etc.)
            resource_id: ID of specific resource
            duration_minutes: Lock duration in minutes (default 5, max 30)
            metadata: Optional metadata

        Returns:
            ProjectLock if acquired, None if resource is locked by another user
        """
        try:
            # Use SELECT FOR UPDATE to prevent race conditions
            # This ensures atomic check-and-create/update operations
            result = await db.execute(
                select(ProjectLock)
                .filter(
                    and_(
                        ProjectLock.project_id == project_id,
                        ProjectLock.resource_type == ResourceType(resource_type),
                        ProjectLock.resource_id == resource_id,
                    )
                )
                .with_for_update()
            )
            existing_lock = result.scalar_one_or_none()

            if existing_lock:
                # If lock expired, delete it atomically within transaction
                if existing_lock.is_expired():
                    await db.delete(existing_lock)
                    await db.flush()  # Flush to ensure deletion is visible in this transaction
                    logger.info("expired_lock_released", lock_id=existing_lock.id)
                    # Continue to create new lock below
                    existing_lock = None
                elif existing_lock.user_id == user_id:
                    # Extend existing lock
                    existing_lock.extend_lock(duration_minutes)
                    await db.commit()
                    await db.refresh(existing_lock)
                    logger.info(
                        "lock_extended", lock_id=existing_lock.id, user_id=user_id
                    )
                    return existing_lock
                else:
                    # Lock held by another user - check if it's really not expired
                    # (double check within the locked transaction)
                    if not existing_lock.is_expired():
                        logger.warning(
                            "lock_acquisition_failed",
                            project_id=project_id,
                            resource_id=resource_id,
                            holder=existing_lock.user_id,
                            requester=user_id,
                        )
                        await db.rollback()
                        return None

            # Create new lock (either no lock existed or expired lock was deleted)
            if existing_lock is None:
                duration_minutes = min(duration_minutes, 30)  # Max 30 minutes
                expires_at = datetime.utcnow() + timedelta(minutes=duration_minutes)

                lock = ProjectLock(
                    project_id=project_id,
                    user_id=user_id,
                    resource_type=ResourceType(resource_type),
                    resource_id=resource_id,
                    expires_at=expires_at,
                    metadata=metadata,
                )

                db.add(lock)
                await db.commit()
                await db.refresh(lock)

                logger.info(
                    "lock_acquired",
                    lock_id=lock.id,
                    user_id=user_id,
                    project_id=project_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                )

                # Track activity
                await self.track_activity(
                    db,
                    project_id,
                    user_id,
                    ActionType.LOCKED.value,
                    resource_type,
                    resource_id,
                )

                return lock

        except Exception as e:
            logger.error("lock_acquisition_error", error=str(e))
            await db.rollback()
            raise

    async def release_project_lock(
        self, db: AsyncSession, lock_id: UUID, user_id: UUID
    ) -> bool:
        """
        Release a project lock.

        Args:
            db: Database session
            lock_id: Lock ID to release
            user_id: User releasing the lock (must be lock holder)

        Returns:
            True if released, False otherwise
        """
        try:
            result = await db.execute(
                select(ProjectLock).filter(
                    and_(ProjectLock.id == lock_id, ProjectLock.user_id == user_id)
                )
            )
            lock = result.scalar_one_or_none()

            if not lock:
                logger.warning(
                    "lock_not_found_or_unauthorized", lock_id=lock_id, user_id=user_id
                )
                return False

            # Track activity
            await self.track_activity(
                db,
                lock.project_id,
                user_id,
                ActionType.UNLOCKED.value,
                lock.resource_type.value,
                lock.resource_id,
            )

            await db.delete(lock)
            await db.commit()

            logger.info("lock_released", lock_id=lock_id, user_id=user_id)
            return True

        except Exception as e:
            logger.error("lock_release_error", error=str(e))
            await db.rollback()
            return False

    async def release_expired_locks(self, db: AsyncSession) -> int:
        """
        Release all expired locks (background task).

        Args:
            db: Database session

        Returns:
            Number of locks released
        """
        try:
            result = await db.execute(
                select(ProjectLock).filter(ProjectLock.expires_at < datetime.utcnow())
            )
            expired_locks = result.scalars().all()

            count = 0
            for lock in expired_locks:
                await db.delete(lock)
                count += 1

            await db.commit()

            if count > 0:
                logger.info("expired_locks_released", count=count)

            return count

        except Exception as e:
            logger.error("expired_locks_cleanup_failed", error=str(e))
            await db.rollback()
            return 0

    async def get_resource_lock(
        self,
        db: AsyncSession,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> ProjectLock | None:
        """
        Get current lock for a resource.

        Args:
            db: Database session
            project_id: Project ID
            resource_type: Resource type
            resource_id: Resource ID

        Returns:
            ProjectLock if locked, None otherwise
        """
        result = await db.execute(
            select(ProjectLock).filter(
                and_(
                    ProjectLock.project_id == project_id,
                    ProjectLock.resource_type == ResourceType(resource_type),
                    ProjectLock.resource_id == resource_id,
                )
            )
        )
        lock = result.scalar_one_or_none()

        # Clean up if expired
        if lock and lock.is_expired():
            await db.delete(lock)
            await db.commit()
            return None

        return lock

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
        """
        Acquire a lock on a project resource using distributed locks.

        This is the preferred method for acquiring locks. It uses Redis when available
        for better performance and scalability, with automatic fallback to PostgreSQL.

        Args:
            db: Database session
            user_id: User requesting lock
            project_id: Project ID
            resource_type: Type of resource (workflow, state, etc.)
            resource_id: ID of specific resource
            duration_minutes: Lock duration in minutes (default 5, max 30)
            metadata: Optional metadata

        Returns:
            Lock info dict if acquired, None if resource is locked by another user
        """
        if self.use_distributed_locks:
            try:
                lock_info = await distributed_lock_service.acquire_lock(
                    db=db,
                    user_id=user_id,
                    project_id=project_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    duration_minutes=duration_minutes,
                    metadata=metadata,
                )

                if lock_info:
                    # Track activity
                    await self.track_activity(
                        db,
                        project_id,
                        user_id,
                        ActionType.LOCKED.value,
                        resource_type,
                        resource_id,
                    )

                return lock_info

            except Exception as e:
                logger.error("distributed_lock_error", error=str(e))
                # Fall back to regular lock acquisition
                logger.warning("falling_back_to_regular_lock")
                return await self._lock_to_dict(
                    await self.acquire_project_lock(
                        db,
                        user_id,
                        project_id,
                        resource_type,
                        resource_id,
                        duration_minutes,
                        metadata,
                    )
                )
        else:
            # Use original PostgreSQL-only implementation
            return await self._lock_to_dict(
                await self.acquire_project_lock(
                    db,
                    user_id,
                    project_id,
                    resource_type,
                    resource_id,
                    duration_minutes,
                    metadata,
                )
            )

    async def release_resource_lock(
        self,
        db: AsyncSession,
        lock_id: UUID,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        """
        Release a resource lock using distributed locks.

        This is the preferred method for releasing locks.

        Args:
            db: Database session
            lock_id: Lock ID to release
            user_id: User releasing the lock
            project_id: Project ID
            resource_type: Resource type
            resource_id: Resource ID

        Returns:
            True if released, False otherwise
        """
        if self.use_distributed_locks:
            try:
                success = await distributed_lock_service.release_lock(
                    db=db,
                    lock_id=lock_id,
                    user_id=user_id,
                    project_id=project_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                )

                if success:
                    # Track activity
                    await self.track_activity(
                        db,
                        project_id,
                        user_id,
                        ActionType.UNLOCKED.value,
                        resource_type,
                        resource_id,
                    )

                return success

            except Exception as e:
                logger.error("distributed_unlock_error", error=str(e))
                # Fall back to regular unlock
                return await self.release_project_lock(db, lock_id, user_id)
        else:
            # Use original PostgreSQL-only implementation
            return await self.release_project_lock(db, lock_id, user_id)

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
        """
        Refresh/extend a lock's expiration time (heartbeat).

        Frontend should call this every 4 minutes for 5-minute locks to prevent
        lock expiration during active editing.

        Args:
            db: Database session
            lock_id: Lock ID to refresh
            user_id: User owning the lock
            project_id: Project ID
            resource_type: Resource type
            resource_id: Resource ID
            duration_minutes: New duration in minutes (default 5)

        Returns:
            True if refreshed, False if lock not found or not owned by user
        """
        if self.use_distributed_locks:
            try:
                return await distributed_lock_service.refresh_lock(
                    db=db,
                    lock_id=lock_id,
                    user_id=user_id,
                    project_id=project_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    duration_minutes=duration_minutes,
                )
            except Exception as e:
                logger.error("distributed_lock_refresh_error", error=str(e))
                return False
        else:
            # Fallback to DB-only refresh
            try:
                result = await db.execute(
                    select(ProjectLock).filter(
                        and_(ProjectLock.id == lock_id, ProjectLock.user_id == user_id)
                    )
                )
                lock = result.scalar_one_or_none()

                if not lock:
                    return False

                lock.extend_lock(duration_minutes)
                await db.commit()
                logger.info(
                    "lock_refreshed", lock_id=str(lock_id), user_id=str(user_id)
                )
                return True

            except Exception as e:
                logger.error("lock_refresh_error", error=str(e))
                await db.rollback()
                return False

    def _lock_to_dict(self, lock: ProjectLock | None) -> dict[str, Any] | None:
        """
        Convert ProjectLock model to dict format for API consistency.

        Args:
            lock: ProjectLock model or None

        Returns:
            Dict with lock info or None
        """
        if not lock:
            return None

        return {
            "lock_id": str(lock.id),
            "user_id": str(lock.user_id),
            "project_id": lock.project_id,
            "resource_type": lock.resource_type.value,
            "resource_id": lock.resource_id,
            "expires_at": lock.expires_at.isoformat(),
            "backend": "postgresql",
        }

    # ========================================================================
    # Activity Tracking
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
        """
        Track user activity in a project.

        Args:
            db: Database session
            project_id: Project ID
            user_id: User performing action
            action_type: Type of action
            resource_type: Type of resource
            resource_id: Resource ID
            resource_name: Optional resource name
            changes: Optional change details
            metadata: Optional metadata

        Returns:
            Created ActivityLog
        """
        try:
            activity = ActivityLog.create_activity(
                project_id=project_id,
                user_id=user_id,
                action_type=ActionType(action_type),
                resource_type=ResourceType(resource_type),
                resource_id=resource_id,
                resource_name=resource_name,
                changes=changes,
                metadata=metadata,
            )

            db.add(activity)
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

    # ========================================================================
    # Email Notifications
    # ========================================================================

    async def send_invitation_email(
        self, invitation: OrganizationInvitation, organization: Organization
    ) -> bool:
        """
        Send organization invitation email.

        Args:
            invitation: Invitation object
            organization: Organization object

        Returns:
            True if sent successfully
        """
        try:
            # Generate invitation URL
            from app.core.config import settings

            invitation_url = (
                f"{settings.FRONTEND_URL}/invitations/accept?token={invitation.token}"
            )

            # Render email template
            html_body = self.email_templates.render_template(
                "organization_invitation",
                {
                    "organization_name": organization.name,
                    "organization_description": organization.description or "",
                    "role": invitation.role,
                    "invitation_url": invitation_url,
                    "expires_at": invitation.expires_at.strftime("%B %d, %Y"),
                },
            )

            # Send email
            success = await self.email_transport.send_email(
                to_email=invitation.email,
                subject=f"You've been invited to join {organization.name} on Qontinui",
                text_body=f"You've been invited to join {organization.name}. Visit {invitation_url} to accept.",
                html_body=html_body,
            )

            if success:
                logger.info(
                    "invitation_email_sent",
                    email=invitation.email,
                    organization_id=organization.id,
                )
            else:
                logger.error(
                    "invitation_email_failed",
                    email=invitation.email,
                    organization_id=organization.id,
                )

            return success

        except Exception as e:
            logger.error("invitation_email_error", error=str(e))
            return False

    async def send_project_share_email(
        self,
        to_email: str,
        to_name: str,
        project_name: str,
        shared_by_name: str,
        permission_level: str,
    ) -> bool:
        """
        Send project sharing notification email.

        Args:
            to_email: Recipient email
            to_name: Recipient name
            project_name: Project name
            shared_by_name: Name of user sharing
            permission_level: Permission level granted

        Returns:
            True if sent successfully
        """
        try:
            from app.core.config import settings

            project_url = f"{settings.FRONTEND_URL}/projects"

            html_body = self.email_templates.render_template(
                "project_shared",
                {
                    "recipient_name": to_name,
                    "project_name": project_name,
                    "shared_by": shared_by_name,
                    "permission": permission_level,
                    "project_url": project_url,
                },
            )

            success = await self.email_transport.send_email(
                to_email=to_email,
                subject=f"{shared_by_name} shared '{project_name}' with you",
                text_body=f"{shared_by_name} has shared the project '{project_name}' with you. You have {permission_level} access.",
                html_body=html_body,
            )

            if success:
                logger.info(
                    "project_share_email_sent", email=to_email, project=project_name
                )
            else:
                logger.error("project_share_email_failed", email=to_email)

            return success

        except Exception as e:
            logger.error("project_share_email_error", error=str(e))
            return False


# Global instance
collaboration_service = CollaborationService()
