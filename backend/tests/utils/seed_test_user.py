"""
Seed the dev test user for E2E tests.

Playwright's `auth.setup.ts` logs in as the dev user defined in
`dev-credentials.json` (the cross-repo single source of truth; see
`frontend/tests/e2e/test-credentials.ts`). On a fresh CI database
the `users` table is empty, so the login 401s and every downstream
test that depends on `[setup]` fails.

This script creates the user defined in `app.core.test_credentials`
(the cross-repo single source of truth) before the snapshot seeder
runs. Idempotent — skips creation if a user with the matching email
already exists.
"""

from fastapi_users.password import PasswordHelper
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import test_credentials
from app.models.user import User

# Use fastapi-users' own PasswordHelper to hash the seeded password.
# The auth manager (`app/auth/config.py:284`) verifies via
# `self.password_helper.verify_and_update(...)`, which is the same
# helper. Passing a hash from `app.core.security.get_password_hash`
# (passlib's CryptContext with schemes=["argon2", "bcrypt"]) is
# subtly incompatible — fastapi-users' default helper uses pwdlib
# under the hood, and even when both produce argon2 hashes the
# parameter sets differ enough that `verify_and_update` returns False.
# Going through the same helper guarantees verifier compatibility.
_password_helper = PasswordHelper()


async def create_test_user(db: AsyncSession) -> User:
    """Create or return the dev test user matching app.core.test_credentials."""
    result = await db.execute(
        select(User).filter(User.email == test_credentials.DEV_USER_EMAIL)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    user = User(
        email=test_credentials.DEV_USER_EMAIL,
        username=test_credentials.DEV_USER_USERNAME,
        hashed_password=_password_helper.hash(test_credentials.DEV_USER_PASSWORD),
        full_name="Dev User",
        is_active=True,
        is_superuser=test_credentials.DEV_USER_IS_SUPERUSER,
        is_verified=test_credentials.DEV_USER_IS_VERIFIED,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
