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

Resolution policy (posture C — key on the Cognito identity, not email):

1. **Sub-keyed (preferred).** When the web user has a Cognito subject
   (``auth.users.cognito_sub``), match ``coord.operators.sso_subject =
   :cognito_sub`` — coord stamps the Cognito ``sub`` into
   ``(sso_provider, sso_subject)`` on every SSO login, so identity
   follows the token, not email.
2. **Email-keyed (transitional fallback).** When ``cognito_sub`` is NULL
   (a pre-existing row not yet backfilled), OR the sub lookup misses,
   fall back to ``LOWER(email) = :email``. This keeps an un-backfilled
   user resolving — no 403 regression. The email predicate is retained
   only until the ``cognito_sub`` backfill is confirmed and will be
   dropped in a contract follow-up.
3. **Bootstrap-slug fallback (transitional).** When neither key resolves
   an operator row, fall through to the ``personal-jspinak`` tenant —
   the recovery posture for a fresh DB whose operator row is missing.
   Also dropped in the contract follow-up.

If no path matches, the resolver raises 403 ``tenant_not_resolved``.
That posture is intentional: the endpoints require a tenant context to
scope coord queries, and failing closed is safer than silently exposing
fleet-wide data.
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
# The fallback-by-slug path runs only when neither sso_subject nor email
# resolves to an operator row — which is the recovery posture for a
# fresh DB whose alembic ran but whose operator row was somehow lost.
PERSONAL_BOOTSTRAP_SLUG = "personal-jspinak"


def _identity_params(user: User) -> dict[str, str | None]:
    """Bind params for the sub-preferred / email-fallback operator match.

    ``cognito_sub`` is the Cognito ``sub`` claim (``auth.users.cognito_sub``,
    nullable). When NULL, the ``sso_subject = :cognito_sub`` predicate can
    never match (SQL NULL comparison) so only the email predicate fires —
    exactly the transitional fallback we want for an un-backfilled user.
    """
    return {
        "cognito_sub": getattr(user, "cognito_sub", None) or None,
        "email": (user.email or "").strip().lower(),
    }


# Shared predicate: prefer the Cognito ``sub`` match, fall back to email.
#
# Both arms are evaluated in ONE query so the sub-preferred / email-fallback
# choice is a single round-trip (no ordered two-query dance). The ORDER BY
# ranks a ``sso_subject`` match ahead of an email-only match when both a
# sub-keyed and an email-keyed row exist; LIMIT 1 then takes the preferred
# one. When ``:cognito_sub`` is NULL the first predicate is unsatisfiable, so
# only the email arm contributes.
_OPERATOR_SUB_OR_EMAIL_PREDICATE = """
    (:cognito_sub IS NOT NULL AND {op}.sso_subject = :cognito_sub)
    OR LOWER({op}.email) = :email
"""

_OPERATOR_SUB_PREFER_ORDER = "({op}.sso_subject = :cognito_sub) DESC NULLS LAST"


