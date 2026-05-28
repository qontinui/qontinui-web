"""Coord operator + tenant resolver.

Maps a qontinui-web ``auth.users`` row to its coord ``operators`` row
(and through it, the operator's home tenant). Used by the
``/api/v1/operations/*`` dashboard endpoints so every proxy call to
coord can inject the resolver tenant into the
``X-Qontinui-Tenant-Id`` header — coord-side handlers then scope every
SQL query to that tenant.

Resolution policy:

1. The single-user bootstrap case (`coord_tenant_scope_columns` alembic)
   maps ``email`` only: every qontinui-web user signs in via cookie auth
   today, no SSO subject is minted yet. The bootstrap migration inserts
   one operator row with ``sso_provider='' AND sso_subject=''``, keyed
   by email.
2. The future-SSO case will prefer ``(sso_provider, sso_subject)`` — the
   IdP natural key — which is the UNIQUE constraint on
   ``coord.operators``. The email column is retained as a fallback.

If no operator row matches, the resolver raises 403 ``tenant_not_resolved``.
That posture is intentional: the dashboard endpoints require a tenant
context to scope coord queries, and failing closed is safer than
silently exposing fleet-wide data.
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


async def resolve_tenant_for_user(user: User, db: AsyncSession) -> UUID:
    """Resolve the given web user to a coord tenant_id.

    Lookup order:

    1. ``coord.operators.email`` exact-match against ``user.email``
       (lowercased on both sides to dodge the ad-hoc casing the
       fastapi-users layer doesn't normalise).
    2. If a single-user bootstrap is the only operator in the DB (the
       canonical-PG state post-`coord_tenant_scope_columns`), fall
       through to that operator's tenant via the
       `personal-jspinak` slug. This guards against a user whose web
       email is slightly different from the migration's bootstrap
       email — the dashboard still resolves to the only sensible
       tenant until SSO actually provisions per-user operator rows.

    Raises 403 ``tenant_not_resolved`` if neither path returns a row.
    """
    email = (user.email or "").strip().lower()

    # Step 1 — direct email match. (LOWER() on the column side so the
    # query plan can use the standard btree index if one exists; email
    # in coord.operators is TEXT, no UNIQUE, no LOWER-index — small
    # table, sequential scan is fine.)
    row = (
        await db.execute(
            text(
                """
                SELECT tenant_id
                FROM coord.operators
                WHERE LOWER(email) = :email
                LIMIT 1
                """
            ),
            {"email": email},
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
            user_email=email,
            slug=PERSONAL_BOOTSTRAP_SLUG,
        )
        return UUID(str(fallback[0]))

    logger.warning(
        "tenant_not_resolved",
        user_email=email,
        user_id=str(user.id),
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="tenant_not_resolved",
    )


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

    Bootstrap fallback: when no operator row matches the user's email
    (the pre-SSO single-user case), returns the personal-jspinak
    tenant_id as a single-element list. Identical posture to
    `resolve_tenant_for_user` — failing closed here would break the
    /tenants endpoint for dev users on a fresh DB.

    Raises 403 ``tenant_not_resolved`` if neither the email lookup nor
    the bootstrap fallback yields anything.
    """
    email = (user.email or "").strip().lower()

    # Email → operator → roles → tenants. Order by:
    #   1) the operator's home tenant_id first (matches the
    #      `active_tenant_id` the UI uses as default)
    #   2) then by slug alphabetical for everyone else (stable wire
    #      shape for the dashboard's tenant chip rendering).
    rows = (
        await db.execute(
            text(
                """
                SELECT DISTINCT r.tenant_id, t.slug
                FROM coord.operators o
                JOIN coord.operator_roles r
                  ON r.operator_id = o.operator_id
                JOIN coord.tenants t
                  ON t.tenant_id = r.tenant_id
                WHERE LOWER(o.email) = :email
                ORDER BY
                    (r.tenant_id = o.tenant_id) DESC,
                    t.slug ASC
                """
            ),
            {"email": email},
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
            user_email=email,
            slug=PERSONAL_BOOTSTRAP_SLUG,
        )
        return [UUID(str(fallback[0]))]

    logger.warning(
        "tenants_not_resolved",
        user_email=email,
        user_id=str(user.id),
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="tenant_not_resolved",
    )
