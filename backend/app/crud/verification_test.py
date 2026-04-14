"""
CRUD operations for verification tests, test results, and workflow associations.

Provides database operations for creating, reading, updating, and deleting
verification tests and their execution results.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from app.models.test_result import TestResult
from app.models.verification_test import VerificationTest
from app.models.workflow_test_association import WorkflowTestAssociation
from app.schemas.test_result import TestResultCreate, TestResultUpdate
from app.schemas.verification_test import (VerificationTestCreate,
                                           VerificationTestUpdate,
                                           WorkflowTestAssociationCreate,
                                           WorkflowTestAssociationUpdate)
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)


# ===== Verification Test CRUD =====


async def create_verification_test(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID | None,
    test_data: VerificationTestCreate,
) -> VerificationTest:
    """
    Create a new verification test.

    Args:
        db: Database session
        project_id: Project ID
        user_id: User ID (creator)
        test_data: Test creation data

    Returns:
        Created test instance
    """
    test = VerificationTest(
        project_id=project_id,
        created_by_user_id=user_id,
        name=test_data.name,
        description=test_data.description,
        test_type=test_data.test_type,
        category=test_data.category,
        playwright_code=test_data.playwright_code,
        vision_config=(
            test_data.vision_config.model_dump() if test_data.vision_config else None
        ),
        python_code=test_data.python_code,
        repo_test_config=(
            test_data.repo_test_config.model_dump()
            if test_data.repo_test_config
            else None
        ),
        success_criteria=test_data.success_criteria,
        config=test_data.config or {},
        timeout_seconds=test_data.timeout_seconds,
        is_critical=test_data.is_critical,
        enabled=test_data.enabled,
        ai_generated=False,
        tags=test_data.tags or [],
    )

    db.add(test)
    await db.commit()
    await db.refresh(test)

    logger.info(
        "verification_test_created",
        test_id=str(test.id),
        project_id=str(project_id),
        test_type=test_data.test_type,
    )
    return test


async def get_test_by_id(db: AsyncSession, test_id: UUID) -> VerificationTest | None:
    """Get verification test by ID."""
    result = await db.execute(
        select(VerificationTest).where(VerificationTest.id == test_id)
    )
    return result.scalar_one_or_none()


async def get_test_by_project_and_id(
    db: AsyncSession, project_id: UUID, test_id: UUID
) -> VerificationTest | None:
    """Get verification test by project and ID."""
    result = await db.execute(
        select(VerificationTest).where(
            and_(
                VerificationTest.project_id == project_id,
                VerificationTest.id == test_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def update_verification_test(
    db: AsyncSession, test: VerificationTest, update_data: VerificationTestUpdate
) -> VerificationTest:
    """Update a verification test."""
    update_dict = update_data.model_dump(exclude_unset=True)

    # Handle nested configs
    if "vision_config" in update_dict and update_dict["vision_config"]:
        update_dict["vision_config"] = update_dict["vision_config"].model_dump()
    if "repo_test_config" in update_dict and update_dict["repo_test_config"]:
        update_dict["repo_test_config"] = update_dict["repo_test_config"].model_dump()

    for field, value in update_dict.items():
        setattr(test, field, value)

    test.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(test)

    logger.info("verification_test_updated", test_id=str(test.id))
    return test


async def delete_verification_test(db: AsyncSession, test: VerificationTest) -> bool:
    """Delete a verification test."""
    test_id = test.id
    await db.delete(test)
    await db.commit()

    logger.info("verification_test_deleted", test_id=str(test_id))
    return True


async def list_project_tests(
    db: AsyncSession,
    project_id: UUID,
    skip: int = 0,
    limit: int = 100,
    test_type: str | None = None,
    category: str | None = None,
    enabled_only: bool = False,
) -> tuple[list[VerificationTest], int]:
    """
    List verification tests for a project with optional filters.

    Args:
        db: Database session
        project_id: Project ID
        skip: Pagination offset
        limit: Maximum results
        test_type: Filter by test type
        category: Filter by category
        enabled_only: Only return enabled tests

    Returns:
        Tuple of (tests list, total count)
    """
    conditions = [VerificationTest.project_id == project_id]

    if test_type:
        conditions.append(VerificationTest.test_type == test_type)
    if category:
        conditions.append(VerificationTest.category == category)
    if enabled_only:
        conditions.append(VerificationTest.enabled.is_(True))

    # Get total count
    count_result = await db.execute(
        select(func.count(VerificationTest.id)).where(and_(*conditions))
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(VerificationTest)
        .where(and_(*conditions))
        .order_by(desc(VerificationTest.created_at))
        .offset(skip)
        .limit(limit)
    )
    tests = list(result.scalars().all())

    return tests, total


async def search_tests(
    db: AsyncSession,
    project_id: UUID,
    query: str | None = None,
    test_type: str | None = None,
    category: str | None = None,
    tags: list[str] | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[VerificationTest], int]:
    """Search verification tests with filters."""
    conditions = [VerificationTest.project_id == project_id]

    if query:
        search_pattern = f"%{query}%"
        conditions.append(
            or_(
                VerificationTest.name.ilike(search_pattern),
                VerificationTest.description.ilike(search_pattern),
            )
        )

    if test_type:
        conditions.append(VerificationTest.test_type == test_type)
    if category:
        conditions.append(VerificationTest.category == category)
    if tags:
        for tag in tags:
            conditions.append(VerificationTest.tags.contains([tag]))

    count_result = await db.execute(
        select(func.count(VerificationTest.id)).where(and_(*conditions))
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(VerificationTest)
        .where(and_(*conditions))
        .order_by(desc(VerificationTest.created_at))
        .offset(skip)
        .limit(limit)
    )
    tests = list(result.scalars().all())

    return tests, total


# ===== Test Result CRUD =====


async def create_test_result(
    db: AsyncSession, result_data: TestResultCreate
) -> TestResult:
    """Create a new test result."""
    result = TestResult(
        test_id=result_data.test_id,
        task_run_id=result_data.task_run_id,
        execution_run_id=result_data.execution_run_id,
        status=result_data.status,
        started_at=result_data.started_at,
        completed_at=result_data.completed_at,
        duration_ms=result_data.duration_ms,
        output=result_data.output,
        error_message=result_data.error_message,
        structured_output=result_data.structured_output,
        screenshots=result_data.screenshots or [],
        assertions_passed=result_data.assertions_passed,
        assertions_failed=result_data.assertions_failed,
        individual_tests=(
            [t.model_dump() for t in result_data.individual_tests]
            if result_data.individual_tests
            else None
        ),
        coverage=result_data.coverage.model_dump() if result_data.coverage else None,
        exit_code=result_data.exit_code,
    )

    db.add(result)
    await db.commit()
    await db.refresh(result)

    logger.info(
        "test_result_created",
        result_id=str(result.id),
        test_id=str(result_data.test_id),
        status=result_data.status,
    )
    return result


async def get_result_by_id(db: AsyncSession, result_id: UUID) -> TestResult | None:
    """Get test result by ID."""
    result = await db.execute(
        select(TestResult)
        .where(TestResult.id == result_id)
        .options(selectinload(TestResult.test))
    )
    return result.scalar_one_or_none()


async def update_test_result(
    db: AsyncSession, result: TestResult, update_data: TestResultUpdate
) -> TestResult:
    """Update a test result."""
    update_dict = update_data.model_dump(exclude_unset=True)

    if "individual_tests" in update_dict and update_dict["individual_tests"]:
        update_dict["individual_tests"] = [
            t.model_dump() for t in update_dict["individual_tests"]
        ]
    if "coverage" in update_dict and update_dict["coverage"]:
        update_dict["coverage"] = update_dict["coverage"].model_dump()

    for field, value in update_dict.items():
        setattr(result, field, value)

    await db.commit()
    await db.refresh(result)

    logger.info("test_result_updated", result_id=str(result.id))
    return result


async def list_test_results(
    db: AsyncSession,
    test_id: UUID | None = None,
    task_run_id: UUID | None = None,
    execution_run_id: UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[TestResult], int]:
    """List test results with optional filters."""
    conditions = []

    if test_id:
        conditions.append(TestResult.test_id == test_id)
    if task_run_id:
        conditions.append(TestResult.task_run_id == task_run_id)
    if execution_run_id:
        conditions.append(TestResult.execution_run_id == execution_run_id)
    if status:
        conditions.append(TestResult.status == status)

    # Build base queries
    count_query = select(func.count(TestResult.id))
    result_query = (
        select(TestResult)
        .options(selectinload(TestResult.test))
        .order_by(desc(TestResult.created_at))
        .offset(skip)
        .limit(limit)
    )

    # Apply conditions if any
    if conditions:
        query_filter = and_(*conditions)
        count_query = count_query.where(query_filter)
        result_query = result_query.where(query_filter)

    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    result = await db.execute(result_query)
    results = list(result.scalars().all())

    return results, total


async def get_run_test_summary(
    db: AsyncSession,
    task_run_id: UUID | None = None,
    execution_run_id: UUID | None = None,
) -> dict[str, Any]:
    """Get test results summary for a run."""
    conditions = []
    if task_run_id:
        conditions.append(TestResult.task_run_id == task_run_id)
    if execution_run_id:
        conditions.append(TestResult.execution_run_id == execution_run_id)

    if not conditions:
        return {
            "total_tests": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "error": 0,
            "pending": 0,
            "running": 0,
            "pass_rate": 0.0,
            "total_duration_ms": 0,
        }

    query_filter = and_(*conditions)

    # Get counts by status
    result = await db.execute(
        select(
            TestResult.status,
            func.count(TestResult.id).label("count"),
            func.sum(TestResult.duration_ms).label("total_duration"),
        )
        .where(query_filter)
        .group_by(TestResult.status)
    )
    rows = result.all()

    summary = {
        "total_tests": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "error": 0,
        "timeout": 0,
        "pending": 0,
        "running": 0,
        "pass_rate": 0.0,
        "total_duration_ms": 0,
    }

    for row in rows:
        status, count, duration = row
        summary[status] = count
        summary["total_tests"] += count
        if duration:
            summary["total_duration_ms"] += duration

    if summary["total_tests"] > 0:
        summary["pass_rate"] = (summary["passed"] / summary["total_tests"]) * 100

    return summary


# ===== Workflow Test Association CRUD =====


async def create_workflow_association(
    db: AsyncSession,
    project_id: UUID,
    assoc_data: WorkflowTestAssociationCreate,
) -> WorkflowTestAssociation:
    """Create a workflow test association."""
    assoc = WorkflowTestAssociation(
        project_id=project_id,
        test_id=assoc_data.test_id,
        workflow_id=assoc_data.workflow_id,
        trigger_point=assoc_data.trigger_point,
        checkpoint_name=assoc_data.checkpoint_name,
        action_id=assoc_data.action_id,
        execution_order=assoc_data.execution_order,
        enabled=assoc_data.enabled,
    )

    db.add(assoc)
    await db.commit()
    await db.refresh(assoc)

    logger.info(
        "workflow_test_association_created",
        assoc_id=str(assoc.id),
        workflow_id=assoc_data.workflow_id,
        test_id=str(assoc_data.test_id),
    )
    return assoc


async def get_association_by_id(
    db: AsyncSession, assoc_id: UUID
) -> WorkflowTestAssociation | None:
    """Get workflow test association by ID."""
    result = await db.execute(
        select(WorkflowTestAssociation)
        .where(WorkflowTestAssociation.id == assoc_id)
        .options(selectinload(WorkflowTestAssociation.test))
    )
    return result.scalar_one_or_none()


async def update_workflow_association(
    db: AsyncSession,
    assoc: WorkflowTestAssociation,
    update_data: WorkflowTestAssociationUpdate,
) -> WorkflowTestAssociation:
    """Update a workflow test association."""
    update_dict = update_data.model_dump(exclude_unset=True)

    for field, value in update_dict.items():
        setattr(assoc, field, value)

    assoc.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(assoc)

    logger.info("workflow_test_association_updated", assoc_id=str(assoc.id))
    return assoc


async def delete_workflow_association(
    db: AsyncSession, assoc: WorkflowTestAssociation
) -> bool:
    """Delete a workflow test association."""
    assoc_id = assoc.id
    await db.delete(assoc)
    await db.commit()

    logger.info("workflow_test_association_deleted", assoc_id=str(assoc_id))
    return True


async def list_workflow_associations(
    db: AsyncSession,
    project_id: UUID,
    workflow_id: str | None = None,
    test_id: UUID | None = None,
    enabled_only: bool = False,
) -> list[WorkflowTestAssociation]:
    """List workflow test associations with filters."""
    conditions = [WorkflowTestAssociation.project_id == project_id]

    if workflow_id:
        conditions.append(WorkflowTestAssociation.workflow_id == workflow_id)
    if test_id:
        conditions.append(WorkflowTestAssociation.test_id == test_id)
    if enabled_only:
        conditions.append(WorkflowTestAssociation.enabled.is_(True))

    result = await db.execute(
        select(WorkflowTestAssociation)
        .where(and_(*conditions))
        .options(selectinload(WorkflowTestAssociation.test))
        .order_by(
            WorkflowTestAssociation.workflow_id,
            WorkflowTestAssociation.trigger_point,
            WorkflowTestAssociation.execution_order,
        )
    )
    return list(result.scalars().all())


async def get_tests_for_workflow_trigger(
    db: AsyncSession,
    project_id: UUID,
    workflow_id: str,
    trigger_point: str,
    checkpoint_name: str | None = None,
    action_id: str | None = None,
) -> list[VerificationTest]:
    """
    Get tests that should run at a specific workflow trigger point.

    Args:
        db: Database session
        project_id: Project ID
        workflow_id: Workflow ID
        trigger_point: Trigger point (before_workflow, after_workflow, etc.)
        checkpoint_name: Checkpoint name (for on_checkpoint trigger)
        action_id: Action ID (for on_action trigger)

    Returns:
        List of tests to run, ordered by execution_order
    """
    conditions = [
        WorkflowTestAssociation.project_id == project_id,
        WorkflowTestAssociation.workflow_id == workflow_id,
        WorkflowTestAssociation.trigger_point == trigger_point,
        WorkflowTestAssociation.enabled.is_(True),
    ]

    if trigger_point == "on_checkpoint" and checkpoint_name:
        conditions.append(WorkflowTestAssociation.checkpoint_name == checkpoint_name)
    if trigger_point == "on_action" and action_id:
        conditions.append(WorkflowTestAssociation.action_id == action_id)

    result = await db.execute(
        select(WorkflowTestAssociation)
        .where(and_(*conditions))
        .options(selectinload(WorkflowTestAssociation.test))
        .order_by(WorkflowTestAssociation.execution_order)
    )
    associations = result.scalars().all()

    # Return the actual tests, filtering out any with disabled tests
    tests = []
    for assoc in associations:
        if assoc.test and assoc.test.enabled:
            tests.append(assoc.test)

    return tests


# ===== Utility Functions =====


async def get_project_test_stats(db: AsyncSession, project_id: UUID) -> dict[str, Any]:
    """Get verification test statistics for a project."""
    # Count by test type
    type_counts = await db.execute(
        select(
            VerificationTest.test_type,
            func.count(VerificationTest.id).label("count"),
        )
        .where(VerificationTest.project_id == project_id)
        .group_by(VerificationTest.test_type)
    )

    by_type = {row.test_type: row.count for row in type_counts}

    # Count by category
    category_counts = await db.execute(
        select(
            VerificationTest.category,
            func.count(VerificationTest.id).label("count"),
        )
        .where(VerificationTest.project_id == project_id)
        .group_by(VerificationTest.category)
    )

    by_category = {row.category: row.count for row in category_counts}

    # Total count
    total_result = await db.execute(
        select(func.count(VerificationTest.id)).where(
            VerificationTest.project_id == project_id
        )
    )
    total = total_result.scalar_one()

    # Enabled count
    enabled_result = await db.execute(
        select(func.count(VerificationTest.id)).where(
            and_(
                VerificationTest.project_id == project_id,
                VerificationTest.enabled.is_(True),
            )
        )
    )
    enabled = enabled_result.scalar_one()

    return {
        "total_tests": total,
        "enabled_tests": enabled,
        "by_type": by_type,
        "by_category": by_category,
    }


async def get_project_tags(db: AsyncSession, project_id: UUID) -> list[str]:
    """Get all unique tags used in a project's tests."""
    result = await db.execute(
        select(VerificationTest.tags).where(VerificationTest.project_id == project_id)
    )

    unique_tags = set()
    for tag_list in result.scalars().all():
        if tag_list:
            unique_tags.update(tag_list)

    return sorted(unique_tags)
