"""
Locking service for resource locking in collaborative editing.

Provides distributed locking with Redis (preferred) or PostgreSQL (fallback).
Handles lock acquisition, release, extension, and cleanup.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from app.models.collaboration import ProjectLock
from app.repositories.collaboration.lock_repository import lock_repository
from app.services.distributed_lock_service import distributed_lock_service
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class LockingService:
    """Service for resource locking operations."""

    def __init__(self):
        """Initialize locking service."""
        self.use_distributed_locks = True

    async def acquire_lock(
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
        Acquire a lock on a project resource.

        Uses distributed locking when available for better performance.

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
                return lock_info
            except Exception as e:
                logger.error("distributed_lock_error", error=str(e))
                logger.warning("falling_back_to_regular_lock")
                return await self._acquire_db_lock(
                    db,
                    user_id,
                    project_id,
                    resource_type,
                    resource_id,
                    duration_minutes,
                    metadata,
                )
        else:
            return await self._acquire_db_lock(
                db,
                user_id,
                project_id,
                resource_type,
                resource_id,
                duration_minutes,
                metadata,
            )

    async def _acquire_db_lock(
        self,
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
        duration_minutes: int,
        metadata: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Acquire lock using PostgreSQL backend."""
        try:
            # Use SELECT FOR UPDATE to prevent race conditions
            existing_lock = await lock_repository.get_resource_lock_for_update(
                db, project_id, resource_type, resource_id
            )

            if existing_lock:
                if existing_lock.is_expired():
                    await lock_repository.delete_lock(db, existing_lock)
                    logger.info("expired_lock_released", lock_id=existing_lock.id)
                    existing_lock = None
                elif existing_lock.user_id == user_id:
                    # Extend existing lock
                    existing_lock.extend_lock(duration_minutes)
                    await db.commit()
                    await db.refresh(existing_lock)
                    logger.info(
                        "lock_extended", lock_id=existing_lock.id, user_id=user_id
                    )
                    return self._lock_to_dict(existing_lock)
                else:
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

            # Create new lock
            if existing_lock is None:
                duration_minutes = min(duration_minutes, 30)
                expires_at = datetime.now(UTC) + timedelta(minutes=duration_minutes)

                lock = await lock_repository.create_lock(
                    db,
                    project_id=project_id,
                    user_id=user_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    expires_at=expires_at,
                    metadata=metadata,
                )

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

                return self._lock_to_dict(lock)

            return None

        except Exception as e:
            logger.error("lock_acquisition_error", error=str(e))
            await db.rollback()
            raise

    async def release_lock(
        self,
        db: AsyncSession,
        lock_id: UUID,
        user_id: UUID,
        project_id: UUID | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> bool:
        """
        Release a project lock.

        Args:
            db: Database session
            lock_id: Lock ID to release
            user_id: User releasing the lock (must be lock holder)
            project_id: Project ID (required for distributed locks)
            resource_type: Resource type (required for distributed locks)
            resource_id: Resource ID (required for distributed locks)

        Returns:
            True if released, False otherwise
        """
        if self.use_distributed_locks and project_id and resource_type and resource_id:
            try:
                return await distributed_lock_service.release_lock(
                    db=db,
                    lock_id=lock_id,
                    user_id=user_id,
                    project_id=project_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                )
            except Exception as e:
                logger.error("distributed_unlock_error", error=str(e))
                return await self._release_db_lock(db, lock_id, user_id)
        else:
            return await self._release_db_lock(db, lock_id, user_id)

    async def _release_db_lock(
        self, db: AsyncSession, lock_id: UUID, user_id: UUID
    ) -> bool:
        """Release lock using PostgreSQL backend."""
        try:
            lock = await lock_repository.get_lock_by_user(db, lock_id, user_id)

            if not lock:
                logger.warning(
                    "lock_not_found_or_unauthorized", lock_id=lock_id, user_id=user_id
                )
                return False

            await lock_repository.delete_lock(db, lock)
            await db.commit()

            logger.info("lock_released", lock_id=lock_id, user_id=user_id)
            return True

        except Exception as e:
            logger.error("lock_release_error", error=str(e))
            await db.rollback()
            return False

    async def refresh_lock(
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

        Frontend should call this every 4 minutes for 5-minute locks.

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
            return await self._refresh_db_lock(db, lock_id, user_id, duration_minutes)

    async def _refresh_db_lock(
        self, db: AsyncSession, lock_id: UUID, user_id: UUID, duration_minutes: int
    ) -> bool:
        """Refresh lock using PostgreSQL backend."""
        try:
            lock = await lock_repository.get_lock_by_user(db, lock_id, user_id)

            if not lock:
                return False

            lock.extend_lock(duration_minutes)
            await db.commit()
            logger.info("lock_refreshed", lock_id=str(lock_id), user_id=str(user_id))
            return True

        except Exception as e:
            logger.error("lock_refresh_error", error=str(e))
            await db.rollback()
            return False

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
        lock = await lock_repository.get_resource_lock(
            db, project_id, resource_type, resource_id
        )

        # Clean up if expired
        if lock and lock.is_expired():
            await lock_repository.delete_lock(db, lock)
            await db.commit()
            return None

        return lock

    async def get_project_locks(
        self,
        db: AsyncSession,
        project_id: UUID,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[ProjectLock]:
        """
        Get all active locks for a project.

        Args:
            db: Database session
            project_id: Project ID
            resource_type: Optional filter by resource type
            resource_id: Optional filter by resource ID

        Returns:
            List of active (non-expired) locks
        """
        locks = await lock_repository.get_project_locks(
            db, project_id, resource_type, resource_id
        )
        return [lock for lock in locks if not lock.is_expired()]

    async def release_expired_locks(self, db: AsyncSession) -> int:
        """
        Release all expired locks (background task).

        Args:
            db: Database session

        Returns:
            Number of locks released
        """
        try:
            expired_locks = await lock_repository.get_expired_locks(db)

            count = 0
            for lock in expired_locks:
                await lock_repository.delete_lock(db, lock)
                count += 1

            await db.commit()

            if count > 0:
                logger.info("expired_locks_released", count=count)

            return count

        except Exception as e:
            logger.error("expired_locks_cleanup_failed", error=str(e))
            await db.rollback()
            return 0

    def _lock_to_dict(self, lock: ProjectLock | None) -> dict[str, Any] | None:
        """Convert ProjectLock model to dict format for API consistency."""
        if not lock:
            return None

        return {
            "lock_id": str(lock.id),
            "user_id": str(lock.user_id),
            "project_id": lock.project_id,
            "resource_type": lock.resource_type,
            "resource_id": lock.resource_id,
            "expires_at": lock.expires_at.isoformat(),
            "backend": "postgresql",
        }


# Global instance
locking_service = LockingService()
