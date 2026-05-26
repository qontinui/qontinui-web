import functools
import logging
import time

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings

logger = logging.getLogger(__name__)

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


def _get_refresh_token_subject(request: Request) -> str:
    """Extract user subject from the refresh token cookie for per-user rate
    limiting.

    All Vercel-proxied traffic arrives from a small pool of ALB IPs, so pure
    IP-based rate limiting collapses every user into one bucket.  When the
    refresh token is in an HttpOnly cookie (web dashboard), we can decode the
    ``sub`` claim synchronously and give each user their own bucket.

    Mobile clients send the token in the POST body instead.  The body isn't
    available synchronously in slowapi's key function, so we fall back to IP.
    The endpoint limit is set high enough (60/min) that shared-IP mobile
    traffic still has headroom.
    """
    try:
        token = request.cookies.get("refresh_token")
        if token:
            from jose import jwt as jose_jwt

            payload = jose_jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM],
            )
            sub = payload.get("sub")
            if sub:
                return f"refresh-user:{sub}"
    except Exception:
        pass
    return f"ip:{get_remote_address(request)}"


refresh_limiter = Limiter(
    key_func=_get_refresh_token_subject,
    default_limits=_auth_limits,  # type: ignore[arg-type]
    storage_uri=storage_uri,
    enabled=settings.RATE_LIMIT_ENABLED,
)


# Loopback hosts treated as "the dev fleet" — exempt from auth rate limits
# in development. The primary runner, every spawned test runner, and the
# supervisor all phone home over 127.0.0.1 on a dev box, so without an
# exemption they share a single 5/min bucket and concurrent test spawns
# starve each other (and the primary). Production traffic is unaffected:
# this only fires when ENVIRONMENT == "development".
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _is_loopback_dev(request: Request) -> bool:
    if settings.ENVIRONMENT != "development":
        return False
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    return host in _LOOPBACK_HOSTS


def auth_rate_limit(limit_string: str):
    """
    Conditional rate limit decorator for auth endpoints.
    When RATE_LIMIT_ENABLED is False, returns a no-op decorator.
    In development, loopback callers bypass the limiter entirely so a fleet
    of dev runners on the same machine doesn't share a single bucket.
    """
    if not settings.RATE_LIMIT_ENABLED:
        # Return a no-op decorator
        def no_op_decorator(func):
            return func

        return no_op_decorator

    base_decorator = auth_limiter.limit(limit_string)

    def conditional_decorator(func):
        limited = base_decorator(func)

        @functools.wraps(limited)
        async def wrapper(*args, **kwargs):
            request = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break
            if request is not None and _is_loopback_dev(request):
                return await func(*args, **kwargs)
            return await limited(*args, **kwargs)

        return wrapper

    return conditional_decorator


def refresh_rate_limit(limit_string: str):
    """Rate limit keyed on the refresh token's user subject, not client IP.

    Behind Vercel/ALB, all traffic shares a handful of source IPs so IP-based
    limits collapse every user into one bucket.  This decorator extracts the
    ``sub`` claim from the refresh token and gives each user their own bucket.
    """
    if not settings.RATE_LIMIT_ENABLED:

        def no_op_decorator(func):
            return func

        return no_op_decorator

    base_decorator = refresh_limiter.limit(limit_string)

    def conditional_decorator(func):
        limited = base_decorator(func)

        @functools.wraps(limited)
        async def wrapper(*args, **kwargs):
            request = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break
            if request is not None and _is_loopback_dev(request):
                return await func(*args, **kwargs)
            return await limited(*args, **kwargs)

        return wrapper

    return conditional_decorator
