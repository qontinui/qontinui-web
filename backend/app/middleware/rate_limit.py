import functools
import hashlib
import time
from typing import Any

import structlog
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings

logger = structlog.get_logger(__name__)

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


def get_authorization_identifier(request: Request) -> str:
    """Per-CALLER rate-limit bucket for bearer-authenticated admin routes.

    Same problem ``_get_refresh_token_subject`` (below) solves for the
    refresh endpoint: behind Vercel/ALB every request arrives from a handful
    of source IPs, so an IP-keyed limit collapses every operator into one
    bucket and one person's cleanup run throttles everybody else's. It is
    also the reason ``get_user_identifier`` is not enough here — it reads
    ``request.state.user``, which the limiter's key function is called too
    early to see (slowapi evaluates the limit inside the endpoint wrapper,
    with only the raw request in hand).

    Superuser-gated routes always carry ``Authorization: Bearer <token>``,
    so the token identifies the caller. It is HASHED, never decoded: this
    must not become a second, unverified token parser, and the digest keeps
    a bearer out of log lines and Redis keys. Tokens rotate roughly hourly,
    which is far longer than any per-minute window keyed off them.

    Falls back to the client IP when there is no bearer — an unauthenticated
    caller never reaches these routes, so that arm only covers oddities like
    a probe.

    **Do not rename the ``request`` parameter.** slowapi decides whether to
    call a key function with the request or with no arguments by looking for
    a parameter literally named ``"request"``
    (``Limiter.__evaluate_limits`` -> ``inspect.signature(lim.key_func)``).
    Renaming it would silently switch slowapi to calling this with zero args
    and raise inside the limiter rather than here.
    """
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header[:7].lower() == "bearer " else ""
    if token:
        return "bearer:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    return f"ip:{host or 'unknown'}"


def get_peer_ip_identifier(request: Request) -> str:
    """Per-PEER bucket for unauthenticated public reads.

    The rightmost ``X-Forwarded-For`` entry (the address the ALB saw, which a
    client cannot forge), else the socket peer — see
    ``app.middleware.logging_middleware.peer_ip_from``. Keying on the LEFTMOST
    entry would let a caller pick a fresh bucket per request.

    **Do not rename the ``request`` parameter** (see
    :func:`get_authorization_identifier`).
    """
    from app.middleware.logging_middleware import peer_ip_from

    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    peer = peer_ip_from(request.headers.get("x-forwarded-for"), host)
    return f"peer:{peer or 'unknown'}"


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


#: What a rate-limit key's prefix says it is keyed on. Every key function in
#: this module prefixes its key (``bearer:<digest>``, ``peer:<addr>``,
#: ``user:<id>``, ``refresh-user:<sub>``, ``ip:<addr>``) except slowapi's own
#: ``get_remote_address``, which answers a bare address.
_KEY_KIND_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("bearer:", "bearer"),
    ("peer:", "peer"),
    ("user:", "user"),
    ("refresh-user:", "user"),
    ("ip:", "ip"),
)


def _refusal_key_kind(request: Request, key_func: Any) -> str:
    """``user`` | ``bearer`` | ``peer`` | ``ip`` — what the refusing bucket is
    keyed on — or ``unknown`` when that cannot be said.

    Derived from the limit's own key function, by re-deriving the key it
    computed for this request and reading the key's KIND off its prefix. The
    function's name is not enough: ``get_user_identifier`` keys on the socket
    address whenever ``request.state.user`` is unset (which, before the limiter
    runs, it always is), and a header naming it ``user`` would point a reader at
    a per-user bucket that does not exist. The key itself never leaves this
    function — it is a bearer digest, an address or a user id.
    """
    if key_func is get_remote_address:
        return "ip"
    try:
        key = str(key_func(request))
    except Exception:
        return "unknown"
    for prefix, kind in _KEY_KIND_BY_PREFIX:
        if key.startswith(prefix):
            return kind
    return "unknown"


def _refusal_lane(request: Request, limit: Any) -> str:
    """The limit's scope when it has one, else the ROUTE TEMPLATE
    (``/api/v1/users/me``, ``/items/{item_id}``) — never the concrete path,
    which can carry an id. ``unknown`` when neither is readable."""
    try:
        scope = limit.scope
    except Exception:
        # slowapi evaluates a callable scope against a global it never
        # defines; no limit here declares one, and a refusal must still answer.
        scope = ""
    if isinstance(scope, str) and scope:
        return scope
    route = request.scope.get("route")
    template = getattr(route, "path", None)
    return template if isinstance(template, str) and template else "unknown"


def _refusal_retry_after(limit: Any) -> str:
    """Seconds until the refusing limit's window has surely rolled over: the
    window's length (``3600`` for ``N per hour``). slowapi's exception carries
    no reset time, and the window length is the bound a caller can wait out.
    ``60`` only when the limit cannot say."""
    try:
        expiry = int(limit.limit.get_expiry())
    except Exception:
        return "60"
    return str(expiry) if expiry > 0 else "60"


def _log_refusal(**fields: str) -> None:
    """Log one ``rate_limit_refused`` line carrying ONLY ``fields``.

    The app's logging chain merges structlog's context into every line, and
    ``RequestIDMiddleware`` binds the caller's ``client_host`` and the concrete
    ``path`` (which can carry an id) there. This line names a lane and a bucket
    kind, never a caller, so the context is set aside for this one call and
    restored after it — the request's later lines keep their correlation.

    The bucket kind is logged as ``bucket_kind``: the log sanitizer redacts
    every field whose name contains ``key``.
    """
    saved = structlog.contextvars.get_contextvars()
    structlog.contextvars.clear_contextvars()
    try:
        logger.warning("rate_limit_refused", **fields)
    finally:
        structlog.contextvars.bind_contextvars(**saved)


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> Response:
    """Answer a refusal with the lane it was refused on.

    Every 429 carries ``X-RateLimit-Lane`` (which limit refused) and
    ``X-RateLimit-Key-Kind`` (what its bucket is keyed on), and logs one
    ``rate_limit_refused`` line with those fields and nothing else
    (``_log_refusal``) — never the key, the token, the address, the user id or
    the concrete path. ``Retry-After`` is the limit's window. Plan
    ``2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429``,
    Phase 2: a refusal that named nothing could not be attributed.
    """
    limit = exc.limit
    lane = _refusal_lane(request, limit)
    key_kind = (
        _refusal_key_kind(request, limit.key_func) if limit is not None else "unknown"
    )
    retry_after = _refusal_retry_after(limit)
    _log_refusal(
        lane=lane,
        bucket_kind=key_kind,
        limit=str(limit.limit) if limit is not None else "unknown",
        method=request.method,
        retry_after=retry_after,
    )
    response = JSONResponse(
        content={
            "error": "RATE_LIMIT_EXCEEDED",
            "message": f"Rate limit exceeded: {exc.detail}",
            "lane": lane,
            "key_kind": key_kind,
            "timestamp": time.time(),
        },
        status_code=429,
    )
    response.headers["Retry-After"] = retry_after
    response.headers["X-RateLimit-Lane"] = lane
    response.headers["X-RateLimit-Key-Kind"] = key_kind
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
