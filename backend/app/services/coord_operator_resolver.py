"""Coord operator + tenant resolver.

Maps a qontinui-web ``auth.users`` row to its coord ``operators`` row
(and through it, the operator's home tenant). Used by the
``/api/v1/operations/*`` dashboard endpoints (and the device/pair-code
flows) to resolve the caller's tenant for a same-DB, cross-schema read.

qontinui-web and qontinui-coord share ONE Postgres database; web's
request-scoped session reads ``coord.operators`` / ``coord.tenants`` /
``coord.operator_roles`` directly (same connection, cross-schema). There
is no HTTP boundary here — this is a read web already owns. The forwarded
Cognito bearer is what coord-side handlers authorize on; this resolver
only computes the tenant value for the few sites where web must *know* it
(``/users/me`` + ``/tenants`` display and the ``pair_codes`` mint).

Resolution policy (posture C, contracted — **sub-only + fail-closed**):

The operator lookup keys SOLELY on the Cognito identity:
``coord.operators.sso_subject = :cognito_sub``. Coord stamps the Cognito
``sub`` into ``(sso_provider, sso_subject)`` on every SSO login, so
identity follows the token. Every live operator has been re-keyed onto
its ``sso_subject``, so the legacy ``LOWER(email) = :email`` predicate and
the ``personal-jspinak`` bootstrap-slug resolution fallback are gone.

An unknown identity therefore fails closed:

* ``cognito_sub`` is NULL (the web user carries no Cognito subject), OR
* no ``coord.operators`` row matches the subject,

→ the resolver raises 403 ``tenant_not_resolved``. It is NOT silently
resolved to the bootstrap tenant — that was a cross-tenant smell. The
endpoints require a tenant context to scope coord queries, and failing
closed is safer than silently exposing another tenant's data.

``user_is_coord_tenant_admin`` keeps a separate bootstrap-parity admin
safety net (no-operator-row → admin for the personal bootstrap tenant);
that is an authz fallback, not a resolution fallback, and is preserved
deliberately. ``PERSONAL_BOOTSTRAP_SLUG`` exists only for that branch.
"""

from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

logger = structlog.get_logger(__name__)


# Sentinel slug for the single-user bootstrap tenant. Kept in lockstep
# with `alembic/versions/coord_tenant_scope_columns.py::_PERSONAL_SLUG`.
# Now used ONLY by ``user_is_coord_tenant_admin``'s bootstrap-parity admin
# safety net — resolution no longer falls back to this slug.
PERSONAL_BOOTSTRAP_SLUG = "personal-jspinak"


def _identity_params(user: User) -> dict[str, str | None]:
    """Bind params for the sub-only operator match.

    ``cognito_sub`` is the Cognito ``sub`` claim (``auth.users.cognito_sub``,
    nullable). When NULL, the ``sso_subject = :cognito_sub`` predicate can
    never match (SQL NULL comparison) so the lookup misses and the caller
    fails closed — there is no email fallback. Comparing the bind param to
    the ``text`` column ``sso_subject`` gives asyncpg the type it needs
    (a bare ``$1 IS NOT NULL`` would raise ``AmbiguousParameterError``).
    """
    return {
        "cognito_sub": getattr(user, "cognito_sub", None) or None,
    }


async def resolve_tenant_for_user(user: User, db: AsyncSession) -> UUID:
    """Resolve the given web user to a coord tenant_id (sub-only).

    Looks up ``coord.operators`` keyed solely on the Cognito identity:
    ``sso_subject = :cognito_sub``. There is no email arm and no
    bootstrap-slug fallback.

    Raises 403 ``tenant_not_resolved`` when ``cognito_sub`` is NULL or no
    operator row matches — failing closed rather than resolving to another
    tenant.
    """
    params = _identity_params(user)

    row = (
        await db.execute(
            text(
                """
                SELECT tenant_id
                FROM coord.operators
                WHERE sso_subject = :cognito_sub
                LIMIT 1
                """
            ),
            params,
        )
    ).first()
    if row is not None:
        return UUID(str(row[0]))

    logger.warning(
        "tenant_not_resolved",
        user_id=str(user.id),
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="tenant_not_resolved",
    )


