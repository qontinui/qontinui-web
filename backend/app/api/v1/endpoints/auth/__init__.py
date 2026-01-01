"""
Authentication endpoints package.

Provides authentication endpoints including:
- JWT authentication (login, logout, refresh)
- Device management
- Device verification
- Password management
- Beta signup
"""

from fastapi import APIRouter

# Import sub-routers
from app.api.v1.endpoints.auth.beta_signup import router as beta_signup_router
from app.api.v1.endpoints.auth.devices import router as devices_router
from app.api.v1.endpoints.auth.jwt import router as jwt_router
from app.api.v1.endpoints.auth.password import router as password_router
from app.api.v1.endpoints.auth.verification import router as verification_router
from app.auth.config import fastapi_users
from app.schemas.user import UserCreate, UserRead, UserUpdate

# Main auth router
router = APIRouter()

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
router.include_router(beta_signup_router, tags=["auth"])
