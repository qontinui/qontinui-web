import functools
import hashlib
import ipaddress
import logging
import time

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from fastapi.security.utils import get_authorization_scheme_param
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import HTTPConnection

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


@functools.lru_cache(maxsize=8)
def _trusted_proxy_networks(
    cidrs: str,
) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    """``settings.RATE_LIMIT_TRUSTED_PROXY_CIDRS`` parsed (validated at
    startup by the setting itself), cached per configured value."""
    return tuple(ipaddress.ip_network(c) for c in cidrs.split(",") if c)


def _ip(address: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """``address`` as an IP (an IPv4-mapped IPv6 address unwrapped to IPv4),
    or ``None`` when it does not parse — a hostname, ``"testclient"``, empty."""
    try:
        ip = ipaddress.ip_address(address or "")
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def _is_trusted_proxy(address: str | None) -> bool:
    ip = _ip(address)
    if ip is None:
        return False
    return any(
        ip in net
        for net in _trusted_proxy_networks(settings.RATE_LIMIT_TRUSTED_PROXY_CIDRS)
    )


def peer_ip(connection: HTTPConnection) -> str:
    """The address a rate limit keys on, for an HTTP request or a WebSocket.

    When the socket peer (``client.host``) is inside
    ``settings.RATE_LIMIT_TRUSTED_PROXY_CIDRS`` — the ALB, reaching the tasks
    from inside the VPC — it is a proxy, and the caller is the RIGHTMOST
    ``X-Forwarded-For`` entry: the one that proxy appended, which a client
    cannot forge (:func:`app.middleware.logging_middleware.peer_ip_from`).
    Every header line is read, so a client-sent line ahead of the proxy's
    changes nothing. From any other socket peer (self-hosted, a directly
    exposed task) the socket peer IS the caller and its ``X-Forwarded-For``
    is its own choice, so the header is ignored. ``"unknown"`` when there is
    neither.

    This is application-level proxy trust, independent of uvicorn's
    ``FORWARDED_ALLOW_IPS`` (which decides whether uvicorn rewrites
    ``client.host`` at all, and is not set in production today).

    Keying on the LEFTMOST entry would let a caller pick a fresh bucket per
    request, and keying on ``client.host`` behind the ALB would put every
    caller reaching one ALB node into one bucket. The WebSocket
    connection-rate limits (``app.websockets.base``, ``automation_ws``) key on
    this too.
    """
    from app.middleware.logging_middleware import peer_ip_from

    client = getattr(connection, "client", None)
    host = getattr(client, "host", None) if client else None
    if not _is_trusted_proxy(host):
        return host or "unknown"
    forwarded = ",".join(connection.headers.getlist("x-forwarded-for")) or None
    return peer_ip_from(forwarded, host) or "unknown"


def _peer_key(request: Request) -> str:
    """``peer:<address>`` for :func:`peer_ip`."""
    return f"peer:{peer_ip(request)}"


def _presented_token(request: Request) -> str | None:
    """The token authentication will USE for this request, or ``None``.

    Mirrors ``CookieOrBearerScheme.__call__`` (``app/auth/config.py``), the
    scheme every fastapi-users dependency (``current_active_user``,
    ``current_superuser`` and everything built on them) extracts its token
    with: the ``access_token`` cookie FIRST, then an ``Authorization: Bearer``
    header parsed exactly as ``OAuth2PasswordBearer`` parses it. Keying on the
    header alone would let a cookie-authenticated caller send a fresh junk
    bearer per request — auth ignores it, the limiter would not — and buy a
    fresh bucket each time. The cookie name is read off the live transport so
    the two cannot drift; ``test_rate_limit_key_functions`` pins the rest of
    the agreement against the scheme itself.
    """
    from app.auth.config import cookie_or_bearer_transport

    cookie = request.cookies.get(cookie_or_bearer_transport.scheme.cookie_name)
    if cookie:
        return cookie
    return _header_bearer_token(request)


def _header_bearer_token(request: Request) -> str | None:
    """The ``Authorization: Bearer`` token, parsed exactly as
    ``OAuth2PasswordBearer`` and ``HTTPBearer`` parse it, or ``None``."""
    scheme, param = get_authorization_scheme_param(request.headers.get("authorization"))
    if scheme.lower() == "bearer" and param:
        return param
    return None


def _bearer_key(request: Request) -> str | None:
    """``bearer:<digest>`` of the token auth uses (see :func:`_presented_token`;
    a cookie-carried token is the same Cognito bearer), else ``None``.

    The token is HASHED, never decoded: this must not become a second,
    unverified token parser, and the digest keeps a bearer out of log lines
    and Redis keys.

    What the limit bounds: each ACCESS TOKEN, not each user. An authenticated
    caller who deliberately mints fresh Cognito access tokens (a new login or
    a refresh-token exchange) gets a fresh bucket per token. A per-user
    (``sub``) ceiling would bound that, but it would also re-merge an agent's
    own login with the operator's into one bucket — the collapse plan
    ``2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429`` D2
    rejects — so the key is the token digest by design. In normal use tokens
    rotate roughly hourly, far longer than any per-minute window keyed off
    them.
    """
    return _digest_key(_presented_token(request))


def _digest_key(token: str | None) -> str | None:
    """``bearer:<sha256[:32]>`` of ``token``, else ``None``."""
    if token:
        return "bearer:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
    return None


def get_user_identifier(request: Request) -> str:
    """Per-CALLER bucket for every route authenticated by fastapi-users:
    ``user_limiter``'s default key, and the explicit key of the operations
    admin routes (exported there as ``get_authorization_identifier``).

    Returns ``bearer:<digest>`` of the token authentication uses (the
    ``access_token`` cookie, else the ``Authorization`` bearer — see
    :func:`_presented_token`; on keying the token rather than the user, see
    :func:`_bearer_key`), and ``peer:<rightmost X-Forwarded-For>`` (see
    :func:`peer_ip`) for a request carrying neither. Behind Vercel/ALB every
    request arrives from a handful of source IPs, so an IP-keyed limit would
    collapse every caller into one bucket.

    It deliberately does NOT read ``request.state.user``: nothing in the app
    sets it, and slowapi calls a key function inside the endpoint wrapper with
    only the raw request in hand. Reading it was why this used to return
    ``ip:{client.host}`` for every request — one bucket per ALB node, shared
    by every user, agent browser and runner.

    A route authenticated by an ``HTTPBearer`` device token must use
    :func:`get_device_bearer_identifier` instead, and a route with OPTIONAL
    auth must key on the peer; ``test_rate_limit_key_functions`` walks every
    limited route and enforces both.

    **Do not rename the ``request`` parameter.** slowapi decides whether to
    call a key function with the request or with no arguments by looking for
    a parameter literally named ``"request"``
    (``Limiter.__evaluate_limits`` -> ``inspect.signature(lim.key_func)``).
    Renaming it would silently switch slowapi to calling this with zero args
    and raise inside the limiter rather than here.
    """
    return _bearer_key(request) or _peer_key(request)


#: The name the operations admin routes import. One function, two names: the
#: routes it keys authenticate through the same fastapi-users scheme.
get_authorization_identifier = get_user_identifier


def get_device_bearer_identifier(request: Request) -> str:
    """Per-DEVICE bucket for routes authenticated by an ``HTTPBearer`` device
    token (``app.api.deps.get_authenticated_device`` and its siblings).

    ``bearer:<digest>`` of the ``Authorization`` bearer ONLY, else the peer.
    Such a route never reads the ``access_token`` cookie, so keying on it (as
    :func:`get_user_identifier` does, cookie first) would let a device send a
    fresh junk cookie per request and get a fresh bucket each time. Name it as
    an explicit ``key_func=`` on every such route;
    ``test_rate_limit_key_functions`` walks every limited route and fails on a
    key that does not follow the route's own credential.

    **Do not rename the ``request`` parameter** (see
    :func:`get_user_identifier`).
    """
    return _digest_key(_header_bearer_token(request)) or _peer_key(request)


def get_peer_ip_identifier(request: Request) -> str:
    """Per-PEER bucket for unauthenticated public reads (see :func:`_peer_key`).

    **Do not rename the ``request`` parameter** (see
    :func:`get_user_identifier`).
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


# Loopback callers are treated as "the dev fleet" — exempt from auth rate
# limits in development. The primary runner, every spawned test runner, and the
# supervisor all phone home over 127.0.0.1 on a dev box, so without an
# exemption they share a single 5/min bucket and concurrent test spawns
# starve each other (and the primary). Production traffic is unaffected:
# this only fires when ENVIRONMENT == "development".


def _is_loopback(address: str | None) -> bool:
    """True for a loopback IP, including an IPv4-mapped IPv6 one
    (``::ffff:127.0.0.1``) and all of ``127.0.0.0/8``. Anything that does not
    parse as an IP (``None``, ``"unknown"``, a hostname) is not loopback."""
    ip = _ip(address)
    return ip is not None and ip.is_loopback


def _is_loopback_dev(request: Request) -> bool:
    """True for a development request whose socket peer AND derived peer (the
    rightmost ``X-Forwarded-For``, the derivation the rate-limit keys use —
    :func:`peer_ip`) are both loopback. Either alone is not the dev fleet:
    a loopback socket peer may be a local proxy forwarding a remote caller,
    and a loopback ``X-Forwarded-For`` entry may come from a remote peer."""
    if settings.ENVIRONMENT != "development":
        return False
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    return _is_loopback(host) and _is_loopback(peer_ip(request))


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
