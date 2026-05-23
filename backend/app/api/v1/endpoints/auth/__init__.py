"""
Authentication endpoints package.

Provides authentication endpoints including:
- JWT authentication (login, logout, refresh)
- Device management
- Device verification
- Password management
- Bootstrap-first-admin (one-shot endpoint to promote initial superuser)
"""

# Import sub-routers
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.auth.bootstrap import router as bootstrap_router
from app.api.v1.endpoints.auth.devices import router as devices_router
from app.api.v1.endpoints.auth.jwt import router as jwt_router
from app.api.v1.endpoints.auth.password import router as password_router
from app.api.v1.endpoints.auth.verification import router as verification_router
from app.auth.config import fastapi_users
from app.models.user import User as UserModel
from app.schemas.user import UserCreate, UserRead, UserUpdate

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
    row = (
        await db.execute(
            text(
                """
                SELECT o.tenant_id, t.slug
                FROM coord.operators o
                LEFT JOIN coord.tenants t ON t.tenant_id = o.tenant_id
                WHERE LOWER(o.email) = :email
                LIMIT 1
                """
            ),
            {"email": email},
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


# FastAPI-Users routers
# NOTE: We use custom auth routes (login, logout, refresh) in jwt.py instead of
# fastapi-users auto-generated routes because we need HttpOnly cookie support.

# Register user registration route
router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    tags=["auth"],
)

# Register password reset routes
router.include_router(
    fastapi_users.get_reset_password_router(),
    tags=["auth"],
)

# Register email verification routes
router.include_router(
    fastapi_users.get_verify_router(UserRead),
    tags=["auth"],
)

# Register user management routes (me, update, etc.)
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)

# Include custom auth sub-routers
router.include_router(jwt_router, tags=["auth"])
router.include_router(devices_router, tags=["auth"])
router.include_router(verification_router, tags=["auth"])
router.include_router(password_router, tags=["auth"])
router.include_router(bootstrap_router, tags=["auth-bootstrap"])
