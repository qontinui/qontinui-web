"""
Redis configuration for caching and Celery.

This module provides Redis client setup and connection management.
"""

import logging

from redis import asyncio as aioredis

from app.core.config import settings

logger = logging.getLogger(__name__)


class RedisConfig:
    """Redis client configuration and connection manager."""

    _client: aioredis.Redis | None = None

    @classmethod
    async def get_client(cls) -> aioredis.Redis:
        """
        Get or create Redis client.

        Returns:
            Redis client instance
        """
        if cls._client is None:
            redis_url = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"

            cls._client = await aioredis.from_url(
                redis_url, encoding="utf-8", decode_responses=True, max_connections=10
            )
            logger.info("Redis client initialized", redis_url=redis_url)

        return cls._client

    @classmethod
    async def close(cls):
        """Close Redis connection."""
        if cls._client:
            await cls._client.close()
            cls._client = None
            logger.info("Redis client closed")


async def get_redis() -> aioredis.Redis:
    """
    Dependency to get Redis client.

    Usage:
        @app.get("/")
        async def endpoint(redis: Redis = Depends(get_redis)):
            await redis.set("key", "value")

    Returns:
        Redis client instance
    """
    return await RedisConfig.get_client()
