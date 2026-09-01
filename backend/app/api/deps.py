"""
FastAPI dependencies for authentication and database access.

Now using fastapi-users for authentication.
"""

__all__ = [
    "current_active_user",
    "current_active_user_optional",
    "current_superuser",
    "current_verified_user",
    "get_async_db",
    "get_db",
    "get_current_user_async",
    "get_current_active_user_async",
    "get_current_superuser_async",
    "get_verified_user_async",
    "get_current_user_from_ws",
    "get_authenticated_device",
    "get_authenticated_device_user",
    "get_audit_actor_user_id",
    "get_audit_actor_user",
    "get_audit_actor_principal",
    "ActorPrincipal",
    "ActorKind",
]

from uuid import UUID

import structlog
from fastapi import HTTPException, status

from app.models.user import User

logger = structlog.get_logger(__name__)

# Export database dependencies
# Export fastapi-users dependencies
from app.auth.config import (
    current_active_user,
    current_active_user_optional,
    current_superuser,
    current_verified_user,
)
from app.db.session import get_async_db

# Export database session getter (for backward compatibility with sync-style imports)
get_db = get_async_db

# Backward compatibility aliases
get_current_user_async = current_active_user
get_current_active_user_async = current_active_user
get_current_superuser_async = current_superuser
get_verified_user_async = current_verified_user


async def get_current_user_from_ws(token: str) -> User:
    """
    Authenticate a WebSocket connection from a Cognito access token.

    This is the WebSocket equivalent of the ``current_active_user`` HTTP
    dependency and goes through the *same* single Cognito verification +
    provision-or-link path as the fastapi-users strategy
    (:class:`app.auth.config.CognitoJWTStrategy`). The frontend repoints
    its collaboration / runner / device sockets to send the Cognito
    ``access_token``, matching the token kind the HTTP path accepts.

    Args:
        token: Cognito user-pool access token (the same bearer the HTTP
            ``Authorization`` header carries).

    Returns:
        The authenticated, active :class:`User`.

    Raises:
        HTTPException: 401 if the token is missing/invalid or the resolved
            user is inactive.
    """
    from app.auth.cognito_user import (
        CognitoAuthError,
        verify_cognito_token_and_resolve_user,
    )
    from app.db.session import AsyncSessionLocal

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )

    # A dedicated session: the provision-or-link path may create/link a
    # user row on first Cognito login, so it must commit. The fastapi-users
    # HTTP path commits via the request-scoped session; the WS path has no
    # request session, so own one here.
    async with AsyncSessionLocal() as db:
        try:
            user = await verify_cognito_token_and_resolve_user(token, db)
        except CognitoAuthError as exc:
            logger.warning("ws_cognito_auth_failed", error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            ) from exc

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User is not active",
            )

        # Commit any provision-or-link writes before the session closes.
        await db.commit()
        return user


# Type annotations for forward references
from typing import TYPE_CHECKING, Literal  # noqa: E402

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401


# ---------------------------------------------------------------------------
# Device-token FastAPI dependencies (Phase 5 — Unified Devices Registry)
# ---------------------------------------------------------------------------
#
# Phase 5 of plan ``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``
# retired the legacy runner-bearer-token auth (``qontinui_runner_<random>`` +
# Argon2) in favour of coord-issued device-token JWTs verified locally via
# coord's JWKS.

from fastapi import Depends  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer  # noqa: E402

_device_bearer_scheme = HTTPBearer(auto_error=True)


class DeviceTokenContext:
    """Authenticated device context — the decoded JWT claims plus the
    owning ``User`` row.

    Phase 5 replacement for the old ``RunnerToken`` model that previous
    runner-authenticated HTTP handlers used to receive via Depends().
    Endpoints that only need the user can use :func:`get_authenticated_device_user`.
    """

    def __init__(self, claims: dict, user: User) -> None:
        self.claims = claims
        self.user = user

    @property
    def device_id(self) -> UUID:
        raw = self.claims.get("device_id")
        if not raw:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device token missing device_id claim",
            )
        try:
            return UUID(str(raw))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device token device_id malformed",
            ) from exc

    @property
    def user_id(self) -> UUID:
        return self.user.id


