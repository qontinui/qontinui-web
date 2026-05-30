"""Coord operator + tenant resolver.

Maps a qontinui-web ``auth.users`` row to its coord ``operators`` row
(and through it, the operator's home tenant). Used by the
``/api/v1/operations/*`` dashboard endpoints so every proxy call to
coord can inject the resolver tenant into the
``X-Qontinui-Tenant-Id`` header — coord-side handlers then scope every
SQL query to that tenant.

Resolution policy (expand/contract — Cognito sub primary, email fallback):

1. PRIMARY — Cognito subject. When the web user has a ``cognito_sub``
   (``auth.users.cognito_sub``, populated on every Cognito login and
   unique-indexed), match it against ``coord.operators.sso_subject``
   (stamped by coord on SSO first-login). This is the natural IdP key
   shared across both halves of the database and is the canonical link.
2. SECONDARY (fallback) — ``LOWER(email) = :email`` against
   ``coord.operators``. Retained for any operator row whose
   ``sso_subject`` has not yet been back-filled (the column is nullable
   on the coord side). For a fully back-filled operator the sub and the
   email converge on the SAME row, so keeping email is behavior-
   preserving — it only adds coverage for the backfill gap.
3. FINAL (bootstrap-slug) — fall through to the ``personal-jspinak``
   tenant via ``coord.tenants.slug``. Recovery posture for a fresh DB
   whose alembic ran but whose operator row was lost / has a slightly
   different email.

If no path matches, the resolver raises 403 ``tenant_not_resolved``.
That posture is intentional: the dashboard endpoints require a tenant
context to scope coord queries, and failing closed is safer than
silently exposing fleet-wide data.

CONTRACT NOTE: the email predicate and the bootstrap-slug fallback are
both kept for now and are slated for removal once a prod backfill of
``coord.operators.sso_subject`` is confirmed (the later "contract"
phase). Each fallback is tagged with a ``# CONTRACT:`` comment.
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

    Lookup order (expand/contract — sub primary, email fallback):

    1. ``coord.operators.sso_subject`` exact-match against
       ``user.cognito_sub`` (only when the user has a Cognito subject).
    2. ``coord.operators.email`` exact-match against ``user.email``
       (lowercased on both sides). Fallback for operator rows whose
       ``sso_subject`` isn't back-filled yet.
    3. ``personal-jspinak`` bootstrap-slug fallback: resolve the only
       sensible tenant for a fresh DB / slightly-mismatched email.

    Raises 403 ``tenant_not_resolved`` if no path returns a row.
    """
    email = (user.email or "").strip().lower()
    sub = getattr(user, "cognito_sub", None)

    # Step 1 — PRIMARY: Cognito subject → operator.sso_subject. Only
    # attempted when the user actually carries a Cognito sub (local /
    # not-yet-migrated users have NULL here and fall through to email).
    if sub is not None:
        sub_row = (
            await db.execute(
                text(
                    """
                    SELECT tenant_id
                    FROM coord.operators
                    WHERE sso_subject = :sub
                    LIMIT 1
                    """
                ),
                {"sub": sub},
            )
        ).first()
        if sub_row is not None:
            return UUID(str(sub_row[0]))

    # CONTRACT: drop email+bootstrap fallback once cognito_sub backfill confirmed
    # Step 2 — FALLBACK: direct email match. (LOWER() on the column side
    # so the query plan can use the standard btree index if one exists;
    # email in coord.operators is TEXT, no UNIQUE, no LOWER-index — small
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

    # CONTRACT: drop email+bootstrap fallback once cognito_sub backfill confirmed
    # Step 3 — bootstrap fallback by slug.
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


async def user_is_coord_tenant_admin(
    user: User, tenant_id: UUID, db: AsyncSession
) -> bool:
    """True iff the web user is an ADMIN of the given coord tenant.

    Authorizes against ``coord.operator_roles`` (the object the setting
    scopes to), NOT cloud-control org ownership and NOT ``is_superuser``.

    Decision logic (expand/contract — sub primary, email fallback):

    1. Direct role check: ``coord.operators ⋈ coord.operator_roles`` where
       the operator is matched by ``o.sso_subject = :sub`` (when the user
       carries a Cognito subject) else ``LOWER(o.email) = :email``, plus
       ``r.tenant_id = :tid AND r.role = 'admin'``. Returns ``True`` on
       any hit.

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
    email = (user.email or "").strip().lower()
    sub = getattr(user, "cognito_sub", None)

    # The operator-match predicate is sub-primary / email-fallback. We
    # build it once so the admin-role JOIN and the operator-exists check
    # below stay in lockstep on which operator row they target.
    if sub is not None:
        # CONTRACT: drop email+bootstrap fallback once cognito_sub backfill confirmed
        op_match_sql = "o.sso_subject = :sub"
        op_match_params: dict[str, str] = {"sub": sub}
        op_exists_match_sql = "sso_subject = :sub"
    else:
        op_match_sql = "LOWER(o.email) = :email"
        op_match_params = {"email": email}
        op_exists_match_sql = "LOWER(email) = :email"

    # Step 1 — direct admin-role match.
    admin_row = (
        await db.execute(
            text(
                f"""
                SELECT 1
                FROM coord.operators o
                JOIN coord.operator_roles r ON r.operator_id = o.operator_id
                WHERE {op_match_sql}
                  AND r.tenant_id = :tid
                  AND r.role = 'admin'
                LIMIT 1
                """
            ),
            {**op_match_params, "tid": str(tenant_id)},
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
    # CONTRACT: drop email+bootstrap fallback once cognito_sub backfill confirmed

    op_row = (
        await db.execute(
            text(
                f"""
                SELECT 1
                FROM coord.operators
                WHERE {op_exists_match_sql}
                LIMIT 1
                """
            ),
            op_match_params,
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
            user_email=email,
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

    Operator match is sub-primary / email-fallback (expand/contract),
    same as ``resolve_tenant_for_user``.

    Bootstrap fallback: when no operator row matches (the pre-SSO
    single-user case), returns the personal-jspinak tenant_id as a
    single-element list. Identical posture to ``resolve_tenant_for_user``
    — failing closed here would break the /tenants endpoint for dev users
    on a fresh DB.

    Raises 403 ``tenant_not_resolved`` if neither the operator lookup nor
    the bootstrap fallback yields anything.
    """
    email = (user.email or "").strip().lower()
    sub = getattr(user, "cognito_sub", None)

    # Operator match predicate — sub-primary / email-fallback.
    if sub is not None:
        op_match_sql = "o.sso_subject = :sub"
        op_match_params: dict[str, str] = {"sub": sub}
    else:
        # CONTRACT: drop email+bootstrap fallback once cognito_sub backfill confirmed
        op_match_sql = "LOWER(o.email) = :email"
        op_match_params = {"email": email}

    # operator → roles → tenants. Order by:
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
                WHERE {op_match_sql}
                GROUP BY r.tenant_id, t.slug, o.tenant_id
                ORDER BY
                    (r.tenant_id = o.tenant_id) DESC,
                    t.slug ASC
                """
            ),
            op_match_params,
        )
    ).fetchall()
    if rows:
        return [UUID(str(row[0])) for row in rows]

    # CONTRACT: drop email+bootstrap fallback once cognito_sub backfill confirmed
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
