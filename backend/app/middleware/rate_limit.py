import time

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Create limiter instance
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://",
    headers_enabled=True,
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
auth_limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["5 per minute", "20 per hour"],
    storage_uri="memory://",
)

api_limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100 per minute", "1000 per hour"],
    storage_uri="memory://",
)