async def _verify_device_jwt(token: str) -> tuple[dict, User]:
    """Verify a coord-issued device JWT and resolve the owning user."""
    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal
    from app.services.coord_jwks import (
        CoordJWKSUnavailableError,
        CoordTokenForeignIssuerError,
        CoordTokenInvalidError,
        coord_jwks_client,
        describe_token_rejection,
        identity_mismatch_remedy_fields,
    )

    try:
        claims = await coord_jwks_client.verify_token(token)
    except CoordJWKSUnavailableError as exc:
        # Same diagnosability rule as the WS handshake in devices_ws.py: the
        # 503 detail is deliberately vague, so this line must name the coord
        # URL dialled and the concrete transport exception class.
        logger.error(
            "device_token_jwks_unavailable",
            error=str(exc),
            failure=type(exc).__name__,
            cause=type(exc.__cause__).__name__ if exc.__cause__ else None,
            coord_url=coord_jwks_client.coord_url,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Device authentication temporarily unavailable.",
        ) from exc
    except CoordTokenInvalidError as exc:
        # Same honesty rule as the WS handshake: report which failure
        # occurred. Calling a foreign-issuer rejection "expired" costs the
        # reader the one clue that would resolve it.
        logger.warning(
            "device_token_rejected",
            error=str(exc),
            failure=type(exc).__name__,
        )
        # Terminal caller, so this arm is a real wiring bug — see the same
        # alarm in `devices_ws` for why it does not live in `verify_token`.
        if isinstance(exc, CoordTokenForeignIssuerError):
            logger.warning(
                "coord_identity_mismatch",
                coord_url=exc.coord_url,
                token_kid=exc.token_kid,
                served_kids=exc.served_kids,
                note=(
                    "caller presented a token minted by a different coord "
                    "than this backend verifies against"
                ),
                **identity_mismatch_remedy_fields(),
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=describe_token_rejection(exc),
        ) from exc

    raw_user_id = claims.get("user_id")
    if not raw_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Device token missing user_id claim.",
        )

    try:
        user_id = UUID(str(raw_user_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Device token user_id malformed.",
        ) from exc

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(User.id == user_id)  # type: ignore[arg-type]
        )
        user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is not active.",
        )

    return claims, user


async def get_authenticated_device(
    credentials: HTTPAuthorizationCredentials = Depends(_device_bearer_scheme),
) -> DeviceTokenContext:
    """FastAPI dependency — authenticate the caller as a paired device.

    Verifies the presented coord-issued device-token JWT and returns the
    decoded claims alongside the owning ``User``.
    """
    claims, user = await _verify_device_jwt(credentials.credentials)
    return DeviceTokenContext(claims=claims, user=user)


async def get_authenticated_device_user(
    credentials: HTTPAuthorizationCredentials = Depends(_device_bearer_scheme),
) -> User:
    """FastAPI dependency — authenticate the caller as a paired device and
    return the owning :class:`~app.models.user.User`."""
    _claims, user = await _verify_device_jwt(credentials.credentials)
    return user


# A non-auto-error bearer scheme so the dual-auth dependency can fall back to
# device-token verification only when the Cognito path did not resolve a user,
# without raising on a missing/cookie-only request before we have tried both.
_optional_bearer_scheme = HTTPBearer(auto_error=False)

#: Which credential arm proved the caller.
#:
#: ``"operator"`` — a Cognito user JWT (a human in a browser, or anything
#: holding a user token). ``"device"`` — a coord-issued device-token JWT (the
#: runner, and the agent doors it hosts). The two are not interchangeable
#: DOWNSTREAM of this service: coord's operator routes resolve a tenant from an
#: ``OperatorContext`` and 403 a device JWT, while its ``agent-`` twins lift the
#: tenant from a verified device JWT and reject a Cognito bearer.
ActorKind = Literal["operator", "device"]


class ActorPrincipal:
    """The acting :class:`~app.models.user.User` PLUS *which* credential arm
    authenticated them.

    The dual-auth dependencies resolve two structurally different callers to
    the same ``User`` and then throw the distinction away. That is fine while
    the only question is "whose organization scopes this write", and wrong the
    moment a handler has to make a decision that depends on the CREDENTIAL
    rather than on the person — the case that forced this type into existence
    is ``plan_library``'s coord probe, which forwards the caller's bearer
    verbatim to coord: a Cognito bearer must go to coord's operator
    (``TenantId``) doors and a coord device JWT must go to its ``agent-``
    twins, because each tier rejects the other's credential.

    Sniffing the token inside the handler would be the wrong place to answer
    that: the dependency has ALREADY decided which arm authenticated, so a
    second, weaker guess (does this look like a JWT? does it have a
    ``device_id``?) can only drift away from the first. ``kind`` is that first
    decision, carried forward.

    It carries the ``User`` and the ``kind``, and deliberately nothing else.
    An earlier draft also parked the verified device JWT's claim set here,
    plus an ``is_device`` convenience predicate; neither ever acquired a
    reader, and the claims half duplicated
    :class:`DeviceTokenContext`/:func:`get_authenticated_device`, which is the
    tested door for a handler that genuinely needs claims (``devices.py`` reads
    ``tenant_id`` through it). Two ways to reach the same claim set, one of
    them untested, is worse than one — so this type stays the *narrow* answer
    to "which arm authenticated", and a claims consumer takes the door built
    for claims.
    """

    __slots__ = ("user", "kind")

    def __init__(self, user: User, kind: ActorKind) -> None:
        self.user = user
        self.kind = kind

    def __repr__(self) -> str:  # pragma: no cover — debugging aid
        return f"ActorPrincipal(kind={self.kind!r}, user_id={self.user.id!r})"