async def resolve_tenant_for_user(user: User, db: AsyncSession) -> UUID:
    """Resolve the given web user to a coord tenant_id.

    Lookup order:

    1. ``coord.operators`` keyed on the Cognito identity:
       ``sso_subject = :cognito_sub`` preferred, ``LOWER(email) = :email``
       as a transitional fallback (un-backfilled ``cognito_sub`` users
       still resolve via email — no 403 regression).
    2. If neither key resolves an operator row (the fresh-DB recovery
       case), fall through to the ``personal-jspinak`` bootstrap tenant.
       This guards against a user whose operator row is missing — the
       dashboard still resolves to the only sensible tenant.

    Raises 403 ``tenant_not_resolved`` if neither path returns a row.
    """
    params = _identity_params(user)

    # Step 1 — sub-preferred / email-fallback operator match.
    row = (
        await db.execute(
            text(
                f"""
                SELECT tenant_id
                FROM coord.operators
                WHERE {_OPERATOR_SUB_OR_EMAIL_PREDICATE.format(op="coord.operators")}
                ORDER BY {_OPERATOR_SUB_PREFER_ORDER.format(op="coord.operators")}
                LIMIT 1
                """
            ),
            params,
        )
    ).first()
    if row is not None:
        return UUID(str(row[0]))

    # Step 2 — bootstrap fallback by slug.
    fallback = (
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
    if fallback is not None:
        logger.info(
            "tenant_resolved_via_bootstrap_fallback",
            user_email=params["email"],
            slug=PERSONAL_BOOTSTRAP_SLUG,
        )
        return UUID(str(fallback[0]))

    logger.warning(
        "tenant_not_resolved",
        user_email=params["email"],
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
       on the Cognito identity (``o.sso_subject = :cognito_sub`` preferred,
       ``LOWER(o.email) = :email`` transitional fallback) where
       ``r.tenant_id = :tid AND r.role = 'admin'``. Returns ``True`` on any
       hit.

    2. Bootstrap-parity branch (mirrors ``resolve_tenant_for_user``'s
       fallback so the pre-SSO single user isn't locked out before any
       operator row has been provisioned): if the user has NO operator row
       at all AND the requested ``tenant_id`` is the ``personal-jspinak``
       bootstrap tenant, return ``True``.  This prevents the sole bootstrap
       user from being denied write access on a fresh DB where the alembic
       migration inserted the tenant but the operator_roles RBAC rows
       haven't been back-filled yet.  Returns ``False`` in all other
       no-operator cases.
    """
    params = _identity_params(user)

    # Step 1 — direct admin-role match (sub-preferred, email-fallback).
    admin_row = (
        await db.execute(
            text(
                f"""
                SELECT 1
                FROM coord.operators o
                JOIN coord.operator_roles r ON r.operator_id = o.operator_id
                WHERE ({_OPERATOR_SUB_OR_EMAIL_PREDICATE.format(op="o")})
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
                f"""
                SELECT 1
                FROM coord.operators
                WHERE {_OPERATOR_SUB_OR_EMAIL_PREDICATE.format(op="coord.operators")}
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
            user_email=params["email"],
            tenant_id=str(tenant_id),
            slug=PERSONAL_BOOTSTRAP_SLUG,
        )
        return True

    return False


async def resolve_tenants_for_user(user: User, db: AsyncSession) -> list[UUID]:
    """Resolve the given web user to the full set of coord tenants they
    belong to.

    Membership is defined as: "operator has ≥1 row in
    ``coord.operator_roles`` for that tenant." This is the read-side of
    the existing ``coord.operators`` ↔ ``coord.tenants`` join table
    (alembic ``coord_sso_rbac.py:108-120``). The SSO first-login flow
    (`coord/auth_sso.rs:325-338`) and the bootstrap migration
    (`coord_tenant_scope_columns.py:120-134`) both seed a home-tenant
    row, so single-tenant operators come back as a one-element list —
    parity with `resolve_tenant_for_user`.

    Returns the operator's home tenant first (the natural "active"
    default) followed by the rest of their memberships in
    deterministic (slug-asc) order.

    Bootstrap fallback: when no operator row matches the user's identity
    (the pre-SSO single-user case), returns the personal-jspinak
    tenant_id as a single-element list. Identical posture to
    `resolve_tenant_for_user` — failing closed here would break the
    /tenants endpoint for dev users on a fresh DB.

    Operator lookup is keyed on the Cognito identity (``o.sso_subject =
    :cognito_sub`` preferred, ``LOWER(o.email) = :email`` transitional
    fallback) — same key as `resolve_tenant_for_user`.

    Raises 403 ``tenant_not_resolved`` if neither the operator lookup nor
    the bootstrap fallback yields anything.
    """
    params = _identity_params(user)

    # (sub-preferred / email-fallback) operator → roles → tenants. Order by:
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
                f"""
                SELECT r.tenant_id, t.slug, o.tenant_id AS home_tenant_id
                FROM coord.operators o
                JOIN coord.operator_roles r
                  ON r.operator_id = o.operator_id
                JOIN coord.tenants t
                  ON t.tenant_id = r.tenant_id
                WHERE {_OPERATOR_SUB_OR_EMAIL_PREDICATE.format(op="o")}
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

    # Bootstrap fallback — same posture as resolve_tenant_for_user.
    # The personal-jspinak tenant is the single-element membership set.
    fallback = (
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
    if fallback is not None:
        logger.info(
            "tenants_resolved_via_bootstrap_fallback",
            user_email=params["email"],
            slug=PERSONAL_BOOTSTRAP_SLUG,
        )
        return [UUID(str(fallback[0]))]

    logger.warning(
        "tenants_not_resolved",
        user_email=params["email"],
        user_id=str(user.id),
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="tenant_not_resolved",
    )
