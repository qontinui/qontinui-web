"""Single Cognito token verification + user provisioning path.

This is the ONE place that turns a presented Cognito user-pool JWT into a
local ``auth.users`` :class:`~app.models.user.User`. It is used by:

* the fastapi-users strategy (:class:`app.auth.config.CognitoJWTStrategy`),
  so every HTTP dependency (``current_active_user``/``current_verified_user``/…)
  authenticates via Cognito, and
* the WebSocket authenticator
  (:func:`app.api.deps.get_current_user_from_ws`), so the annotation
  collaboration / runner / device sockets authenticate via the *same* path.

Cognito is the sole user-authentication mechanism: there is no local
HS256 / password fallback. A non-Cognito or otherwise invalid token
yields ``None`` (HTTP) or raises (WS) — never a silently-accepted user.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

logger = structlog.get_logger(__name__)


class CognitoAuthError(Exception):
    """A Cognito token could not be verified or resolved to a user.

    Raised by :func:`verify_cognito_token_and_resolve_user`. Callers that
    need a hard failure (WebSocket auth) translate this to a 401; the
    fastapi-users strategy catches it and returns ``None`` instead.
    """


async def verify_cognito_token_and_resolve_user(
    token: str,
    session: AsyncSession,
) -> User:
    """Verify a Cognito JWT and resolve/provision its ``auth.users`` row.

    Steps (the single authentication path):

    1. Verify the token's signature, issuer, audience and expiry against
       the configured Cognito user-pool JWKS (:mod:`app.services.cognito_jwks`).
    2. Resolve the verified claims to a local :class:`User`, provisioning
       or linking on first login (:mod:`app.services.cognito_provision`).

    The supplied ``session`` is used for provisioning, so a freshly
    created/linked user is flushed on it and commits with the caller's
    unit of work.

    Args:
        token: The raw Cognito access (or id) token from the request.
        session: The DB session used to resolve/provision the user.

    Returns:
        The authenticated :class:`User`.

    Raises:
        CognitoAuthError: Cognito is not configured, the JWKS is
            unreachable, the token is invalid, or the verified claims
            cannot be resolved to a user.
    """
    from app.services.cognito_jwks import (
        CognitoJWKSUnavailableError,
        CognitoTokenInvalidError,
        cognito_jwks_client,
    )
    from app.services.cognito_provision import (
        CognitoClaimError,
        resolve_user_for_cognito_claims,
    )

    if not cognito_jwks_client.configured:
        # Cognito is the only auth mechanism; if it is not configured the
        # backend cannot authenticate anyone. Fail closed, loudly.
        logger.error("cognito_not_configured")
        raise CognitoAuthError("Cognito authentication is not configured")

    try:
        claims: dict[str, Any] = await cognito_jwks_client.verify_token(token)
    except CognitoJWKSUnavailableError as exc:
        # JWKS unreachable (e.g. cold start) — fail closed, never trust an
        # unverified token. Logged loud for ops.
        logger.error("cognito_jwks_unavailable", error=str(exc))
        raise CognitoAuthError("Cognito JWKS temporarily unavailable") from exc
    except CognitoTokenInvalidError as exc:
        logger.warning("cognito_token_invalid", error=str(exc))
        raise CognitoAuthError("Invalid Cognito token") from exc

    try:
        user = await resolve_user_for_cognito_claims(session, claims)
    except CognitoClaimError as exc:
        logger.warning("cognito_claims_incomplete", error=str(exc))
        raise CognitoAuthError("Cognito claims could not be resolved") from exc

    logger.info(
        "cognito_token_accepted",
        user_id=str(user.id),
        cognito_sub=claims.get("sub"),
    )
    return user
