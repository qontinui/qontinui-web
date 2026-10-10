"""Identity-provider group -> Qontinui role mapping.

An OIDC issuer (Cognito, Entra ID, Keycloak, Okta, ...) asserts the groups a
user belongs to in a claim of its own choosing (``cognito:groups``,
``groups``, ``realm_access.roles``). A deployment maps those groups onto a
FIXED role vocabulary with a per-issuer map (an ``OIDC_PROVIDERS`` entry's
``group_role_map``, or ``COGNITO_GROUP_ROLE_MAP``), and every
authenticated request carries the derived roles on
:attr:`app.models.user.User.identity_roles`.

The roles are derived from the VERIFIED token on every request and are never
persisted: the issuer is the authority on group membership, so a membership
revoked at the issuer is gone from Qontinui by the next token. They are
additive information — no existing authorization check reads them, so
mapping a group grants nothing until a route opts in with
:func:`require_identity_roles`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Mapping
from enum import StrEnum
from typing import Any

import structlog
from fastapi import Depends, HTTPException, status

logger = structlog.get_logger(__name__)


class IdentityRole(StrEnum):
    """The role vocabulary a deployment maps issuer groups onto."""

    ANALYST = "analyst"
    KNOWLEDGE_OWNER = "knowledge_owner"
    DEVELOPER = "developer"
    TESTER = "tester"
    SUPPORT = "support"
    ADMIN = "admin"
    AUDITOR = "auditor"


def _claim_at(claims: Mapping[str, Any], claim: str) -> Any:
    """The value of ``claim`` in ``claims``, following a dotted path.

    The literal key wins (``cognito:groups`` and URL-shaped custom claims are
    single keys); otherwise ``realm_access.roles`` walks nested objects, which
    is where Keycloak puts realm roles.
    """
    if claim in claims:
        return claims[claim]
    node: Any = claims
    for part in claim.split("."):
        if not isinstance(node, Mapping) or part not in node:
            return None
        node = node[part]
    return node


def groups_from_claims(claims: Mapping[str, Any], groups_claim: str) -> list[str]:
    """The issuer groups asserted in ``claims[groups_claim]``.

    A list of strings or a single string is accepted; anything else yields no
    groups. Entra ID omits ``groups`` in its "groups overage" case (see
    https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
    and points at Graph through ``_claim_names`` instead — that case is logged and
    yields no groups (fail closed), because resolving it needs a Graph call
    with the user's delegated token, which this backend does not hold.
    """
    raw = _claim_at(claims, groups_claim)
    if raw is None:
        claim_names = claims.get("_claim_names")
        if isinstance(claim_names, Mapping) and groups_claim in claim_names:
            logger.warning(
                "oidc_groups_overage_unresolved",
                groups_claim=groups_claim,
                sub=claims.get("sub"),
            )
        return []
    if isinstance(raw, str):
        return [raw] if raw else []
    if isinstance(raw, list):
        return [g for g in raw if isinstance(g, str) and g]
    return []


def derive_roles(
    groups: Iterable[str],
    group_role_map: Mapping[str, Iterable[IdentityRole]],
) -> frozenset[IdentityRole]:
    """Map issuer ``groups`` to roles. Unmapped groups contribute nothing."""
    roles: set[IdentityRole] = set()
    for group in groups:
        roles.update(group_role_map.get(group, ()))
    return frozenset(roles)


def require_identity_roles(
    *roles: IdentityRole,
) -> Callable[..., Awaitable[Any]]:
    """FastAPI dependency: the caller must hold at least one of ``roles``.

    Returns the authenticated user. 403 when the user holds none of them.
    """
    if not roles:
        raise ValueError("require_identity_roles needs at least one role")
    wanted = frozenset(roles)

    from app.auth.config import current_active_user

    async def _dependency(user: Any = Depends(current_active_user)) -> Any:
        held: frozenset[IdentityRole] = getattr(user, "identity_roles", frozenset())
        if held & wanted:
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role.",
        )

    return _dependency
