"""
Authentication endpoints package.

Cognito is the sole user-authentication mechanism: sign-up, password
reset, and email verification are owned by the Cognito hosted UI, so the
FastAPI-Users register / reset-password / email-verify routers and the
local JWT login/refresh/logout + password-change endpoints are gone.

Remaining endpoints:
- ``/users/me`` override (enriches the user with coord tenant identity)
- fastapi-users user-management router (profile read/update)
- Device management + DEVICE verification (NOT email verification)
- Bootstrap-first-admin (promote an existing user to superuser)
"""

# Import sub-routers
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.auth.bootstrap import router as bootstrap_router
from app.api.v1.endpoints.auth.devices import router as devices_router
from app.api.v1.endpoints.auth.verification import router as verification_router
from app.auth.config import fastapi_users
from app.models.user import User as UserModel
from app.schemas.user import UserRead, UserUpdate

# Main auth router
router = APIRouter()


@router.get("/users/me", response_model=UserRead, tags=["users"])
async def read_users_me(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> UserRead:
    """Return the current user enriched with their coord tenant identity.

    Overrides the fastapi-users default ``/users/me`` so the dropdown
    avatar can render ``Tenant: <slug>``. Tenant lookup mirrors
    :func:`app.services.coord_operator_resolver.resolve_tenant_for_user`
    but never raises: an unresolved tenant returns ``None`` so the UI
    can render ``(not assigned)`` instead of a 403.
    """
    email = (current_user.email or "").strip().lower()
    sub = current_user.cognito_sub
    # Operator match is sub-primary / email-fallback (expand/contract),
    # mirroring app.services.coord_operator_resolver. Never raises — a
    # miss yields tenant_id=None so the UI shows "(not assigned)".
    if sub is not None:
        op_match_sql = "o.sso_subject = :sub"
        op_match_params: dict[str, str] = {"sub": sub}
    else:
        # CONTRACT: drop email fallback once cognito_sub backfill confirmed
        op_match_sql = "LOWER(o.email) = :email"
        op_match_params = {"email": email}
    row = (
        await db.execute(
            text(
                f"""
                SELECT o.tenant_id, t.slug
                FROM coord.operators o
                LEFT JOIN coord.tenants t ON t.tenant_id = o.tenant_id
                WHERE {op_match_sql}
                LIMIT 1
                """
            ),
            op_match_params,
        )
    ).first()

    tenant_id = row[0] if row is not None else None
    tenant_slug = row[1] if row is not None else None

    return UserRead.model_validate(
        {
            **{
                k: getattr(current_user, k)
                for k in (
                    "id",
                    "email",
                    "username",
                    "full_name",
                    "company",
                    "phone",
                    "avatar_url",
                    "subscription_tier",
                    "is_beta",
                    "is_active",
                    "is_superuser",
                    "is_verified",
                    "created_at",
                    "updated_at",
                )
            },
            "preferences": getattr(current_user, "preferences", None),
            "tenant_id": tenant_id,
            "tenant_slug": tenant_slug,
        }
    )


# FastAPI-Users user-management routes (profile read/update).
# Sign-up / password-reset / email-verify routers are intentionally NOT
# included — Cognito's hosted UI owns those flows.
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)

# Include custom auth sub-routers (device management + device verification).
router.include_router(devices_router, tags=["auth"])
router.include_router(verification_router, tags=["auth"])
router.include_router(bootstrap_router, tags=["auth-bootstrap"])
