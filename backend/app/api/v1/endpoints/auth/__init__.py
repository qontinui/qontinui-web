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
from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_current_active_user_async
from app.api.v1.endpoints.auth.bootstrap import router as bootstrap_router
from app.api.v1.endpoints.auth.devices import router as devices_router
from app.api.v1.endpoints.auth.identities import router as identities_router
from app.api.v1.endpoints.auth.verification import router as verification_router
from app.auth.config import fastapi_users
from app.models.user import User as UserModel
from app.schemas.user import UserRead, UserUpdate
from app.services.coord_identity import get_coord_identity

# Main auth router
router = APIRouter()


@router.get("/users/me", response_model=UserRead, tags=["users"])
async def read_users_me(
    *,
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> UserRead:
    """Return the current user enriched with their coord tenant identity.

    Overrides the fastapi-users default ``/users/me`` so the dropdown
    avatar can render ``Tenant: <slug>``. Identity is sourced from coord's
    ``GET /admin/coord/me`` over the HTTP boundary (no cross-schema read).
    An unresolved/unlinked operator (coord 403s) returns ``None`` so the
    UI can render ``(not assigned)`` instead of failing the page.
    """
    # Source the home tenant + its slug from coord over HTTP, authorized
    # on the forwarded Cognito bearer. Never raise: a coord 403 for an
    # un-linked operator → ``(not assigned)`` rather than a hard error on
    # the user's own profile read.
    tenant_id = None
    tenant_slug = None
    try:
        identity = await get_coord_identity(request)
        tenant_id = identity.home_tenant_id
        tenant_slug = identity.slug_for(identity.home_tenant_id)
    except HTTPException:
        # Unlinked operator / coord unreachable — degrade to "(not
        # assigned)" instead of surfacing a 403/502 on /users/me.
        pass

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
# Cross-IdP account linking (paths: /api/v1/auth/identities*).
router.include_router(identities_router, tags=["auth-identities"])
