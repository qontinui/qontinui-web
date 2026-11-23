import functools
import hashlib
import logging
import time

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from app.core.config import settings

logger = logging.getLogger(__name__)

# Determine storage backend based on configuration
# Use Redis if enabled for scalable, persistent rate limiting across instances
# Fall back to memory storage for development/testing when Redis is disabled
if settings.REDIS_ENABLED:
    # REDIS_URL is canonical and takes precedence over REDIS_HOST/PORT/DB
    # (mirrors RedisConfig + the ARQ pool). It carries scheme/TLS/auth, so
    # the limiter works against managed Redis (Upstash/ElastiCache) that
    # requires rediss:// + an AuthToken; localhost:6379 is the dev fallback.
    storage_uri = settings.REDIS_URL or (
        f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
    )
else:
    storage_uri = "memory://"


def _peer_key(request: Request) -> str:
    """``peer:<address>`` for the address the nearest proxy saw.

    The RIGHTMOST ``X-Forwarded-For`` entry (the one the ALB appended, which a
    client cannot forge), else the socket peer when the request arrived with
    no forwarded header — see
    :func:`app.middleware.logging_middleware.peer_ip_from`. Keying on the
    LEFTMOST entry would let a caller pick a fresh bucket per request, and
    keying on ``request.client.host`` behind the ALB would put every caller
    reaching one ALB node into one bucket.
    """
    from app.middleware.logging_middleware import peer_ip_from

    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    peer = peer_ip_from(request.headers.get("x-forwarded-for"), host)
    return f"peer:{peer or 'unknown'}"


def _bearer_key(request: Request) -> str | None:
    """``bearer:<digest>`` for a request carrying ``Authorization: Bearer``,
    else ``None``.

    The token is HASHED, never decoded: this must not become a second,
    unverified token parser, and the digest keeps a bearer out of log lines
    and Redis keys. Tokens rotate roughly hourly, which is far longer than any
    per-minute window keyed off them. Because the key is the token, not the
    user id, two logins of the same user (an operator's browser and an agent's
    own login) get separate buckets.
    """
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header[:7].lower() == "bearer " else ""
    if token:
        return "bearer:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
    return None


def get_user_identifier(request: Request) -> str:
    """Per-CALLER bucket for ``user_limiter``: the bearer when there is one,
    else the peer.

    Returns ``bearer:<digest>`` for a request carrying a bearer token, and
    ``peer:<rightmost X-Forwarded-For>`` (see :func:`_peer_key`) for one that
    does not. It deliberately does NOT read ``request.state.user``: nothing in
    the app sets it, and slowapi calls a key function inside the endpoint
    wrapper with only the raw request in hand. Reading it was why this used to
    return ``ip:{client.host}`` for every request — one bucket per ALB node,
    shared by every user, agent browser and runner.

    **Do not rename the ``request`` parameter** (see
    :func:`get_authorization_identifier`).
    """
    return _bearer_key(request) or _peer_key(request)


def get_authorization_identifier(request: Request) -> str:
    """Per-CALLER rate-limit bucket for bearer-authenticated admin routes.

    Same problem ``_get_refresh_token_subject`` (below) solves for the
    refresh endpoint: behind Vercel/ALB every request arrives from a handful
    of source IPs, so an IP-keyed limit collapses every operator into one
    bucket and one person's cleanup run throttles everybody else's.

    Superuser-gated routes always carry ``Authorization: Bearer <token>``,
    so the token identifies the caller (see :func:`_bearer_key`). With no
    bearer it falls back to the peer (see :func:`_peer_key`) — an
    unauthenticated caller never reaches these routes, so that arm only covers
    oddities like a probe.

    **Do not rename the ``request`` parameter.** slowapi decides whether to
    call a key function with the request or with no arguments by looking for
    a parameter literally named ``"request"``
    (``Limiter.__evaluate_limits`` -> ``inspect.signature(lim.key_func)``).
    Renaming it would silently switch slowapi to calling this with zero args
    and raise inside the limiter rather than here.
    """
    return _bearer_key(request) or _peer_key(request)


def get_peer_ip_identifier(request: Request) -> str:
    """Per-PEER bucket for unauthenticated public reads (see :func:`_peer_key`).

    **Do not rename the ``request`` parameter** (see
    :func:`get_authorization_identifier`).
    """
    return _peer_key(request)


# The app-wide limiter (``app.state.limiter``), keyed per peer.
limiter = Limiter(
    key_func=get_peer_ip_identifier,
    default_limits=["200 per day", "50 per hour"],
    storage_uri=storage_uri,
    headers_enabled=True,
)

# Per-caller limiter: keyed on the bearer digest, else the peer (see
# ``get_user_identifier``). It does not key on the user id, so two logins of
# one user are two buckets.
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
    key_func=get_peer_ip_identifier,
    default_limits=_auth_limits,  # type: ignore[arg-type]
    storage_uri=storage_uri,
    enabled=settings.RATE_LIMIT_ENABLED,
)

api_limiter = Limiter(
    key_func=get_peer_ip_identifier,
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
    available synchronously in slowapi's key function, so we fall back to the
    peer (see :func:`_peer_key`). The endpoint limit is set high enough
    (60/min) that shared-peer mobile traffic still has headroom.
    """
    try:
        token = request.cookies.get("refresh_token")
        if token:
            import jwt

            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM],
            )
            sub = payload.get("sub")
            if sub:
                return f"refresh-user:{sub}"
    except Exception:
        pass
    return _peer_key(request)


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
