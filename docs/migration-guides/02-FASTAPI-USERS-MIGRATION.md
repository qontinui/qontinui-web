# FastAPI-Users Migration Guide

**Priority:** High (Security & Maintainability)
**Estimated Time:** 3-5 days
**Risk Level:** Medium (authentication is critical)
**Code Reduction:** ~800 lines → ~100 lines (87% reduction)

---

## Overview

This guide walks through replacing custom JWT authentication with `fastapi-users`, the industry-standard authentication library for FastAPI.

## Benefits

- **Remove ~800 lines** of custom auth code
- **Gain OAuth support** (Google, GitHub, etc.)
- **Email verification** workflows built-in
- **Password reset** flows built-in
- **Battle-tested security** - Used by thousands of projects
- **Active maintenance** - Regular security updates
- **Excellent documentation** - Comprehensive guides

---

## Step 1: Install Dependencies

```bash
cd backend
poetry add "fastapi-users[sqlalchemy]>=13.0.0"
```

This includes:
- `fastapi-users` - Core library
- `sqlalchemy` support
- Password hashing (via `passlib`)
- JWT token support

---

## Step 2: Update User Model

### Current Model: `backend/app/models/user.py`

```python
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from app.db.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    # ... other fields
```

### New Model with fastapi-users

```python
import uuid
from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

class User(SQLAlchemyBaseUserTableUUID, Base):
    """
    User model extending fastapi-users base.

    Inherited fields from SQLAlchemyBaseUserTableUUID:
    - id: UUID (primary key)
    - email: String (unique, indexed)
    - hashed_password: String
    - is_active: Boolean
    - is_superuser: Boolean
    - is_verified: Boolean
    """
    __tablename__ = "users"

    # Custom fields (keep your existing fields)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    company: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    subscription_tier: Mapped[str] = mapped_column(String, default="free")

    # Relationships (keep existing)
    # projects = relationship(...)
    # usage_metrics = relationship(...)
    # ...
```

### Key Changes

| Before | After | Notes |
|--------|-------|-------|
| `id: Integer` | `id: UUID` | UUID is more secure |
| `hashed_password: String` | Inherited | Managed by fastapi-users |
| `is_active: Boolean` | Inherited | Built-in field |
| `is_superuser: Boolean` | Inherited | Built-in field |
| `email_verified: Boolean` | `is_verified: Boolean` | Renamed, built-in |

---

## Step 3: Create Database Migration

### Generate Alembic Migration

```bash
cd backend
alembic revision --autogenerate -m "migrate to fastapi-users uuid"
```

### Migration Script Example

```python
"""Migrate to fastapi-users UUID

Revision ID: abc123
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

def upgrade():
    # Add UUID extension
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    # Add new UUID column
    op.add_column('users', sa.Column('uuid_id', postgresql.UUID(), nullable=True))

    # Generate UUIDs for existing users
    op.execute('''
        UPDATE users SET uuid_id = uuid_generate_v4()
    ''')

    # Drop old id column constraints
    op.drop_constraint('users_pkey', 'users', type_='primary')

    # Make uuid_id non-nullable and primary key
    op.alter_column('users', 'uuid_id', nullable=False)
    op.create_primary_key('users_pkey', 'users', ['uuid_id'])

    # Rename column
    op.alter_column('users', 'uuid_id', new_column_name='id')

    # Add fastapi-users fields
    op.add_column('users', sa.Column('is_verified', sa.Boolean(), nullable=False, server_default='false'))

    # Rename email_verified to is_verified if exists
    # op.alter_column('users', 'email_verified', new_column_name='is_verified')

def downgrade():
    # Downgrade logic (revert to integer IDs)
    pass
```

### Apply Migration

```bash
alembic upgrade head
```

---

## Step 4: Set Up fastapi-users Configuration

### Create `backend/app/auth/config.py`

