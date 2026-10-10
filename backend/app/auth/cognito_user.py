"""Single user-token verification + user provisioning path.

This is the ONE place that turns a presented user token into a local
``auth.users`` :class:`~app.models.user.User`. The token may come from the
Cognito user pool or from any issuer in ``OIDC_PROVIDERS`` (Entra ID,
Keycloak, Okta, ...); :mod:`app.services.oidc_jwks` routes it to the
verifier for its issuer. It is used by:

* the fastapi-users strategy (:class:`app.auth.config.CognitoJWTStrategy`),
  so every HTTP dependency (``current_active_user``/``current_verified_user``/…)
  authenticates through it, and
* the WebSocket authenticator
  (:func:`app.api.deps.get_current_user_from_ws`), so the annotation
  collaboration / runner / device sockets authenticate via the *same* path.

There is no local HS256 / password fallback. A token no configured issuer
vouches for yields ``None`` (HTTP) or raises (WS) — never a silently-accepted
user. The resolved user carries the roles its issuer groups map to
(:attr:`User.identity_roles`, ``OIDC_GROUP_ROLE_MAP``).

The module and function keep their Cognito names because every auth
dependency and its tests address them; the behaviour is issuer-generic.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

logger = structlog.get_logger(__name__)


class CognitoAuthError(Exception):
    """A user token could not be verified or resolved to a user.

    Raised by :func:`verify_cognito_token_and_resolve_user`. Callers that
    need a hard failure (WebSocket auth) translate this to a 401; the
    fastapi-users strategy catches it and returns ``None`` instead.
    """


async def verify_cognito_token_and_resolve_user(
    token: str,
    session: AsyncSession,
) -> User:
    """Verify a user token and resolve/provision its ``auth.users`` row.

    Steps (the single authentication path):

    1. Verify signature, issuer, audience and expiry against the JWKS of the
       issuer the token names, found by OIDC discovery
       (:mod:`app.services.oidc_jwks`).
    2. Resolve the verified claims to a local :class:`User`, provisioning or
       linking on first login — by ``cognito_sub`` for the Cognito pool, by
       ``(issuer, sub)`` for any other issuer
       (:mod:`app.services.cognito_provision`).
    3. Derive the user's roles from the token's groups claim.

    The supplied ``session`` is used for provisioning, so a freshly
    created/linked user is flushed on it and commits with the caller's
    unit of work.

    Raises:
        CognitoAuthError: no issuer is configured, the JWKS is unreachable,
            the token is invalid, or the verified claims cannot be resolved.
    """
    from app.auth.identity_roles import derive_roles, groups_from_claims
    from app.core.config import settings
    from app.services.cognito_provision import (
        CognitoClaimError,
        resolve_user_for_cognito_claims,
        resolve_user_for_oidc_claims,
    )
    from app.services.oidc_jwks import (
        OIDCJWKSUnavailableError,
        OIDCTokenInvalidError,
        oidc_jwks_failure_log_fields,
        oidc_verifier,
    )

    if not oidc_verifier.configured:
        # No issuer configured: the backend cannot authenticate anyone.
        # Fail closed, loudly.
        logger.error("oidc_not_configured")
        raise CognitoAuthError("No token issuer is configured")

    try:
        verified = await oidc_verifier.verify_token(token)
    except OIDCJWKSUnavailableError as exc:
        # JWKS unreachable (e.g. cold start) — fail closed, never trust an
        # unverified token. The caller sees only "temporarily unavailable",
        # so this line names the issuer, the URL dialled, the setting that
        # produced it and the transport class.
        logger.error("oidc_jwks_unavailable", **oidc_jwks_failure_log_fields(exc))
        raise CognitoAuthError("Token issuer keys temporarily unavailable") from exc
    except OIDCTokenInvalidError as exc:
        logger.warning("oidc_token_invalid", error=str(exc))
        raise CognitoAuthError("Invalid token") from exc

    claims: dict[str, Any] = verified.claims
    provider = verified.provider
    try:
        if provider.kind == "cognito":
            user = await resolve_user_for_cognito_claims(session, claims)
        else:
            user = await resolve_user_for_oidc_claims(session, provider.issuer, claims)
    except CognitoClaimError as exc:
        logger.warning("oidc_claims_incomplete", error=str(exc), issuer=provider.issuer)
        raise CognitoAuthError("Token claims could not be resolved") from exc

    user.set_identity_roles(
        derive_roles(
            groups_from_claims(claims, provider.groups_claim),
            settings.OIDC_GROUP_ROLE_MAP,
        )
    )

    logger.info(
        "oidc_token_accepted",
        user_id=str(user.id),
        issuer=provider.issuer,
        sub=claims.get("sub"),
        roles=sorted(user.identity_roles),
    )
    return user
