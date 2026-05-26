"""
Redis configuration for caching and Celery.

This module provides Redis client setup and connection management.
"""

from urllib.parse import urlsplit

import structlog
from redis import asyncio as aioredis

from app.core.config import settings

logger = structlog.get_logger(__name__)


def _redacted_target(url: str) -> str:
    """Render a Redis URL as scheme://host:port/path for logging.

    Never logs userinfo (a managed-Redis URL can embed an AuthToken/password).
    """
    try:
        parts = urlsplit(url)
        return f"{parts.scheme}://{parts.hostname}:{parts.port}{parts.path}"
    except Exception:
        return "<unparseable-redis-url>"


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
            # A full REDIS_URL is the canonical input: it carries scheme (redis:// or
            # rediss:// for TLS), auth, host, port, and db, so the client is
            # provider-agnostic and works with managed Redis that requires TLS +
            # AuthToken. REDIS_HOST/PORT/DB remain a local-dev fallback when unset.
            redis_url = settings.REDIS_URL or (
                f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
            )

            cls._client = await aioredis.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True,
                max_connections=100,
                # Robustness: bound connect/op latency and self-heal idle/broken
                # connections instead of hanging the WS registration path.
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
                health_check_interval=30,
            )
            # Log only the non-secret target (scheme/host/port) — the URL may embed
            # an auth token.
            logger.info("redis_client_initialized", redis_target=_redacted_target(redis_url))

        return cls._client

    @classmethod
    async def close(cls):
        """Close Redis connection."""
        if cls._client:
            await cls._client.close()
            cls._client = None
            logger.info("redis_client_closed")


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