```python
import uuid
from typing import Optional

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.user import User

# ===== USER DATABASE =====

async def get_user_db(session: AsyncSession = Depends(get_db)):
    yield SQLAlchemyUserDatabase(session, User)


# ===== USER MANAGER =====

class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.RESET_PASSWORD_SECRET_KEY
    verification_token_secret = settings.VERIFICATION_SECRET_KEY

    async def on_after_register(self, user: User, request: Optional[Request] = None):
        print(f"User {user.id} has registered.")
        # TODO: Send welcome email

    async def on_after_forgot_password(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        print(f"User {user.id} has forgot their password. Reset token: {token}")
        # TODO: Send password reset email

    async def on_after_request_verify(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        print(f"Verification requested for user {user.id}. Verification token: {token}")
        # TODO: Send verification email


async def get_user_manager(user_db=Depends(get_user_db)):
    yield UserManager(user_db)


# ===== AUTHENTICATION BACKEND =====

bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(
        secret=settings.ACCESS_SECRET_KEY,
        lifetime_seconds=settings.ACCESS_TOKEN_EXPIRE_SECONDS,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)


# ===== FASTAPI USERS INSTANCE =====

fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager,
    [auth_backend],
)

# Export for use in endpoints
current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)
```

---

## Step 5: Update Settings

### Add to `backend/app/core/config.py`

```python
class Settings(BaseSettings):
    # ... existing settings ...

    # fastapi-users secrets (generate new secrets!)
    ACCESS_SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION"
    RESET_PASSWORD_SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION"
    VERIFICATION_SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION"
    ACCESS_TOKEN_EXPIRE_SECONDS: int = 3600  # 1 hour
```

### Generate Secrets

```bash
# Generate 3 different secrets
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Add to `.env`:

```bash
ACCESS_SECRET_KEY=<first-secret>
RESET_PASSWORD_SECRET_KEY=<second-secret>
VERIFICATION_SECRET_KEY=<third-secret>
ACCESS_TOKEN_EXPIRE_SECONDS=3600
```

---

## Step 6: Update API Routes

### Remove Old Auth Routes

**Delete these files:**
- ❌ `backend/app/api/v1/endpoints/auth.py`
- ❌ `backend/app/services/auth/authentication_service.py`
- ❌ `backend/app/services/auth/token_service.py`
- ❌ `backend/app/services/auth/token_blacklist_service.py`
- ❌ `backend/app/services/auth/password_service.py`

### Add fastapi-users Routes

**Create `backend/app/api/v1/endpoints/auth.py`:**

```python
from fastapi import APIRouter
from app.auth.config import (
    auth_backend,
    fastapi_users,
)
from app.schemas.user import UserRead, UserCreate, UserUpdate

router = APIRouter()

# Register fastapi-users routes
router.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/jwt",
    tags=["auth"],
)

router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="",
    tags=["auth"],
)

router.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="",
    tags=["auth"],
)

router.include_router(
    fastapi_users.get_verify_router(UserRead),
    prefix="",
    tags=["auth"],
)

router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)
```

### Update Main App

**In `backend/app/main.py`:**

```python
from app.api.v1.endpoints import auth

# Replace old auth router
app.include_router(
    auth.router,
    prefix="/api/v1/auth",
    tags=["auth"]
)
```

---

## Step 7: Update Schemas

### Create `backend/app/schemas/user.py`

```python
import uuid
from fastapi_users import schemas
from pydantic import EmailStr

class UserRead(schemas.BaseUser[uuid.UUID]):
    """Schema for reading user data."""
    username: str
    full_name: str | None = None
    company: str | None = None
    subscription_tier: str

class UserCreate(schemas.BaseUserCreate):
    """Schema for creating users."""
    username: str
    full_name: str | None = None
    company: str | None = None

