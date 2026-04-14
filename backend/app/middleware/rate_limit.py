import time

from app.core.config import settings
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Determine storage backend based on configuration
# Use Redis if enabled for scalable, persistent rate limiting across instances
# Fall back to memory storage for development/testing when Redis is disabled
if settings.REDIS_ENABLED:
    storage_uri = (
        f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
    )
else:
    storage_uri = "memory://"


def get_user_identifier(request: Request) -> str:
    """
    Get user ID for authenticated requests, IP for anonymous.

    This enables per-user rate limiting for authenticated users while
    falling back to IP-based limiting for anonymous requests.

    Returns:
        str: "user:{user_id}" for authenticated users, "ip:{ip_address}" for anonymous
    """
    user = getattr(request.state, "user", None)
    if user:
        return f"user:{user.id}"
    return f"ip:{request.client.host}"  # type: ignore[union-attr]


# Create limiter instance
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri=storage_uri,
    headers_enabled=True,
)

# Create user-aware limiter with higher limits for authenticated users
# Note: headers_enabled=False because slowapi has issues injecting headers
# when endpoints return non-Response objects (e.g., Pydantic models/lists)
user_limiter = Limiter(
    key_func=get_user_identifier,
    default_limits=["1000 per hour", "100 per minute"],
    storage_uri=storage_uri,
    headers_enabled=False,
)


# Custom rate limit exceeded handler
async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> Response:
    response = JSONResponse(
        content={
            "error": "RATE_LIMIT_EXCEEDED",
            "message": f"Rate limit exceeded: {exc.detail}",
            "timestamp": time.time(),
        },
        status_code=429,
    )
    response.headers["Retry-After"] = (
        str(exc.retry_after) if hasattr(exc, "retry_after") else "60"
    )
    return response


# Specific limits for different operations
# When rate limiting is disabled, use a no-op limiter approach
_auth_limits = (
    ["5 per minute", "20 per hour"]
    if settings.RATE_LIMIT_ENABLED
    else ["100000 per second"]  # Effectively unlimited
)
_api_limits = (
    ["100 per minute", "1000 per hour"]
    if settings.RATE_LIMIT_ENABLED
    else ["100000 per second"]  # Effectively unlimited
)

auth_limiter = Limiter(
    key_func=get_remote_address,
    default_limits=_auth_limits,  # type: ignore[arg-type]
    storage_uri=storage_uri,
    enabled=settings.RATE_LIMIT_ENABLED,
)

api_limiter = Limiter(
    key_func=get_remote_address,
    default_limits=_api_limits,  # type: ignore[arg-type]
    storage_uri=storage_uri,
    enabled=settings.RATE_LIMIT_ENABLED,
)


def auth_rate_limit(limit_string: str):
    """
    Conditional rate limit decorator for auth endpoints.
    When RATE_LIMIT_ENABLED is False, returns a no-op decorator.
    """
    if settings.RATE_LIMIT_ENABLED:
        return auth_limiter.limit(limit_string)
    else:
        # Return a no-op decorator
        def no_op_decorator(func):
            return func

        return no_op_decorator
