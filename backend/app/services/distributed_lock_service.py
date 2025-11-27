"""
Distributed lock service with Redis and PostgreSQL fallback.

Provides distributed locking capabilities using Redis (preferred) or PostgreSQL (fallback).
Redis locks are faster and more scalable for distributed systems.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import structlog
from redis import asyncio as aioredis
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_config import RedisConfig
from app.core.config import settings
from app.models.collaboration import ProjectLock, ResourceType

logger = structlog.get_logger(__name__)


class DistributedLockService:
    """
    Distributed lock service with Redis and PostgreSQL backends.

    Uses Redis for distributed locks when available, falls back to PostgreSQL.
    Redis provides better performance and TTL-based expiration.
    """

    def __init__(self):
        """Initialize distributed lock service."""
        self._redis_available = None
        self._redis_client = None

    async def _get_redis_client(self) -> aioredis.Redis | None:
        """
        Get Redis client if available.

        Returns:
            Redis client or None if Redis is disabled/unavailable
        """
        if not settings.REDIS_ENABLED:
            return None

        if self._redis_client is None:
            try:
                self._redis_client = await RedisConfig.get_client()
                # Test connection
                await self._redis_client.ping()
                self._redis_available = True
                logger.info("redis_lock_backend_enabled")
            except Exception as e:
                logger.warning("redis_unavailable_falling_back_to_db", error=str(e))
                self._redis_available = False
                self._redis_client = None

        return self._redis_client if self._redis_available else None

    def _make_lock_key(
        self, project_id: UUID, resource_type: str, resource_id: str
    ) -> str:
        """
        Generate Redis key for a lock.

        Args:
            project_id: Project ID
            resource_type: Resource type
            resource_id: Resource ID

        Returns:
            Redis key string
        """
        return f"lock:{project_id}:{resource_type}:{resource_id}"

    def _make_lock_value(self, user_id: UUID, lock_id: UUID) -> str:
        """
        Generate lock value with user and lock identifiers.

        Args:
            user_id: User ID owning the lock
            lock_id: Unique lock ID

        Returns:
            Lock value string
        """
        return f"{user_id}:{lock_id}"

    def _parse_lock_value(self, value: str) -> tuple[UUID, UUID]:
        """
        Parse lock value to extract user and lock IDs.

        Args:
            value: Lock value string

        Returns:
            Tuple of (user_id, lock_id)
        """
        parts = value.split(":")
        return UUID(parts[0]), UUID(parts[1])

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
        Acquire a distributed lock on a resource.

        Tries Redis first, falls back to PostgreSQL if Redis is unavailable.

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
            Lock info contains: lock_id, user_id, expires_at, backend
        """
        duration_minutes = min(duration_minutes, 30)  # Max 30 minutes

        redis = await self._get_redis_client()

        if redis:
            return await self._acquire_redis_lock(
                redis,
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

    async def _acquire_redis_lock(
        self,
        redis: aioredis.Redis,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
        duration_minutes: int,
        metadata: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Acquire lock using Redis backend."""
        try:
            lock_key = self._make_lock_key(project_id, resource_type, resource_id)
            lock_id = uuid4()
            lock_value = self._make_lock_value(user_id, lock_id)
            ttl_seconds = duration_minutes * 60

            # Check if lock exists
            existing_value = await redis.get(lock_key)

            if existing_value:
                # Parse existing lock
                existing_user_id, existing_lock_id = self._parse_lock_value(
                    existing_value
                )

                if existing_user_id == user_id:
                    # Extend existing lock (refresh TTL)
                    await redis.expire(lock_key, ttl_seconds)
                    ttl = await redis.ttl(lock_key)
                    expires_at = datetime.utcnow() + timedelta(seconds=ttl)

                    logger.info(
                        "redis_lock_extended",
                        lock_id=str(existing_lock_id),
                        user_id=str(user_id),
                        project_id=project_id,
                    )

                    return {
                        "lock_id": str(existing_lock_id),
                        "user_id": str(user_id),
                        "project_id": project_id,
                        "resource_type": resource_type,
                        "resource_id": resource_id,
                        "expires_at": expires_at.isoformat(),
                        "backend": "redis",
                    }
                else:
                    # Lock held by another user
                    logger.warning(
                        "redis_lock_acquisition_failed",
                        project_id=project_id,
                        resource_id=resource_id,
                        holder=str(existing_user_id),
                        requester=str(user_id),
                    )
                    return None

            # Acquire new lock with SETNX (atomic set-if-not-exists)
            acquired = await redis.set(lock_key, lock_value, nx=True, ex=ttl_seconds)

            if acquired:
                expires_at = datetime.utcnow() + timedelta(minutes=duration_minutes)

                logger.info(
                    "redis_lock_acquired",
                    lock_id=str(lock_id),
                    user_id=str(user_id),
                    project_id=project_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                )

                return {
                    "lock_id": str(lock_id),
                    "user_id": str(user_id),
                    "project_id": project_id,
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "expires_at": expires_at.isoformat(),
                    "backend": "redis",
                }
            else:
                # Race condition - another process acquired lock
                logger.warning(
                    "redis_lock_race_condition",
                    project_id=project_id,
                    resource_id=resource_id,
                )
                return None

        except Exception as e:
            logger.error("redis_lock_error", error=str(e))
            # Redis error - don't raise, caller can retry with DB backend
            return None

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
        """Acquire lock using PostgreSQL backend with SELECT FOR UPDATE."""
        try:
            # Use SELECT FOR UPDATE to prevent race conditions
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
                # If lock expired, delete it atomically
                if existing_lock.is_expired():
                    await db.delete(existing_lock)
                    await db.flush()
                    existing_lock = None
                elif existing_lock.user_id == user_id:
                    # Extend existing lock
                    existing_lock.extend_lock(duration_minutes)
                    await db.commit()
                    await db.refresh(existing_lock)

                    logger.info(
                        "db_lock_extended",
                        lock_id=str(existing_lock.id),
                        user_id=str(user_id),
                    )

                    return {
                        "lock_id": str(existing_lock.id),
                        "user_id": str(user_id),
                        "project_id": project_id,
                        "resource_type": resource_type,
                        "resource_id": resource_id,
                        "expires_at": existing_lock.expires_at.isoformat(),
                        "backend": "postgresql",
                    }
                else:
                    # Lock held by another user
                    if not existing_lock.is_expired():
                        logger.warning(
                            "db_lock_acquisition_failed",
                            project_id=project_id,
                            resource_id=resource_id,
                            holder=str(existing_lock.user_id),
                            requester=str(user_id),
                        )
                        await db.rollback()
                        return None

            # Create new lock
            if existing_lock is None:
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
                    "db_lock_acquired",
                    lock_id=str(lock.id),
                    user_id=str(user_id),
                    project_id=project_id,
                )

                return {
                    "lock_id": str(lock.id),
                    "user_id": str(user_id),
                    "project_id": project_id,
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "expires_at": expires_at.isoformat(),
                    "backend": "postgresql",
                }

            return None

        except Exception as e:
            logger.error("db_lock_error", error=str(e))
            await db.rollback()
            raise

    async def release_lock(
        self,
        db: AsyncSession,
        lock_id: UUID,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        """
        Release a distributed lock.

        Tries Redis first, falls back to PostgreSQL.

        Args:
            db: Database session
            lock_id: Lock ID to release
            user_id: User releasing the lock (must be lock holder)
            project_id: Project ID
            resource_type: Resource type
            resource_id: Resource ID

        Returns:
            True if released, False otherwise
        """
        redis = await self._get_redis_client()

        if redis:
            return await self._release_redis_lock(
                redis, lock_id, user_id, project_id, resource_type, resource_id
            )
        else:
            return await self._release_db_lock(db, lock_id, user_id)

    async def _release_redis_lock(
        self,
        redis: aioredis.Redis,
        lock_id: UUID,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        """Release lock using Redis backend."""
        try:
            lock_key = self._make_lock_key(project_id, resource_type, resource_id)
            existing_value = await redis.get(lock_key)

            if not existing_value:
                logger.warning("redis_lock_not_found", lock_id=str(lock_id))
                return False

            # Verify user owns the lock
            lock_user_id, lock_lock_id = self._parse_lock_value(existing_value)

            if lock_user_id != user_id or lock_lock_id != lock_id:
                logger.warning(
                    "redis_lock_release_unauthorized",
                    lock_id=str(lock_id),
                    user_id=str(user_id),
                )
                return False

            # Delete the lock
            await redis.delete(lock_key)

            logger.info(
                "redis_lock_released", lock_id=str(lock_id), user_id=str(user_id)
            )
            return True

        except Exception as e:
            logger.error("redis_lock_release_error", error=str(e))
            return False

    async def _release_db_lock(
        self, db: AsyncSession, lock_id: UUID, user_id: UUID
    ) -> bool:
        """Release lock using PostgreSQL backend."""
        try:
            result = await db.execute(
                select(ProjectLock).filter(
                    and_(ProjectLock.id == lock_id, ProjectLock.user_id == user_id)
                )
            )
            lock = result.scalar_one_or_none()

            if not lock:
                logger.warning(
                    "db_lock_not_found_or_unauthorized", lock_id=str(lock_id)
                )
                return False

            await db.delete(lock)
            await db.commit()

            logger.info("db_lock_released", lock_id=str(lock_id), user_id=str(user_id))
            return True

        except Exception as e:
            logger.error("db_lock_release_error", error=str(e))
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
        Refresh/extend a lock's expiration time.

        Used for lock heartbeat to prevent expiration during active editing.
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
        duration_minutes = min(duration_minutes, 30)  # Max 30 minutes
        redis = await self._get_redis_client()

        if redis:
            return await self._refresh_redis_lock(
                redis,
                lock_id,
                user_id,
                project_id,
                resource_type,
                resource_id,
                duration_minutes,
            )
        else:
            return await self._refresh_db_lock(db, lock_id, user_id, duration_minutes)

    async def _refresh_redis_lock(
        self,
        redis: aioredis.Redis,
        lock_id: UUID,
        user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
        duration_minutes: int,
    ) -> bool:
        """Refresh lock using Redis backend."""
        try:
            lock_key = self._make_lock_key(project_id, resource_type, resource_id)
            existing_value = await redis.get(lock_key)

            if not existing_value:
                logger.warning("redis_lock_refresh_not_found", lock_id=str(lock_id))
                return False

            # Verify user owns the lock
            lock_user_id, lock_lock_id = self._parse_lock_value(existing_value)

            if lock_user_id != user_id or lock_lock_id != lock_id:
                logger.warning(
                    "redis_lock_refresh_unauthorized",
                    lock_id=str(lock_id),
                    user_id=str(user_id),
                )
                return False

            # Refresh TTL
            ttl_seconds = duration_minutes * 60
            await redis.expire(lock_key, ttl_seconds)

            logger.info(
                "redis_lock_refreshed", lock_id=str(lock_id), user_id=str(user_id)
            )
            return True

        except Exception as e:
            logger.error("redis_lock_refresh_error", error=str(e))
            return False

    async def _refresh_db_lock(
        self, db: AsyncSession, lock_id: UUID, user_id: UUID, duration_minutes: int
    ) -> bool:
        """Refresh lock using PostgreSQL backend."""
        try:
            result = await db.execute(
                select(ProjectLock).filter(
                    and_(ProjectLock.id == lock_id, ProjectLock.user_id == user_id)
                )
            )
            lock = result.scalar_one_or_none()

            if not lock:
                logger.warning("db_lock_refresh_not_found", lock_id=str(lock_id))
                return False

            lock.extend_lock(duration_minutes)
            await db.commit()

            logger.info("db_lock_refreshed", lock_id=str(lock_id), user_id=str(user_id))
            return True

        except Exception as e:
            logger.error("db_lock_refresh_error", error=str(e))
            await db.rollback()
            return False


# Global instance
distributed_lock_service = DistributedLockService()
