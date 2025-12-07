"""
Token blacklist service with Redis support and in-memory fallback.

This service manages blacklisted JWT tokens for logout functionality.
When Redis is enabled, tokens are stored in Redis with automatic TTL expiration.
When Redis is disabled, tokens are stored in memory with manual cleanup.
"""

import threading
from datetime import datetime

import structlog
from redis import asyncio as aioredis

from app.config.redis_config import RedisConfig
from app.core.config import settings

logger = structlog.get_logger(__name__)


class TokenBlacklistService:
    """
    Token blacklist service with Redis support and in-memory fallback.

    Uses Redis when REDIS_ENABLED=True for production reliability.
    Falls back to in-memory storage when Redis is disabled or unavailable.
    """

    def __init__(self):
        self._blacklist: set[str] = set()
        self._lock = threading.Lock()
        self._token_expiry: dict[str, datetime] = {}
        self._redis_available = settings.REDIS_ENABLED
        self._redis_prefix = "token_blacklist:"

    async def _get_redis_client(self) -> aioredis.Redis | None:
        """Get Redis client if available."""
        if not self._redis_available:
            return None

        try:
            return await RedisConfig.get_client()
        except Exception as e:
            logger.warning("redis_unavailable", error=str(e))
            self._redis_available = False
            return None

    async def blacklist_token(
        self, token_jti: str, expiry: datetime | None = None
    ) -> bool:
        """
        Add a token to the blacklist.

        Args:
            token_jti: JWT ID (jti claim) to blacklist
            expiry: Token expiration datetime (used for TTL in Redis)

        Returns:
            True if token was blacklisted successfully
        """
        # Try Redis first if enabled
        redis_client = await self._get_redis_client()
        if redis_client:
            try:
                key = f"{self._redis_prefix}{token_jti}"

                # Calculate TTL in seconds
                if expiry:
                    ttl = int((expiry - datetime.utcnow()).total_seconds())
                    # Only set if not already expired
                    if ttl > 0:
                        await redis_client.setex(key, ttl, "1")
                        logger.info("token_blacklisted_redis", jti=token_jti, ttl=ttl)
                        return True
                else:
                    # No expiry provided, use default 7 days
                    await redis_client.setex(key, 604800, "1")
                    logger.info("token_blacklisted_redis", jti=token_jti, ttl=604800)
                    return True
            except Exception as e:
                logger.error(
                    "redis_blacklist_error",
                    error=str(e),
                    jti=token_jti,
                    fallback="in_memory",
                )
                # Fall through to in-memory storage

        # Fall back to in-memory storage
        with self._lock:
            self._blacklist.add(token_jti)
            if expiry:
                self._token_expiry[token_jti] = expiry
            logger.info("token_blacklisted_memory", jti=token_jti)
            return True

    async def is_blacklisted(self, token_jti: str) -> bool:
        """
        Check if a token is blacklisted.

        Args:
            token_jti: JWT ID (jti claim) to check

        Returns:
            True if token is blacklisted
        """
        # Try Redis first if enabled
        redis_client = await self._get_redis_client()
        if redis_client:
            try:
                key = f"{self._redis_prefix}{token_jti}"
                result = await redis_client.exists(key)
                return bool(result)
            except Exception as e:
                logger.error(
                    "redis_check_error",
                    error=str(e),
                    jti=token_jti,
                    fallback="in_memory",
                )
                # Fall through to in-memory check

        # Fall back to in-memory storage
        with self._lock:
            return token_jti in self._blacklist

    async def clean_expired_tokens(self) -> int:
        """
        Clean expired tokens from the blacklist.

        For Redis: This is handled automatically by TTL, returns 0.
        For in-memory: Manually removes expired tokens.

        Returns:
            Number of tokens removed (only for in-memory storage)
        """
        # Redis handles expiration automatically via TTL
        if self._redis_available:
            logger.info("redis_auto_cleanup", message="Redis handles TTL automatically")
            return 0

        # Manual cleanup for in-memory storage
        with self._lock:
            now = datetime.utcnow()
            expired_tokens = [
                jti
                for jti, expiry in self._token_expiry.items()
                if expiry and expiry < now
            ]

            for jti in expired_tokens:
                self._blacklist.discard(jti)
                del self._token_expiry[jti]

            if expired_tokens:
                logger.info("memory_cleanup", tokens_removed=len(expired_tokens))

            return len(expired_tokens)

    async def get_blacklist_size(self) -> int:
        """
        Get the number of blacklisted tokens.

        Returns:
            Number of blacklisted tokens
        """
        # For Redis, count keys with prefix
        redis_client = await self._get_redis_client()
        if redis_client:
            try:
                # Scan for keys with our prefix
                cursor = 0
                count = 0
                while True:
                    cursor, keys = await redis_client.scan(
                        cursor, match=f"{self._redis_prefix}*", count=100
                    )
                    count += len(keys)
                    if cursor == 0:
                        break
                return count
            except Exception as e:
                logger.error("redis_count_error", error=str(e), fallback="in_memory")
                # Fall through to in-memory count

        # Fall back to in-memory storage
        with self._lock:
            return len(self._blacklist)

    async def clear_all(self) -> None:
        """
        Clear all blacklisted tokens.

        Warning: This should only be used for testing purposes.
        """
        # Clear from Redis if enabled
        redis_client = await self._get_redis_client()
        if redis_client:
            try:
                # Delete all keys with our prefix
                cursor = 0
                while True:
                    cursor, keys = await redis_client.scan(
                        cursor, match=f"{self._redis_prefix}*", count=100
                    )
                    if keys:
                        await redis_client.delete(*keys)
                    if cursor == 0:
                        break
                logger.info("redis_blacklist_cleared")
            except Exception as e:
                logger.error("redis_clear_error", error=str(e))

        # Clear in-memory storage
        with self._lock:
            self._blacklist.clear()
            self._token_expiry.clear()
            logger.info("memory_blacklist_cleared")


# Global instance
token_blacklist_service = TokenBlacklistService()
