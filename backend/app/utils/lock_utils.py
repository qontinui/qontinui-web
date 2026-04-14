"""
Lock utilities for checking and managing resource locks.

Provides helper functions for REST endpoints to check if resources
are locked before allowing modifications.
"""

from uuid import UUID

import structlog
from app.models.collaboration import ProjectLock
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


async def check_resource_lock(
    db: AsyncSession,
    user_id: UUID,
    project_id: UUID,
    resource_type: str,
    resource_id: str,
) -> tuple[bool, ProjectLock | None]:
    """
    Check if user can modify a resource (owns lock or resource is unlocked).

    Args:
        db: Database session
        user_id: User attempting to modify resource
        project_id: Project ID
        resource_type: Type of resource (workflow, state, project, etc.)
        resource_id: ID of specific resource

    Returns:
        Tuple of (can_modify, lock_object):
        - can_modify: True if user can modify the resource
        - lock_object: ProjectLock if resource is locked, None if unlocked
    """
    try:
        # Check if resource has a lock
        # Pass resource_type as lowercase string to match PostgreSQL enum values
        result = await db.execute(
            select(ProjectLock).filter(
                and_(
                    ProjectLock.project_id == project_id,
                    ProjectLock.resource_type == resource_type.lower(),
                    ProjectLock.resource_id == resource_id,
                )
            )
        )
        lock = result.scalar_one_or_none()

        if not lock:
            # No lock exists - user can modify
            logger.debug(
                "resource_unlocked",
                project_id=project_id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
            return True, None

        # Check if lock is expired
        if lock.is_expired():
            # Expired lock - treat as unlocked
            logger.info(
                "lock_expired_allowing_access",
                lock_id=lock.id,
                user_id=user_id,
                project_id=project_id,
            )
            return True, None

        # Check if user owns the lock
        if lock.user_id == user_id:
            # User owns the lock - can modify
            logger.debug(
                "lock_owned_by_user",
                lock_id=lock.id,
                user_id=user_id,
                project_id=project_id,
            )
            return True, lock

        # Lock is held by another user
        logger.warning(
            "resource_locked_by_another_user",
            lock_id=lock.id,
            lock_holder=lock.user_id,
            requester=user_id,
            project_id=project_id,
            resource_type=resource_type,
            resource_id=resource_id,
        )
        return False, lock

    except Exception as e:
        logger.error(
            "lock_check_failed", error=str(e), user_id=user_id, project_id=project_id
        )
        # Rollback the transaction to clear the failed state
        await db.rollback()
        # On error, be permissive to avoid blocking legitimate operations
        return True, None


async def get_lock_info(lock: ProjectLock, db: AsyncSession) -> dict:
    """
    Get human-readable lock information for error messages.

    Args:
        lock: ProjectLock object
        db: Database session

    Returns:
        Dictionary with lock information
    """
    from app.models.user import User

    try:
        # Get lock holder's information
        result = await db.execute(select(User).where(User.id == lock.user_id))  # type: ignore[arg-type]
        user = result.scalar_one_or_none()

        return {
            "lock_id": str(lock.id),
            "locked_by": user.email if user else "Unknown user",
            "locked_by_id": str(lock.user_id),
            "expires_at": lock.expires_at.isoformat(),
            "resource_type": lock.resource_type,
            "resource_id": lock.resource_id,
        }
    except Exception as e:
        logger.error("failed_to_get_lock_info", error=str(e), lock_id=lock.id)
        return {
            "lock_id": str(lock.id),
            "locked_by": "Unknown user",
            "locked_by_id": str(lock.user_id),
            "expires_at": lock.expires_at.isoformat(),
            "resource_type": lock.resource_type,
            "resource_id": lock.resource_id,
        }