class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating users."""
    username: str | None = None
    full_name: str | None = None
    company: str | None = None
```

---

## Step 8: Update Protected Endpoints

### Before

```python
from app.utils.authorization import get_current_user

@router.get("/protected")
async def protected_route(
    current_user: User = Depends(get_current_user)
):
    return {"user": current_user}
```

### After

```python
from app.auth.config import current_active_user

@router.get("/protected")
async def protected_route(
    current_user: User = Depends(current_active_user)
):
    return {"user": current_user}
```

---

## Step 9: New Endpoints Available

### Authentication Endpoints

```bash
# Register
POST /api/v1/auth/register
Body: {"email": "user@example.com", "password": "SecurePass123!", "username": "user"}

# Login
POST /api/v1/auth/jwt/login
Body: username=user@example.com&password=SecurePass123!
Response: {"access_token": "eyJ...", "token_type": "bearer"}

# Logout
POST /api/v1/auth/jwt/logout

# Request password reset
POST /api/v1/auth/forgot-password
Body: {"email": "user@example.com"}

# Reset password
POST /api/v1/auth/reset-password
Body: {"token": "...", "password": "NewPass123!"}

# Request email verification
POST /api/v1/auth/request-verify-token
Body: {"email": "user@example.com"}

# Verify email
POST /api/v1/auth/verify
Body: {"token": "..."}
```

### User Management Endpoints

```bash
# Get current user
GET /api/v1/auth/users/me
Headers: Authorization: Bearer <token>

# Update current user
PATCH /api/v1/auth/users/me
Headers: Authorization: Bearer <token>
Body: {"full_name": "New Name"}

# Get user by ID (admin only)
GET /api/v1/auth/users/{id}

# Update user (admin only)
PATCH /api/v1/auth/users/{id}

# Delete user (admin only)
DELETE /api/v1/auth/users/{id}
```

---

## Step 10: Add OAuth (Optional)

### Google OAuth Example

```bash
poetry add "fastapi-users[sqlalchemy,oauth]"
```

```python
from httpx_oauth.clients.google import GoogleOAuth2

google_oauth_client = GoogleOAuth2(
    settings.GOOGLE_CLIENT_ID,
    settings.GOOGLE_CLIENT_SECRET,
)

# Add OAuth router
router.include_router(
    fastapi_users.get_oauth_router(
        google_oauth_client,
        auth_backend,
        settings.GOOGLE_REDIRECT_URL,
    ),
    prefix="/google",
    tags=["auth"],
)

# OAuth associate router
router.include_router(
    fastapi_users.get_oauth_associate_router(
        google_oauth_client,
        UserRead,
        settings.GOOGLE_REDIRECT_URL,
    ),
    prefix="/google",
    tags=["auth"],
)
```

---

## Step 11: Update Tests

### Example Test

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_register_user(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "SecurePass123!",
            "username": "testuser",
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "test@example.com"
    assert "id" in data

@pytest.mark.asyncio
async def test_login(client: AsyncClient, test_user):
    response = await client.post(
        "/api/v1/auth/jwt/login",
        data={
            "username": "test@example.com",
            "password": "SecurePass123!",
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
```

---

## Step 12: Frontend Updates

### Update API Calls

**Before:**

```typescript
const response = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username, password })
})
```

**After (same, fastapi-users compatible):**

```typescript
// fastapi-users uses same OAuth2 password flow
const response = await fetch('/api/v1/auth/jwt/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: email, password })
})
```

---

## Verification Checklist

- [ ] Dependencies installed
- [ ] User model updated
- [ ] Database migrated
- [ ] Auth configuration created
- [ ] Settings updated with secrets
- [ ] Old auth code removed
- [ ] New routes registered
- [ ] Protected endpoints updated
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Frontend API calls working

---

## Benefits Summary

| Aspect | Before (Custom) | After (fastapi-users) |
|--------|----------------|----------------------|
| Lines of code | ~800 | ~100 |
| OAuth support | Not implemented | Built-in |
| Email verification | Not implemented | Built-in |
| Password reset | Not implemented | Built-in |
| Security updates | Manual | Automatic |
| Documentation | Custom | Official docs |
| Testing | Custom tests | Library tested |

---

## Next Steps

After completing fastapi-users migration:

1. ✅ Test all auth flows thoroughly
2. ✅ Update frontend to use new endpoints
3. ✅ Add email templates for verification/reset
4. ✅ Configure OAuth providers (optional)
5. ➡️ Move to next migration: TanStack Query frontend

---

**Author:** Generated from research
**Last Updated:** 2025-10-13
**Status:** Ready to implement
**Related:** See `TECHNOLOGY_RECOMMENDATIONS.md` for full context
