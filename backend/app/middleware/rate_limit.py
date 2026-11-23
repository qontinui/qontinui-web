import functools
import hashlib
import inspect
import logging
import math
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

#: slowapi's own refusal line (``Limiter.__evaluate_limits``). It names the
#: bucket KEY (a bearer digest or an address) and the concrete path.
_SLOWAPI_REFUSAL_MSG = "ratelimit %s (%s) exceeded at endpoint: %s"


class _DropSlowapiRefusalLine(logging.Filter):
    """Drops slowapi's per-refusal line and nothing else.

    ``rate_limit_exceeded_handler`` logs every refusal without the key or the
    path (``rate_limit_refused``), so slowapi's line only leaks them. Its
    other records — storage unreachable / recovered, a skipped limit — pass.
    Matched on the unformatted ``record.msg``, which carries no caller data.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return record.msg != _SLOWAPI_REFUSAL_MSG


_slowapi_logger = logging.getLogger("slowapi")
if not any(isinstance(f, _DropSlowapiRefusalLine) for f in _slowapi_logger.filters):
    _slowapi_logger.addFilter(_DropSlowapiRefusalLine())

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
        # slowapi's own dispatch: the request only to a function that declares
        # a parameter named ``request``, else no arguments.
        if "request" in inspect.signature(key_func).parameters:
            key = str(key_func(request))
        else:
            key = str(key_func())
    except Exception:
        return "unknown"
    for prefix, kind in _KEY_KIND_BY_PREFIX:
        if key.startswith(prefix):
            return kind
    return "unknown"


def _refusal_lane(request: Request, limit: Any) -> str:
    """``<limiter>:<scope or route template>``.

    ``<limiter>`` is the name of the module limiter that registered the limit
    (``_module_limiters``), ``unknown`` when none did. Then the limit's scope
    when it has one, else the ROUTE TEMPLATE (``/api/v1/users/me``,
    ``/items/{item_id}``) — never the concrete path, which can carry an id —
    and ``unknown`` when neither is readable.
    """
    holder = _limiter_holding(limit) if limit is not None else None
    return f"{holder[0] if holder is not None else 'unknown'}:{_scope_or_template(request, limit)}"


def _scope_or_template(request: Request, limit: Any) -> str:
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


#: The lane name of each module limiter, by the variable that holds it. A
#: ``Limiter`` assigned in this module without an entry here is reported by
#: ``_module_limiters`` under its variable name, and
#: ``test_every_limiter_in_the_module_is_enumerated_and_named`` fails on it.
_LIMITER_NAMES: dict[str, str] = {
    "limiter": "default",
    "user_limiter": "user",
    "auth_limiter": "auth",
    "api_limiter": "api",
    "refresh_limiter": "refresh",
}


def _module_limiters() -> list[tuple[str, str, Limiter]]:
    """``(variable, lane name, limiter)`` for every ``Limiter`` this module
    holds, read from the module's own namespace rather than a hand list."""
    return [
        (variable, _LIMITER_NAMES.get(variable, variable), value)
        for variable, value in list(globals().items())
        if isinstance(value, Limiter)
    ]


def _group_yields(group: Any, limit: Any) -> bool:
    """Whether a ``LimitGroup`` (a dynamic, callable limit) built ``limit``:
    slowapi makes a fresh ``Limit`` from the group per request, so identity
    cannot match it; the fields the group copies into each ``Limit`` can."""
    return (
        group.key_function is limit.key_func
        and getattr(group, "_LimitGroup__scope", None)
        == getattr(limit, "_Limit__scope", None)
        and group.per_method == limit.per_method
        and group.methods == limit.methods
        and group.cost == limit.cost
    )


def _limiter_holding(limit: Any) -> tuple[str, Limiter] | None:
    """``(lane name, limiter)`` of the module limiter that registered
    ``limit`` — slowapi's exception names the limit, not the limiter whose
    storage counted it. Static limits match by identity, dynamic ones by
    ``_group_yields``."""
    for _variable, name, candidate in _module_limiters():
        for registered in candidate._route_limits.values():
            if any(entry is limit for entry in registered):
                return name, candidate
        for groups in candidate._dynamic_route_limits.values():
            if any(_group_yields(group, limit) for group in groups):
                return name, candidate
    return None


def _refusal_retry_after(request: Request, limit: Any) -> str:
    """Seconds until the refusing bucket admits again.

    Read from the limiter's own storage when it can say: slowapi leaves the
    refused bucket's identifiers on ``request.state.view_rate_limit``, and
    ``get_window_stats`` answers that bucket's reset time. Otherwise the
    window's length (``3600`` for ``N per hour``) — the longest a caller can
    have to wait. ``60`` only when the limit cannot say either. A storage
    error never fails the refusal; it only falls back.
    """
    try:
        window = int(limit.limit.get_expiry())
    except Exception:
        return "60"
    if window <= 0:
        return "60"
    try:
        holder = _limiter_holding(limit)
        item, identifiers = request.state.view_rate_limit
        if holder is not None:
            stats = holder[1].limiter.get_window_stats(item, *identifiers)
            until_reset = math.ceil(stats.reset_time - time.time())
            if 0 < until_reset <= window:
                return str(until_reset)
    except Exception:
        pass
    return str(window)


def _log_refusal(**fields: str) -> None:
    """Log one ``rate_limit_refused`` line carrying ONLY ``fields``.

    The app's logging chain merges structlog's context into every line, and
    ``RequestIDMiddleware`` binds the caller's ``client_host`` and the concrete
    ``path`` (which can carry an id) there. This line names a lane and a bucket
    kind, never a caller, so the context is set aside for this one call and
    restored after it — the request's later lines keep their correlation.
    ``request_id`` alone is kept: it identifies the request, not the caller,
    and joins this line to the request's own started/completed lines.

    The bucket kind is logged as ``bucket_kind``: the log sanitizer redacts
    every field whose name contains ``key``.
    """
    saved = structlog.contextvars.get_contextvars()
    structlog.contextvars.clear_contextvars()
    if "request_id" in saved:
        structlog.contextvars.bind_contextvars(request_id=saved["request_id"])
    try:
        logger.warning("rate_limit_refused", **fields)
    finally:
        structlog.contextvars.bind_contextvars(**saved)


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> Response:
    """Answer a refusal with the lane it was refused on.

    Every 429 carries ``X-RateLimit-Lane`` (which limiter and which limit
    refused, ``_refusal_lane``) and ``X-RateLimit-Key-Kind`` (what its bucket
    is keyed on), and logs one ``rate_limit_refused`` line with those fields,
    plus the request id, and nothing else (``_log_refusal``) — never the key,
    the token, the address, the user id or the concrete path.
    ``Retry-After`` is the seconds until the refused bucket's window resets,
    else the window's length (``_refusal_retry_after``). Plan
    ``2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429``,
    Phase 2: a refusal that named nothing could not be attributed.
    """
    limit = exc.limit
    lane = _refusal_lane(request, limit)
    key_kind = (
        _refusal_key_kind(request, limit.key_func) if limit is not None else "unknown"
    )
    retry_after = _refusal_retry_after(request, limit)
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
