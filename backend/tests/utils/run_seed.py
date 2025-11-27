"""
Script to seed test snapshot data for E2E tests.
This is called from the Playwright global-setup.
"""

import asyncio

# Import all models first to ensure they're registered with SQLAlchemy
from app.db.base_class import Base  # noqa
from app.db.session import AsyncSessionLocal
from tests.utils.seed_snapshot_data import create_test_snapshots

# Ensure we can import from the backend app
# sys.path is already set by the calling script


async def seed():
    """Seed test snapshots in the database"""
    async with AsyncSessionLocal() as db:
        run_ids = await create_test_snapshots(db)
        print(f"Created {len(run_ids)} test snapshots")


if __name__ == "__main__":
    asyncio.run(seed())
