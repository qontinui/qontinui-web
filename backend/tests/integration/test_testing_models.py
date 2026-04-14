"""
Integration tests for testing system database models.

Tests model creation, relationships, queries, and data integrity
for the software testing system.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from app.models.project import Project
from app.models.runner_connection import RunnerConnection
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.user import User
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .conftest import create_test_deficiencies, create_test_runs


@pytest.mark.asyncio
class TestSoftwareTestRunModel:
    """Test SoftwareTestRun model CRUD operations."""

    async def test_create_test_run(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test creating a new test run."""
        test_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="workflow-001",
            status=TestRunStatus.RUNNING,
            started_at=datetime.now(UTC),
            configuration_snapshot={"strategy": "random_walk"},
            test_mode="exploration",
            runner_metadata={"version": "0.1.0"},
        )

        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        assert test_run.id is not None
        assert test_run.status == TestRunStatus.RUNNING
        assert test_run.project_id == test_project.id

    async def test_update_test_run_metrics(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test updating test run aggregate metrics."""
        # Update metrics
        test_run.total_transitions = 50
        test_run.successful_transitions = 45
        test_run.failed_transitions = 5
        test_run.coverage_percentage = Decimal("75.50")
        test_run.unique_states_visited = 12
        test_run.deficiencies_found = 3

        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        assert test_run.total_transitions == 50
        assert test_run.successful_transitions == 45
        assert test_run.coverage_percentage == Decimal("75.50")

    async def test_complete_test_run(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test completing a test run."""
        completion_time = datetime.now(UTC)

        test_run.status = TestRunStatus.COMPLETED
        test_run.completed_at = completion_time
        test_run.error_summary = "No errors"

        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        assert test_run.status == TestRunStatus.COMPLETED
        assert test_run.completed_at is not None
        assert test_run.completed_at >= test_run.started_at

    async def test_query_runs_by_project(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test querying test runs by project."""
        # Create multiple runs
        await create_test_runs(
            db_session, test_project, test_runner_connection, count=5
        )

        # Query by project
        result = await db_session.execute(
            select(SoftwareTestRun).where(SoftwareTestRun.project_id == test_project.id)
        )
        project_runs = result.scalars().all()

        assert len(project_runs) >= 5
        for run in project_runs:
            assert run.project_id == test_project.id

    async def test_query_runs_by_status(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test querying test runs by status."""
        # Create runs with different statuses
        await create_test_runs(
            db_session,
            test_project,
            test_runner_connection,
            count=3,
            status=TestRunStatus.COMPLETED,
        )
        await create_test_runs(
            db_session,
            test_project,
            test_runner_connection,
            count=2,
            status=TestRunStatus.RUNNING,
        )

        # Query completed runs
        result = await db_session.execute(
            select(SoftwareTestRun).where(
                SoftwareTestRun.status == TestRunStatus.COMPLETED
            )
        )
        completed_runs = result.scalars().all()

        assert len(completed_runs) >= 3
        for run in completed_runs:
            assert run.status == TestRunStatus.COMPLETED

    async def test_query_runs_by_date_range(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test querying test runs by date range."""
        # Create runs with different dates
        past_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="old-workflow",
            status=TestRunStatus.COMPLETED,
            started_at=datetime.now(UTC) - timedelta(days=10),
            completed_at=datetime.now(UTC) - timedelta(days=10, hours=-1),
            configuration_snapshot={},
        )
        recent_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="new-workflow",
            status=TestRunStatus.RUNNING,
            started_at=datetime.now(UTC) - timedelta(hours=1),
            configuration_snapshot={},
        )

        db_session.add_all([past_run, recent_run])
        await db_session.commit()

        # Query last 7 days
        cutoff_date = datetime.now(UTC) - timedelta(days=7)
        result = await db_session.execute(
            select(SoftwareTestRun).where(SoftwareTestRun.started_at >= cutoff_date)
        )
        recent_runs = result.scalars().all()

        assert recent_run in recent_runs
        assert past_run not in recent_runs

    async def test_delete_test_run_cascade(
        self,
        db_session: AsyncSession,
        test_run: SoftwareTestRun,
    ):
        """Test that deleting a test run cascades to related records."""
        # Create related deficiencies
        await create_test_deficiencies(db_session, test_run, count=5)

        # Get run ID before deletion
        run_id = test_run.id

        # Delete test run
        await db_session.delete(test_run)
        await db_session.commit()

        # Verify run is deleted
        result = await db_session.execute(
            select(SoftwareTestRun).where(SoftwareTestRun.id == run_id)
        )
        deleted_run = result.scalar_one_or_none()
        assert deleted_run is None

        # Verify deficiencies are also deleted (cascade)
        result = await db_session.execute(
            select(TestDeficiency).where(TestDeficiency.test_run_id == run_id)
        )
        remaining_deficiencies = result.scalars().all()
        assert len(remaining_deficiencies) == 0


@pytest.mark.asyncio
class TestTestDeficiencyModel:
    """Test TestDeficiency model CRUD operations."""

    async def test_create_deficiency(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test creating a new deficiency."""
        deficiency = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.HIGH,
            deficiency_type=DeficiencyType.FUNCTIONAL,
            title="Test deficiency",
            description="Test description",
            screenshot_urls=["https://example.com/screenshot.png"],
            reproduction_steps=["Step 1", "Step 2"],
            reproducible=True,
            environment_info={"os": "Linux"},
            status=DeficiencyStatus.NEW,
        )

        db_session.add(deficiency)
        await db_session.commit()
        await db_session.refresh(deficiency)

        assert deficiency.id is not None
        assert deficiency.severity == DeficiencySeverity.HIGH
        assert deficiency.test_run_id == test_run.id

    async def test_update_deficiency_status(
        self, db_session: AsyncSession, test_deficiency: TestDeficiency
    ):
        """Test updating deficiency status through lifecycle."""
        # NEW -> TRIAGED
        test_deficiency.status = DeficiencyStatus.TRIAGED
        db_session.add(test_deficiency)
        await db_session.commit()
        await db_session.refresh(test_deficiency)
        assert test_deficiency.status == DeficiencyStatus.TRIAGED

        # TRIAGED -> ASSIGNED
        test_deficiency.status = DeficiencyStatus.ASSIGNED
        test_deficiency.assigned_at = datetime.now(UTC)
        db_session.add(test_deficiency)
        await db_session.commit()
        await db_session.refresh(test_deficiency)
        assert test_deficiency.status == DeficiencyStatus.ASSIGNED
        assert test_deficiency.assigned_at is not None

        # ASSIGNED -> IN_PROGRESS
        test_deficiency.status = DeficiencyStatus.IN_PROGRESS
        db_session.add(test_deficiency)
        await db_session.commit()
        await db_session.refresh(test_deficiency)
        assert test_deficiency.status == DeficiencyStatus.IN_PROGRESS

        # IN_PROGRESS -> RESOLVED
        test_deficiency.status = DeficiencyStatus.RESOLVED
        test_deficiency.resolved_at = datetime.now(UTC)
        test_deficiency.resolution = "fixed"
        db_session.add(test_deficiency)
        await db_session.commit()
        await db_session.refresh(test_deficiency)
        assert test_deficiency.status == DeficiencyStatus.RESOLVED
        assert test_deficiency.resolved_at is not None

    async def test_query_deficiencies_by_severity(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test querying deficiencies by severity."""
        # Create deficiencies with different severities
        critical = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.CRITICAL,
            deficiency_type=DeficiencyType.CRASH,
            title="Critical issue",
            description="System crash",
            status=DeficiencyStatus.NEW,
        )
        low = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.LOW,
            deficiency_type=DeficiencyType.VISUAL,
            title="Visual glitch",
            description="Minor visual issue",
            status=DeficiencyStatus.NEW,
        )

        db_session.add_all([critical, low])
        await db_session.commit()

        # Query critical deficiencies
        result = await db_session.execute(
            select(TestDeficiency).where(
                TestDeficiency.severity == DeficiencySeverity.CRITICAL
            )
        )
        critical_deficiencies = result.scalars().all()

        assert critical in critical_deficiencies
        assert low not in critical_deficiencies

    async def test_query_deficiencies_by_type(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test querying deficiencies by type."""
        # Create deficiencies with different types
        functional = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.MEDIUM,
            deficiency_type=DeficiencyType.FUNCTIONAL,
            title="Functional bug",
            description="Feature not working",
            status=DeficiencyStatus.NEW,
        )
        security = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.HIGH,
            deficiency_type=DeficiencyType.SECURITY,
            title="Security vulnerability",
            description="XSS vulnerability found",
            status=DeficiencyStatus.NEW,
        )

        db_session.add_all([functional, security])
        await db_session.commit()

        # Query security deficiencies
        result = await db_session.execute(
            select(TestDeficiency).where(
                TestDeficiency.deficiency_type == DeficiencyType.SECURITY
            )
        )
        security_deficiencies = result.scalars().all()

        assert security in security_deficiencies
        assert functional not in security_deficiencies

    async def test_query_deficiencies_by_status(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test querying deficiencies by status."""
        # Create deficiencies with different statuses
        await create_test_deficiencies(db_session, test_run, count=3)

        # Update one to resolved
        result = await db_session.execute(
            select(TestDeficiency).where(TestDeficiency.test_run_id == test_run.id)
        )
        deficiencies = result.scalars().all()
        deficiencies[0].status = DeficiencyStatus.RESOLVED
        db_session.add(deficiencies[0])
        await db_session.commit()

        # Query resolved deficiencies
        result = await db_session.execute(
            select(TestDeficiency).where(
                TestDeficiency.status == DeficiencyStatus.RESOLVED
            )
        )
        resolved_deficiencies = result.scalars().all()

        assert len(resolved_deficiencies) >= 1
        assert deficiencies[0] in resolved_deficiencies

    async def test_assign_deficiency_to_user(
        self,
        db_session: AsyncSession,
        test_deficiency: TestDeficiency,
        test_user: User,
    ):
        """Test assigning a deficiency to a user."""
        test_deficiency.assigned_to_user_id = test_user.id
        test_deficiency.status = DeficiencyStatus.ASSIGNED
        test_deficiency.assigned_at = datetime.now(UTC)

        db_session.add(test_deficiency)
        await db_session.commit()
        await db_session.refresh(test_deficiency)

        assert test_deficiency.assigned_to_user_id == test_user.id
        assert test_deficiency.status == DeficiencyStatus.ASSIGNED


@pytest.mark.asyncio
class TestModelRelationships:
    """Test relationships between models."""

    async def test_test_run_project_relationship(
        self, db_session: AsyncSession, test_run: SoftwareTestRun, test_project: Project
    ):
        """Test relationship between test run and project."""
        # Access project through relationship
        await db_session.refresh(test_run, ["project"])

        assert test_run.project is not None
        assert test_run.project.id == test_project.id
        assert test_run.project.name == test_project.name

    async def test_test_run_deficiencies_relationship(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test relationship between test run and deficiencies."""
        # Create deficiencies
        await create_test_deficiencies(db_session, test_run, count=5)

        # Refresh to load relationship
        await db_session.refresh(test_run, ["deficiencies"])

        assert len(test_run.deficiencies) == 5
        for deficiency in test_run.deficiencies:
            assert deficiency.test_run_id == test_run.id

    async def test_deficiency_test_run_relationship(
        self,
        db_session: AsyncSession,
        test_deficiency: TestDeficiency,
        test_run: SoftwareTestRun,
    ):
        """Test relationship between deficiency and test run."""
        # Access test run through relationship
        await db_session.refresh(test_deficiency, ["test_run"])

        assert test_deficiency.test_run is not None
        assert test_deficiency.test_run.id == test_run.id


@pytest.mark.asyncio
class TestAggregateQueries:
    """Test aggregate queries and statistics."""

    async def test_count_deficiencies_by_severity(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test counting deficiencies grouped by severity."""
        # Create deficiencies with different severities
        severities = [
            DeficiencySeverity.CRITICAL,
            DeficiencySeverity.HIGH,
            DeficiencySeverity.HIGH,
            DeficiencySeverity.MEDIUM,
            DeficiencySeverity.LOW,
        ]

        for severity in severities:
            deficiency = TestDeficiency(
                id=uuid4(),
                test_run_id=test_run.id,
                severity=severity,
                deficiency_type=DeficiencyType.FUNCTIONAL,
                title=f"{severity} deficiency",
                description="Test",
                status=DeficiencyStatus.NEW,
            )
            db_session.add(deficiency)
        await db_session.commit()

        # Query counts by severity
        result = await db_session.execute(
            select(TestDeficiency.severity, func.count(TestDeficiency.id))
            .where(TestDeficiency.test_run_id == test_run.id)
            .group_by(TestDeficiency.severity)
        )
        severity_counts = dict(result.all())

        assert severity_counts[DeficiencySeverity.CRITICAL] == 1
        assert severity_counts[DeficiencySeverity.HIGH] == 2
        assert severity_counts[DeficiencySeverity.MEDIUM] == 1
        assert severity_counts[DeficiencySeverity.LOW] == 1

    async def test_calculate_average_coverage(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test calculating average coverage across test runs."""
        # Create runs with different coverage
        await create_test_runs(
            db_session, test_project, test_runner_connection, count=5
        )

        # Calculate average
        result = await db_session.execute(
            select(func.avg(SoftwareTestRun.coverage_percentage)).where(
                SoftwareTestRun.project_id == test_project.id
            )
        )
        avg_coverage = result.scalar()

        assert avg_coverage is not None
        assert avg_coverage > 0

    async def test_query_test_run_statistics(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test querying various test run statistics."""
        # Create multiple runs
        await create_test_runs(
            db_session,
            test_project,
            test_runner_connection,
            count=10,
            status=TestRunStatus.COMPLETED,
        )

        # Query statistics
        result = await db_session.execute(
            select(
                func.count(SoftwareTestRun.id).label("total_runs"),
                func.avg(SoftwareTestRun.coverage_percentage).label("avg_coverage"),
                func.sum(SoftwareTestRun.total_transitions).label("total_transitions"),
                func.sum(SoftwareTestRun.deficiencies_found).label(
                    "total_deficiencies"
                ),
            ).where(SoftwareTestRun.project_id == test_project.id)
        )

        stats = result.one()

        assert stats.total_runs >= 10
        assert stats.avg_coverage > 0
        assert stats.total_transitions > 0
