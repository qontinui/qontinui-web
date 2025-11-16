"""
Seed snapshot data for E2E tests

Creates test snapshot runs in the database for Playwright tests to use.
"""

import asyncio
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import snapshot as snapshot_crud


async def create_test_snapshots(db: AsyncSession) -> list[str]:
    """
    Create test snapshot runs for E2E tests

    Returns:
        List of run_ids that were created
    """
    run_ids = []

    # Snapshot 1: Login Flow Test
    run_id_1 = f"test-run-{uuid4()}"
    snapshot1 = await snapshot_crud.create_snapshot_run(
        db=db,
        run_id=run_id_1,
        run_name="Login Flow Test",
        timestamp=datetime.utcnow() - timedelta(days=1),
        states=["login", "dashboard"],
        tags=["e2e", "login"],
        metadata={"test": True, "environment": "ci"},
    )

    # Add screenshots to snapshot 1
    for i in range(8):
        state = "login" if i < 4 else "dashboard"
        await snapshot_crud.add_screenshot(
            db=db,
            snapshot_run_id=snapshot1.id,
            screenshot_path=f"test_login_flow_screenshot_{i+1}.png",
            active_states=[state],
            timestamp=datetime.utcnow() - timedelta(days=1, hours=i),
            width=1920,
            height=1080,
            state_hash=f"hash_login_{i+1}",
            metadata={"step": i+1},
        )

    # Add patterns to snapshot 1
    pattern_types = ["button", "input", "text"]
    for i in range(12):
        await snapshot_crud.add_pattern(
            db=db,
            snapshot_run_id=snapshot1.id,
            pattern_id=f"pattern-login-{uuid4()}",
            name=f"login_pattern_{i+1}",
            type=pattern_types[i % len(pattern_types)],
            screenshot_path=f"test_login_flow_screenshot_{(i % 8) + 1}.png",
            region={"x": 100 + (i * 50), "y": 100 + (i * 30), "w": 150, "h": 40},
            active_states=["login" if i < 6 else "dashboard"],
            confidence=0.85 + (i * 0.01),
            metadata={"auto_detected": True},
        )

    run_ids.append(run_id_1)

    # Snapshot 2: Settings Navigation Test
    run_id_2 = f"test-run-{uuid4()}"
    snapshot2 = await snapshot_crud.create_snapshot_run(
        db=db,
        run_id=run_id_2,
        run_name="Settings Navigation Test",
        timestamp=datetime.utcnow() - timedelta(hours=2),
        states=["settings", "profile"],
        tags=["e2e", "settings"],
        metadata={"test": True, "environment": "ci"},
    )

    # Add screenshots to snapshot 2
    for i in range(6):
        state = "settings" if i < 3 else "profile"
        await snapshot_crud.add_screenshot(
            db=db,
            snapshot_run_id=snapshot2.id,
            screenshot_path=f"test_settings_screenshot_{i+1}.png",
            active_states=[state],
            timestamp=datetime.utcnow() - timedelta(hours=2, minutes=i*10),
            width=1920,
            height=1080,
            state_hash=f"hash_settings_{i+1}",
            metadata={"step": i+1},
        )

    # Add patterns to snapshot 2
    for i in range(10):
        await snapshot_crud.add_pattern(
            db=db,
            snapshot_run_id=snapshot2.id,
            pattern_id=f"pattern-settings-{uuid4()}",
            name=f"settings_pattern_{i+1}",
            type=pattern_types[i % len(pattern_types)],
            screenshot_path=f"test_settings_screenshot_{(i % 6) + 1}.png",
            region={"x": 100 + (i * 40), "y": 100 + (i * 25), "w": 150, "h": 40},
            active_states=["settings" if i < 5 else "profile"],
            confidence=0.88 + (i * 0.01),
            metadata={"auto_detected": True},
        )

    run_ids.append(run_id_2)

    # Snapshot 3: Complete Workflow Test
    run_id_3 = f"test-run-{uuid4()}"
    snapshot3 = await snapshot_crud.create_snapshot_run(
        db=db,
        run_id=run_id_3,
        run_name="Complete Workflow Test",
        timestamp=datetime.utcnow() - timedelta(hours=1),
        states=["login", "dashboard", "settings"],
        tags=["e2e", "complete"],
        metadata={"test": True, "environment": "ci"},
    )

    # Add screenshots to snapshot 3
    states_list = ["login", "login", "dashboard", "dashboard",
                   "dashboard", "settings", "settings", "dashboard",
                   "dashboard", "login"]
    for i in range(10):
        await snapshot_crud.add_screenshot(
            db=db,
            snapshot_run_id=snapshot3.id,
            screenshot_path=f"test_complete_screenshot_{i+1}.png",
            active_states=[states_list[i]],
            timestamp=datetime.utcnow() - timedelta(hours=1, minutes=i*5),
            width=1920,
            height=1080,
            state_hash=f"hash_complete_{i+1}",
            metadata={"step": i+1},
        )

    # Add patterns to snapshot 3
    for i in range(15):
        await snapshot_crud.add_pattern(
            db=db,
            snapshot_run_id=snapshot3.id,
            pattern_id=f"pattern-complete-{uuid4()}",
            name=f"complete_pattern_{i+1}",
            type=pattern_types[i % len(pattern_types)],
            screenshot_path=f"test_complete_screenshot_{(i % 10) + 1}.png",
            region={"x": 100 + (i * 45), "y": 100 + (i * 28), "w": 150, "h": 40},
            active_states=[states_list[i % 10]],
            confidence=0.87 + (i * 0.005),
            metadata={"auto_detected": True},
        )

    run_ids.append(run_id_3)

    return run_ids


async def clear_test_snapshots(db: AsyncSession) -> None:
    """
    Clear all test snapshot runs (snapshots with 'test' metadata)
    """
    # Get all snapshots
    snapshots, _ = await snapshot_crud.list_snapshot_runs(db, limit=1000)

    # Delete test snapshots
    for snapshot in snapshots:
        if snapshot.run_metadata.get("test") is True:
            await snapshot_crud.delete_snapshot_run(db, snapshot.run_id)
