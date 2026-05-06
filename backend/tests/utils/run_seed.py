"""
Script to seed test snapshot data for E2E tests.
This is called from the Playwright global-setup.
"""

import asyncio
import os

# Cloud-control side-effect import — see backend/tests/conftest.py for the
# full rationale. OSS soft-skip; CI hard-fail.
try:
    import qontinui_cloud_control  # noqa: F401  -- side-effect: registers hooks
except ImportError:
    if os.environ.get("CI") == "true" or os.environ.get("REQUIRE_CLOUD_CONTROL") == "1":
        raise

# Import all models first to ensure they're registered with SQLAlchemy
from app.db.base_class import Base  # noqa
from app.db.session import AsyncSessionLocal
from tests.utils.seed_snapshot_data import create_test_snapshots
from tests.utils.seed_test_user import create_test_user

# Ensure we can import from the backend app
# sys.path is already set by the calling script


async def seed():
    """Seed the dev test user + test snapshots in the database."""
    async with AsyncSessionLocal() as db:
        # User must exist before Playwright's auth.setup.ts logs in;
        # otherwise the login 401s and the [setup] project fails on
        # every retry, blocking all downstream specs.
        user = await create_test_user(db)
        print(f"Test user ready: {user.email}")

        run_ids = await create_test_snapshots(db)
        print(f"Created {len(run_ids)} test snapshots")


if __name__ == "__main__":
    asyncio.run(seed())
