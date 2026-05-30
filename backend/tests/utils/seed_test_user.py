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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import test_credentials
from app.models.user import User

# Cognito is the sole authentication mechanism — the seeded dev user has
# no local password. It is a shell ``auth.users`` row keyed on the dev
# email; the Cognito provision-or-link path stamps its ``cognito_sub`` on
# first login (matched by verified email), so E2E sign-in works via
# Cognito while this row supplies the profile + superuser/verified grants.


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
        full_name="Dev User",
        is_active=True,
        is_superuser=test_credentials.DEV_USER_IS_SUPERUSER,
        is_verified=test_credentials.DEV_USER_IS_VERIFIED,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
