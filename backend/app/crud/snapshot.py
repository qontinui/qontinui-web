"""
CRUD operations for snapshots (async)
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.snapshot import Pattern, Screenshot, SnapshotRun


async def create_snapshot_run(
    db: AsyncSession,
    run_id: str,
    run_name: str,
    timestamp: datetime,
    states: list[str],
    project_id: UUID | None = None,
    workflow_id: int | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> SnapshotRun:
    """Create a new snapshot run"""
    snapshot_run = SnapshotRun(
        run_id=run_id,
        run_name=run_name,
        timestamp=timestamp,
        states=states,
        project_id=project_id,
        workflow_id=workflow_id,
        description=description,
        tags=tags or [],
        run_metadata=metadata or {},
        num_screenshots=0,
        num_patterns=0,
    )
    db.add(snapshot_run)
    await db.commit()
    await db.refresh(snapshot_run)
    return snapshot_run


async def get_snapshot_run(db: AsyncSession, run_id: str) -> SnapshotRun | None:
    """Get a snapshot run by run_id"""
    result = await db.execute(select(SnapshotRun).filter(SnapshotRun.run_id == run_id))
    return result.scalar_one_or_none()


async def get_snapshot_run_by_id(db: AsyncSession, id: int) -> SnapshotRun | None:
    """Get a snapshot run by database ID"""
    result = await db.execute(select(SnapshotRun).filter(SnapshotRun.id == id))
    return result.scalar_one_or_none()


async def list_snapshot_runs(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 50,
    project_id: UUID | None = None,
    workflow_id: int | None = None,
    tags: list[str] | None = None,
) -> tuple[list[SnapshotRun], int]:
    """
    List snapshot runs with optional filtering

    Returns:
        tuple of (runs, total_count)
    """
    query = select(SnapshotRun)

    # Apply filters
    if project_id is not None:
        query = query.filter(SnapshotRun.project_id == project_id)

    if workflow_id is not None:
        query = query.filter(SnapshotRun.workflow_id == workflow_id)

    if tags:
        # Filter by tags (runs that have ANY of the specified tags)
        for tag in tags:
            query = query.filter(SnapshotRun.tags.contains([tag]))

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by timestamp descending (most recent first)
    query = query.order_by(desc(SnapshotRun.timestamp)).offset(skip).limit(limit)
    result = await db.execute(query)
    runs = list(result.scalars().all())

    return runs, total


async def update_snapshot_run(
    db: AsyncSession,
    run_id: str,
    **kwargs: Any,
) -> SnapshotRun | None:
    """Update a snapshot run"""
    snapshot_run = await get_snapshot_run(db, run_id)
    if not snapshot_run:
        return None

    for key, value in kwargs.items():
        if hasattr(snapshot_run, key) and value is not None:
            setattr(snapshot_run, key, value)

    snapshot_run.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(snapshot_run)
    return snapshot_run


async def delete_snapshot_run(db: AsyncSession, run_id: str) -> bool:
    """Delete a snapshot run and all associated data"""
    snapshot_run = await get_snapshot_run(db, run_id)
    if not snapshot_run:
        return False

    await db.delete(snapshot_run)
    await db.commit()
    return True


async def add_screenshot(
    db: AsyncSession,
    snapshot_run_id: int,
    screenshot_path: str,
    active_states: list[str],
    timestamp: datetime,
    width: int,
    height: int,
    state_hash: str,
    metadata: dict[str, Any] | None = None,
) -> Screenshot:
    """Add a screenshot to a snapshot run"""
    screenshot = Screenshot(
        snapshot_run_id=snapshot_run_id,
        screenshot_path=screenshot_path,
        active_states=active_states,
        timestamp=timestamp,
        width=width,
        height=height,
        state_hash=state_hash,
        screenshot_metadata=metadata or {},
    )
    db.add(screenshot)

    # Update snapshot run screenshot count
    snapshot_run = await get_snapshot_run_by_id(db, snapshot_run_id)
    if snapshot_run:
        snapshot_run.num_screenshots += 1
        snapshot_run.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(screenshot)
    return screenshot


async def add_pattern(
    db: AsyncSession,
    snapshot_run_id: int,
    pattern_id: str,
    name: str,
    type: str,
    screenshot_path: str,
    region: dict[str, Any],
    active_states: list[str],
    confidence: float,
    metadata: dict[str, Any] | None = None,
) -> Pattern:
    """Add a pattern to a snapshot run"""
    pattern = Pattern(
        snapshot_run_id=snapshot_run_id,
        pattern_id=pattern_id,
        name=name,
        type=type,
        screenshot_path=screenshot_path,
        region=region,
        active_states=active_states,
        confidence=confidence,
        pattern_metadata=metadata or {},
    )
    db.add(pattern)

    # Update snapshot run pattern count
    snapshot_run = await get_snapshot_run_by_id(db, snapshot_run_id)
    if snapshot_run:
        snapshot_run.num_patterns += 1
        snapshot_run.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(pattern)
    return pattern


async def get_screenshots_by_state(
    db: AsyncSession,
    snapshot_run_id: int,
    state_name: str,
) -> list[Screenshot]:
    """Get all screenshots from a snapshot run that include a specific state"""
    query = select(Screenshot).filter(
        Screenshot.snapshot_run_id == snapshot_run_id,
        Screenshot.active_states.contains([state_name]),
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_patterns_by_state(
    db: AsyncSession,
    snapshot_run_id: int,
    state_name: str,
) -> list[Pattern]:
    """Get all patterns from a snapshot run that are active in a specific state"""
    query = select(Pattern).filter(
        Pattern.snapshot_run_id == snapshot_run_id,
        Pattern.active_states.contains([state_name]),
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_patterns_by_type(
    db: AsyncSession,
    snapshot_run_id: int,
    pattern_type: str,
) -> list[Pattern]:
    """Get all patterns of a specific type from a snapshot run"""
    query = select(Pattern).filter(
        Pattern.snapshot_run_id == snapshot_run_id,
        Pattern.type == pattern_type,
    )
    result = await db.execute(query)
    return list(result.scalars().all())