async def _resolve_actor_principal(
    user: User | None,
    credentials: HTTPAuthorizationCredentials | None,
) -> ActorPrincipal:
    """THE dual-auth decision tree — one implementation, three dependencies.

    This is a plain coroutine, not a FastAPI dependency, precisely so the
    dependencies below can call it by hand: a ``Depends()`` default is inert
    when a dependency is invoked directly, so delegating to a *dependency*
    would silently re-run resolution instead of sharing it. Delegating to this
    takes the already-resolved inputs and cannot diverge.

    Precedence and failure modes, spelled out because both are load-bearing:

    * A resolved Cognito user WINS outright and the device path is never
      consulted — a forwarded device token cannot override the authenticated
      browser user.
    * With no Cognito user, the presented bearer is verified as a device token
      and the caller becomes the device's paired operator (its owning user).
      That is deliberately the only way a device acquires an organization
      scope: the org comes from a credential the runner owns, never from the
      request.
    * A bearer that fails device verification propagates that 401 (or the 503
      from an unreachable coord JWKS) — it never falls through to success.
    * Neither a Cognito user nor a bearer → 401. There is no anonymous path.
    """
    if user is not None:
        return ActorPrincipal(user=user, kind="operator")

    if credentials is not None:
        _claims, device_user = await _verify_device_jwt(credentials.credentials)
        return ActorPrincipal(user=device_user, kind="device")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
    )


async def get_audit_actor_principal(
    user: User | None = Depends(current_active_user_optional),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer_scheme),
) -> ActorPrincipal:
    """Resolve the acting principal — the ``User`` AND the arm that proved them.

    The principal-kind-carrying variant of :func:`get_audit_actor_user`, with
    IDENTICAL precedence and failure modes (both delegate to
    :func:`_resolve_actor_principal`). Depend on this one when the handler must
    treat a runner-originated request differently from a browser one; depend on
    the plain ``User`` variant otherwise, so a route does not acquire a
    distinction it has no use for.
    """
    return await _resolve_actor_principal(user, credentials)


async def get_audit_actor_user_id(
    user: User | None = Depends(current_active_user_optional),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer_scheme),
) -> UUID:
    """Resolve the acting user id from EITHER a Cognito user JWT OR a
    coord-issued device-token JWT.

    Used by endpoints the relay calls with whichever bearer it holds:

    * A Cognito user JWT — resolved by fastapi-users (cookie or bearer);
      the row is attributed to that user.
    * A coord device-token JWT — not a Cognito token, so the optional
      Cognito dependency yields ``None``; we then verify the presented
      bearer as a device token and attribute the row to the paired
      operator (the device's owning user).

    Returns the owning user's id. Raises 401 if neither path authenticates.
    See :func:`_resolve_actor_principal` for the decision tree all three
    dual-auth dependencies share.
    """
    principal = await _resolve_actor_principal(user, credentials)
    return principal.user.id


async def get_audit_actor_user(
    user: User | None = Depends(current_active_user_optional),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer_scheme),
) -> User:
    """Resolve the acting :class:`~app.models.user.User` from EITHER a Cognito
    user JWT OR a coord-issued device-token JWT.

    The ``User``-returning sibling of :func:`get_audit_actor_user_id`, with an
    identical decision tree — same precedence, same failure modes. It exists
    because some dual-auth endpoints need more than the id: notably the plan &
    prompt library, whose routes derive the artifact's ``organization_id`` from
    the principal's personal organization and stamp an author from the
    principal's email. Returning only the id there would force each handler to
    re-load the row the dependency already had in hand.

    The decision tree itself lives in :func:`_resolve_actor_principal` — one
    implementation shared by all three dual-auth dependencies, so "same
    precedence, same failure modes" is structural rather than a promise three
    copies have to keep. (It is a plain coroutine, not a dependency: sharing a
    *dependency* by calling it by hand would leave its ``Depends()`` defaults
    inert and re-run the resolution instead.)
    """
    principal = await _resolve_actor_principal(user, credentials)
    return principal.user
