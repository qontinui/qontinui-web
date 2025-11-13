"""
CRUD operations for snapshots
"""

from datetime import datetime
from typing import Any

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.snapshot import Pattern, Screenshot, SnapshotRun


def create_snapshot_run(
    db: Session,
    run_id: str,
    run_name: str,
    timestamp: datetime,
    states: list[str],
    project_id: int | None = None,
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
    db.commit()
    db.refresh(snapshot_run)
    return snapshot_run


def get_snapshot_run(db: Session, run_id: str) -> SnapshotRun | None:
    """Get a snapshot run by run_id"""
    return db.query(SnapshotRun).filter(SnapshotRun.run_id == run_id).first()


def get_snapshot_run_by_id(db: Session, id: int) -> SnapshotRun | None:
    """Get a snapshot run by database ID"""
    return db.query(SnapshotRun).filter(SnapshotRun.id == id).first()


def list_snapshot_runs(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    project_id: int | None = None,
    workflow_id: int | None = None,
    tags: list[str] | None = None,
) -> tuple[list[SnapshotRun], int]:
    """
    List snapshot runs with optional filtering

    Returns:
        tuple of (runs, total_count)
    """
    query = db.query(SnapshotRun)

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
    total = query.count()

    # Order by timestamp descending (most recent first)
    runs = query.order_by(desc(SnapshotRun.timestamp)).offset(skip).limit(limit).all()

    return runs, total


def update_snapshot_run(
    db: Session,
    run_id: str,
    **kwargs: Any,
) -> SnapshotRun | None:
    """Update a snapshot run"""
    snapshot_run = get_snapshot_run(db, run_id)
    if not snapshot_run:
        return None

    for key, value in kwargs.items():
        if hasattr(snapshot_run, key) and value is not None:
            setattr(snapshot_run, key, value)

    snapshot_run.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(snapshot_run)
    return snapshot_run


def delete_snapshot_run(db: Session, run_id: str) -> bool:
    """Delete a snapshot run and all associated data"""
    snapshot_run = get_snapshot_run(db, run_id)
    if not snapshot_run:
        return False

    db.delete(snapshot_run)
    db.commit()
    return True


def add_screenshot(
    db: Session,
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
    snapshot_run = get_snapshot_run_by_id(db, snapshot_run_id)
    if snapshot_run:
        snapshot_run.num_screenshots += 1
        snapshot_run.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(screenshot)
    return screenshot


def add_pattern(
    db: Session,
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
    snapshot_run = get_snapshot_run_by_id(db, snapshot_run_id)
    if snapshot_run:
        snapshot_run.num_patterns += 1
        snapshot_run.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(pattern)
    return pattern


def get_screenshots_by_state(
    db: Session,
    snapshot_run_id: int,
    state_name: str,
) -> list[Screenshot]:
    """Get all screenshots from a snapshot run that include a specific state"""
    return (
        db.query(Screenshot)
        .filter(
            Screenshot.snapshot_run_id == snapshot_run_id,
            Screenshot.active_states.contains([state_name]),
        )
        .all()
    )


def get_patterns_by_state(
    db: Session,
    snapshot_run_id: int,
    state_name: str,
) -> list[Pattern]:
    """Get all patterns from a snapshot run that are active in a specific state"""
    return (
        db.query(Pattern)
        .filter(
            Pattern.snapshot_run_id == snapshot_run_id,
            Pattern.active_states.contains([state_name]),
        )
        .all()
    )


def get_patterns_by_type(
    db: Session,
    snapshot_run_id: int,
    pattern_type: str,
) -> list[Pattern]:
    """Get all patterns of a specific type from a snapshot run"""
    return (
        db.query(Pattern)
        .filter(
            Pattern.snapshot_run_id == snapshot_run_id,
            Pattern.type == pattern_type,
        )
        .all()
    )