async def user_is_coord_tenant_admin(
    user: User, tenant_id: UUID, db: AsyncSession
) -> bool:
    """True iff the web user is an ADMIN of the given coord tenant.

    Authorizes against ``coord.operator_roles`` (the object the setting
    scopes to), NOT cloud-control org ownership and NOT ``is_superuser``.

    Decision logic:

    1. Direct role check: ``coord.operators ⋈ coord.operator_roles`` keyed
       sub-only on the Cognito identity (``o.sso_subject = :cognito_sub``)
       where ``r.tenant_id = :tid AND r.role = 'admin'``. Returns ``True``
       on any hit.

    2. Bootstrap-parity branch (a SEPARATE admin safety net, deliberately
       preserved): if the user has NO operator row at all AND the requested
       ``tenant_id`` is the ``personal-jspinak`` bootstrap tenant, return
       ``True``. This prevents the sole bootstrap user from being denied
       write access on a fresh DB where the alembic migration inserted the
       tenant but the operator_roles RBAC rows haven't been back-filled
       yet. Returns ``False`` in all other no-operator cases. (This is an
       authz fallback, not a tenant-resolution fallback — resolution itself
       is sub-only / fail-closed.)
    """
    params = _identity_params(user)

    # Step 1 — direct admin-role match (sub-only).
    admin_row = (
        await db.execute(
            text(
                """
                SELECT 1
                FROM coord.operators o
                JOIN coord.operator_roles r ON r.operator_id = o.operator_id
                WHERE o.sso_subject = :cognito_sub
                  AND r.tenant_id = :tid
                  AND r.role = 'admin'
                LIMIT 1
                """
            ),
            {**params, "tid": str(tenant_id)},
        )
    ).first()
    if admin_row is not None:
        return True

    # Step 2 — bootstrap-parity check.
    # Only fires when the user has NO operator row at all (fresh DB
    # before SSO provisions RBAC rows). We need two sub-queries:
    #   a) does the user have any operator row?
    #   b) does tenant_id equal the personal-jspinak bootstrap tenant?
    # If (a) is empty AND (b) matches → return True (bootstrap owner).

    op_row = (
        await db.execute(
            text(
                """
                SELECT 1
                FROM coord.operators
                WHERE sso_subject = :cognito_sub
                LIMIT 1
                """
            ),
            params,
        )
    ).first()
    if op_row is not None:
        # Operator exists but has no admin role → deny.
        return False

    # No operator row at all — check whether the tenant matches the
    # personal bootstrap slug.
    bootstrap_row = (
        await db.execute(
            text(
                """
                SELECT tenant_id
                FROM coord.tenants
                WHERE slug = :slug
                LIMIT 1
                """
            ),
            {"slug": PERSONAL_BOOTSTRAP_SLUG},
        )
    ).first()
    if bootstrap_row is not None and UUID(str(bootstrap_row[0])) == tenant_id:
        logger.info(
            "coord_tenant_admin_via_bootstrap_parity",
            user_id=str(user.id),
            tenant_id=str(tenant_id),
            slug=PERSONAL_BOOTSTRAP_SLUG,
        )
        return True

    return False


async def resolve_tenants_for_user(user: User, db: AsyncSession) -> list[UUID]:
    """Resolve the given web user to the full set of coord tenants they
    belong to (sub-only).

    Membership is defined as: "operator has ≥1 row in
    ``coord.operator_roles`` for that tenant." This is the read-side of
    the existing ``coord.operators`` ↔ ``coord.tenants`` join table
    (alembic ``coord_sso_rbac.py:108-120``). The SSO first-login flow
    (`coord/auth_sso.rs:325-338`) seeds a home-tenant row, so single-tenant
    operators come back as a one-element list — parity with
    `resolve_tenant_for_user`.

    Returns the operator's home tenant first (the natural "active"
    default) followed by the rest of their memberships in
    deterministic (slug-asc) order.

    Operator lookup is keyed sub-only on the Cognito identity
    (``o.sso_subject = :cognito_sub``) — same key as
    `resolve_tenant_for_user`. There is no email arm and no bootstrap-slug
    fallback.

    Raises 403 ``tenant_not_resolved`` when ``cognito_sub`` is NULL or no
    operator row matches — failing closed.
    """
    params = _identity_params(user)

    # Sub-only operator → roles → tenants. Order by:
    #   1) the operator's home tenant_id first (matches the
    #      `active_tenant_id` the UI uses as default)
    #   2) then by slug alphabetical for everyone else (stable wire
    #      shape for the dashboard's tenant chip rendering).
    #
    # GROUP BY (not DISTINCT) so an operator with multiple roles in
    # the same tenant doesn't multiply rows. Postgres rejects
    # `SELECT DISTINCT ... ORDER BY <expression-not-in-select-list>`
    # which the home-tenant predicate would otherwise trigger.
    rows = (
        await db.execute(
            text(
                """
                SELECT r.tenant_id, t.slug, o.tenant_id AS home_tenant_id
                FROM coord.operators o
                JOIN coord.operator_roles r
                  ON r.operator_id = o.operator_id
                JOIN coord.tenants t
                  ON t.tenant_id = r.tenant_id
                WHERE o.sso_subject = :cognito_sub
                GROUP BY r.tenant_id, t.slug, o.tenant_id
                ORDER BY
                    (r.tenant_id = o.tenant_id) DESC,
                    t.slug ASC
                """
            ),
            params,
        )
    ).fetchall()
    if rows:
        return [UUID(str(row[0])) for row in rows]

    logger.warning(
        "tenants_not_resolved",
        user_id=str(user.id),
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="tenant_not_resolved",
    )
