"""
CRUD operations for software testing models.

Provides database operations for test runs, transitions, deficiencies,
coverage snapshots, and test screenshots.
"""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from app.models.coverage_snapshot import CoverageSnapshot
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import (DeficiencySeverity, DeficiencyStatus,
                                        DeficiencyType, TestDeficiency)
from app.models.test_screenshot import TestScreenshot, TestScreenshotType
from app.models.transition_execution import (TransitionExecution,
                                             TransitionExecutionStatus)
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

# ============================================================================
# Test Run CRUD
# ============================================================================


async def create_test_run(
    db: AsyncSession,
    project_id: UUID,
    runner_connection_id: int | None,
    workflow_id: str | None,
    configuration_snapshot: dict[str, Any],
    test_mode: str | None = None,
    max_duration_seconds: int = 3600,
    seed_value: str | None = None,
    runner_metadata: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> SoftwareTestRun:
    """Create a new test run."""
    test_run = SoftwareTestRun(
        project_id=project_id,
        runner_connection_id=runner_connection_id,
        workflow_id=workflow_id,
        status=TestRunStatus.RUNNING,
        started_at=datetime.now(UTC),
        configuration_snapshot=configuration_snapshot,
        test_mode=test_mode,
        max_duration_seconds=max_duration_seconds,
        seed_value=seed_value,
        runner_metadata=runner_metadata or {},
        tags=tags or [],
    )
    db.add(test_run)
    await db.commit()
    await db.refresh(test_run)
    return test_run


async def get_test_run(
    db: AsyncSession, test_run_id: UUID, load_relations: bool = False
) -> SoftwareTestRun | None:
    """Get a test run by ID."""
    query = select(SoftwareTestRun).filter(SoftwareTestRun.id == test_run_id)

    if load_relations:
        query = query.options(
            selectinload(SoftwareTestRun.transition_executions),
            selectinload(SoftwareTestRun.deficiencies),
            selectinload(SoftwareTestRun.coverage_snapshots),
            selectinload(SoftwareTestRun.screenshots),
        )

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def list_test_runs(
    db: AsyncSession,
    project_id: UUID,
    skip: int = 0,
    limit: int = 50,
    status: TestRunStatus | None = None,
    workflow_id: str | None = None,
) -> tuple[list[SoftwareTestRun], int]:
    """
    List test runs for a project with filtering.

    Returns:
        tuple of (runs, total_count)
    """
    query = select(SoftwareTestRun).filter(SoftwareTestRun.project_id == project_id)

    if status:
        query = query.filter(SoftwareTestRun.status == status)

    if workflow_id:
        query = query.filter(SoftwareTestRun.workflow_id == workflow_id)

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by started_at descending (most recent first)
    query = query.order_by(desc(SoftwareTestRun.started_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    runs = list(result.scalars().all())

    return runs, total


async def update_test_run(
    db: AsyncSession, test_run_id: UUID, **kwargs: Any
) -> SoftwareTestRun | None:
    """Update a test run."""
    test_run = await get_test_run(db, test_run_id)
    if not test_run:
        return None

    for key, value in kwargs.items():
        if hasattr(test_run, key) and value is not None:
            setattr(test_run, key, value)

    test_run.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(test_run)
    return test_run


async def complete_test_run(
    db: AsyncSession,
    test_run_id: UUID,
    status: TestRunStatus,
    error_summary: str | None = None,
) -> SoftwareTestRun | None:
    """Complete a test run and update final statistics."""
    test_run = await get_test_run(db, test_run_id)
    if not test_run:
        return None

    test_run.status = status
    test_run.completed_at = datetime.now(UTC)
    test_run.error_summary = error_summary
    test_run.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(test_run)
    return test_run


async def delete_test_run(db: AsyncSession, test_run_id: UUID) -> bool:
    """Delete a test run and all associated data."""
    test_run = await get_test_run(db, test_run_id)
    if not test_run:
        return False

    await db.delete(test_run)
    await db.commit()
    return True


# ============================================================================
# Transition Execution CRUD
# ============================================================================


async def create_transition_execution(
    db: AsyncSession,
    test_run_id: UUID,
    transition_id: str,
    sequence_number: int,
    status: TransitionExecutionStatus,
    started_at: datetime,
    transition_name: str | None = None,
    completed_at: datetime | None = None,
    execution_time_ms: int | None = None,
    error_type: str | None = None,
    error_message: str | None = None,
    error_stacktrace: str | None = None,
    screenshot_urls: list[str] | None = None,
    video_url: str | None = None,
    source_state: str | None = None,
    target_state: str | None = None,
    actual_state: str | None = None,
    state_match: bool | None = None,
    input_data: dict[str, Any] | None = None,
    output_data: dict[str, Any] | None = None,
    path_sequence: list[str] | None = None,
    path_depth: int | None = None,
    action_count: int = 0,
    retry_count: int = 0,
    execution_metadata: dict[str, Any] | None = None,
) -> TransitionExecution:
    """Create a new transition execution."""
    transition = TransitionExecution(
        test_run_id=test_run_id,
        transition_id=transition_id,
        transition_name=transition_name,
        sequence_number=sequence_number,
        status=status,
        started_at=started_at,
        completed_at=completed_at,
        execution_time_ms=execution_time_ms,
        error_type=error_type,
        error_message=error_message,
        error_stacktrace=error_stacktrace,
        screenshot_urls=screenshot_urls or [],
        video_url=video_url,
        source_state=source_state,
        target_state=target_state,
        actual_state=actual_state,
        state_match=state_match,
        input_data=input_data or {},
        output_data=output_data or {},
        path_sequence=path_sequence or [],
        path_depth=path_depth,
        action_count=action_count,
        retry_count=retry_count,
        execution_metadata=execution_metadata or {},
    )
    db.add(transition)

    # Update test run statistics
    test_run = await get_test_run(db, test_run_id)
    if test_run:
        test_run.total_transitions += 1
        if status == TransitionExecutionStatus.SUCCESS:
            test_run.successful_transitions += 1
        elif status == TransitionExecutionStatus.FAILED:
            test_run.failed_transitions += 1
        elif status == TransitionExecutionStatus.SKIPPED:
            test_run.skipped_transitions += 1
        test_run.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(transition)
    return transition


async def get_transition_execution(
    db: AsyncSession, transition_execution_id: UUID
) -> TransitionExecution | None:
    """Get a transition execution by ID."""
    result = await db.execute(
        select(TransitionExecution).filter(
            TransitionExecution.id == transition_execution_id
        )
    )
    return result.scalar_one_or_none()


async def list_transition_executions(
    db: AsyncSession,
    test_run_id: UUID,
    skip: int = 0,
    limit: int = 100,
    status: TransitionExecutionStatus | None = None,
) -> tuple[list[TransitionExecution], int]:
    """
    List transition executions for a test run.

    Returns:
        tuple of (transitions, total_count)
    """
    query = select(TransitionExecution).filter(
        TransitionExecution.test_run_id == test_run_id
    )

    if status:
        query = query.filter(TransitionExecution.status == status)

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by sequence number
    query = (
        query.order_by(TransitionExecution.sequence_number).offset(skip).limit(limit)
    )
    result = await db.execute(query)
    transitions = list(result.scalars().all())

    return transitions, total


# ============================================================================
# Test Deficiency CRUD
# ============================================================================


async def create_test_deficiency(
    db: AsyncSession,
    test_run_id: UUID,
    severity: DeficiencySeverity,
    deficiency_type: DeficiencyType,
    title: str,
    description: str,
    transition_execution_id: UUID | None = None,
    assigned_to_user_id: UUID | None = None,
    category: str | None = None,
    screenshot_urls: list[str] | None = None,
    video_url: str | None = None,
    reproduction_steps: list[str] | None = None,
    reproduction_rate: Decimal | None = None,
    reproducible: bool = True,
    environment_info: dict[str, Any] | None = None,
    preconditions: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    custom_fields: dict[str, Any] | None = None,
) -> TestDeficiency:
    """Create a new test deficiency."""
    deficiency = TestDeficiency(
        test_run_id=test_run_id,
        transition_execution_id=transition_execution_id,
        assigned_to_user_id=assigned_to_user_id,
        severity=severity,
        deficiency_type=deficiency_type,
        category=category,
        title=title,
        description=description,
        screenshot_urls=screenshot_urls or [],
        video_url=video_url,
        reproduction_steps=reproduction_steps or [],
        reproduction_rate=reproduction_rate,
        reproducible=reproducible,
        environment_info=environment_info or {},
        preconditions=preconditions or {},
        status=DeficiencyStatus.NEW,
        first_seen_at=datetime.now(UTC),
        last_seen_at=datetime.now(UTC),
        occurrence_count=1,
        tags=tags or [],
        custom_fields=custom_fields or {},
    )
    db.add(deficiency)

    # Update test run deficiency count
    test_run = await get_test_run(db, test_run_id)
    if test_run:
        test_run.deficiencies_found += 1
        test_run.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(deficiency)
    return deficiency


async def get_test_deficiency(
    db: AsyncSession, deficiency_id: UUID
) -> TestDeficiency | None:
    """Get a test deficiency by ID."""
    result = await db.execute(
        select(TestDeficiency).filter(TestDeficiency.id == deficiency_id)
    )
    return result.scalar_one_or_none()


async def list_test_deficiencies(
    db: AsyncSession,
    test_run_id: UUID | None = None,
    project_id: UUID | None = None,
    skip: int = 0,
    limit: int = 50,
    severity: DeficiencySeverity | None = None,
    status: DeficiencyStatus | None = None,
    deficiency_type: DeficiencyType | None = None,
) -> tuple[list[TestDeficiency], int]:
    """
    List test deficiencies with filtering.

    Returns:
        tuple of (deficiencies, total_count)
    """
    query = select(TestDeficiency)

    if test_run_id:
        query = query.filter(TestDeficiency.test_run_id == test_run_id)

    if project_id:
        # Join with test runs to filter by project
        query = query.join(SoftwareTestRun).filter(
            SoftwareTestRun.project_id == project_id
        )

    if severity:
        query = query.filter(TestDeficiency.severity == severity)

    if status:
        query = query.filter(TestDeficiency.status == status)

    if deficiency_type:
        query = query.filter(TestDeficiency.deficiency_type == deficiency_type)

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by first_seen_at descending
    query = query.order_by(desc(TestDeficiency.first_seen_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    deficiencies = list(result.scalars().all())

    return deficiencies, total


async def update_test_deficiency(
    db: AsyncSession, deficiency_id: UUID, **kwargs: Any
) -> TestDeficiency | None:
    """Update a test deficiency."""
    deficiency = await get_test_deficiency(db, deficiency_id)
    if not deficiency:
        return None

    for key, value in kwargs.items():
        if hasattr(deficiency, key) and value is not None:
            setattr(deficiency, key, value)

    deficiency.updated_at = datetime.now(UTC)

    # Set resolved_at if status is resolved
    if kwargs.get("status") in [DeficiencyStatus.RESOLVED, DeficiencyStatus.CLOSED]:
        deficiency.resolved_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(deficiency)
    return deficiency


async def delete_test_deficiency(db: AsyncSession, deficiency_id: UUID) -> bool:
    """Delete a test deficiency."""
    deficiency = await get_test_deficiency(db, deficiency_id)
    if not deficiency:
        return False

    await db.delete(deficiency)
    await db.commit()
    return True


# ============================================================================
# Coverage Snapshot CRUD
# ============================================================================


async def create_coverage_snapshot(
    db: AsyncSession,
    project_id: UUID,
    test_run_id: UUID | None,
    workflow_id: str | None,
    transitions_covered: int,
    transitions_total: int,
    coverage_percentage: Decimal,
    states_covered: int,
    states_total: int,
    state_coverage_percentage: Decimal,
    paths_discovered: int,
    unique_paths: int,
    coverage_map: dict[str, int] | None = None,
    state_coverage_map: dict[str, int] | None = None,
    uncovered_transitions: list[str] | None = None,
    uncovered_states: list[str] | None = None,
    snapshot_metadata: dict[str, Any] | None = None,
) -> CoverageSnapshot:
    """Create a new coverage snapshot."""
    snapshot = CoverageSnapshot(
        test_run_id=test_run_id,
        project_id=project_id,
        workflow_id=workflow_id,
        snapshot_time=datetime.now(UTC),
        transitions_covered=transitions_covered,
        transitions_total=transitions_total,
        coverage_percentage=coverage_percentage,
        states_covered=states_covered,
        states_total=states_total,
        state_coverage_percentage=state_coverage_percentage,
        paths_discovered=paths_discovered,
        unique_paths=unique_paths,
        coverage_map=coverage_map or {},
        state_coverage_map=state_coverage_map or {},
        uncovered_transitions=uncovered_transitions or [],
        uncovered_states=uncovered_states or [],
        snapshot_metadata=snapshot_metadata or {},
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)
    return snapshot


async def get_coverage_snapshot(
    db: AsyncSession, snapshot_id: UUID
) -> CoverageSnapshot | None:
    """Get a coverage snapshot by ID."""
    result = await db.execute(
        select(CoverageSnapshot).filter(CoverageSnapshot.id == snapshot_id)
    )
    return result.scalar_one_or_none()


async def list_coverage_snapshots(
    db: AsyncSession,
    project_id: UUID | None = None,
    test_run_id: UUID | None = None,
    workflow_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[CoverageSnapshot], int]:
    """
    List coverage snapshots with filtering.

    Returns:
        tuple of (snapshots, total_count)
    """
    query = select(CoverageSnapshot)

    if project_id:
        query = query.filter(CoverageSnapshot.project_id == project_id)

    if test_run_id:
        query = query.filter(CoverageSnapshot.test_run_id == test_run_id)

    if workflow_id:
        query = query.filter(CoverageSnapshot.workflow_id == workflow_id)

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by snapshot_time descending
    query = (
        query.order_by(desc(CoverageSnapshot.snapshot_time)).offset(skip).limit(limit)
    )
    result = await db.execute(query)
    snapshots = list(result.scalars().all())

    return snapshots, total


# ============================================================================
# Test Screenshot CRUD
# ============================================================================


async def create_test_screenshot(
    db: AsyncSession,
    test_run_id: UUID,
    screenshot_type: TestScreenshotType,
    storage_path: str,
    width: int,
    height: int,
    transition_execution_id: UUID | None = None,
    deficiency_id: UUID | None = None,
    screenshot_metadata: dict[str, Any] | None = None,
    description: str | None = None,
) -> TestScreenshot:
    """Create a new test screenshot."""
    screenshot = TestScreenshot(
        test_run_id=test_run_id,
        transition_execution_id=transition_execution_id,
        deficiency_id=deficiency_id,
        screenshot_type=screenshot_type,
        storage_path=storage_path,
        width=width,
        height=height,
        captured_at=datetime.now(UTC),
        screenshot_metadata=screenshot_metadata or {},
        description=description,
    )
    db.add(screenshot)
    await db.commit()
    await db.refresh(screenshot)
    return screenshot


async def get_test_screenshot(
    db: AsyncSession, screenshot_id: UUID
) -> TestScreenshot | None:
    """Get a test screenshot by ID."""
    result = await db.execute(
        select(TestScreenshot).filter(TestScreenshot.id == screenshot_id)
    )
    return result.scalar_one_or_none()


async def list_test_screenshots(
    db: AsyncSession,
    test_run_id: UUID | None = None,
    transition_execution_id: UUID | None = None,
    deficiency_id: UUID | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[TestScreenshot], int]:
    """
    List test screenshots with filtering.

    Returns:
        tuple of (screenshots, total_count)
    """
    query = select(TestScreenshot)

    if test_run_id:
        query = query.filter(TestScreenshot.test_run_id == test_run_id)

    if transition_execution_id:
        query = query.filter(
            TestScreenshot.transition_execution_id == transition_execution_id
        )

    if deficiency_id:
        query = query.filter(TestScreenshot.deficiency_id == deficiency_id)

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by captured_at descending
    query = query.order_by(desc(TestScreenshot.captured_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    screenshots = list(result.scalars().all())

    return screenshots, total


async def delete_test_screenshot(db: AsyncSession, screenshot_id: UUID) -> bool:
    """Delete a test screenshot."""
    screenshot = await get_test_screenshot(db, screenshot_id)
    if not screenshot:
        return False

    await db.delete(screenshot)
    await db.commit()
    return True
