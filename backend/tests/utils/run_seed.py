"""
Script to seed test snapshot data for E2E tests.
This is called from the Playwright global-setup.
"""

import asyncio

# Cloud-control side-effect import — must run before any `app.models` /
# `app.db.base_class` import so cloud-control's add_model_registrar() hook
# is in place by the time `app/models/__init__.py`'s `register_cloud_models()`
# fires. Without this, cloud-only model classes (Subscription,
# AdminNotificationSettings) never get registered on Base.metadata and the
# User mapper fails to resolve `relationship('Subscription')`. The production
# app does this at `app/main.py:18`; this seed script imports
# `app.db.base_class` directly, bypassing main.py, so we mirror it here.
# OSS-only setups have no cloud-control package; ImportError is silently
# swallowed and the OSS seed flow runs normally.
try:
    import qontinui_cloud_control  # noqa: F401  -- side-effect: registers extension hooks
except ImportError:
    pass

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
