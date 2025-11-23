"""
Integration tests for complete testing workflows.

Tests end-to-end workflows including:
- Create test run → Report transitions → Report deficiencies → Complete run
- Query and filter operations
- Coverage calculation
- Reliability statistics
"""

from datetime import datetime, timedelta
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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .conftest import (
    create_test_runs,
    generate_mock_deficiency_data,
    generate_mock_transition_data,
)


@pytest.mark.asyncio
class TestCompleteTestRunWorkflow:
    """Test complete test run workflow from start to finish."""

    async def test_full_test_run_lifecycle(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """
        Test complete workflow:
        1. Create test run
        2. Report transitions
        3. Report deficiencies
        4. Update coverage
        5. Complete test run
        """
        # Step 1: Create test run
        test_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="workflow-full-lifecycle",
            status=TestRunStatus.RUNNING,
            started_at=datetime.utcnow(),
            configuration_snapshot={
                "strategy": "random_walk",
                "max_duration_seconds": 3600,
            },
            test_mode="exploration",
            runner_metadata={"version": "0.1.0", "os": "Linux"},
        )
        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        assert test_run.status == TestRunStatus.RUNNING
        assert test_run.total_transitions == 0

        # Step 2: Report transitions (simulating multiple batches)
        total_transitions = 50
        successful = 45
        failed = 5

        test_run.total_transitions = total_transitions
        test_run.successful_transitions = successful
        test_run.failed_transitions = failed
        db_session.add(test_run)
        await db_session.commit()

        # Step 3: Report deficiencies
        deficiencies = []
        for i in range(3):
            deficiency = TestDeficiency(
                id=uuid4(),
                test_run_id=test_run.id,
                severity=(
                    DeficiencySeverity.HIGH if i == 0 else DeficiencySeverity.MEDIUM
                ),
                deficiency_type=DeficiencyType.FUNCTIONAL,
                title=f"Deficiency {i + 1}",
                description=f"Test deficiency number {i + 1}",
                status=DeficiencyStatus.NEW,
            )
            db_session.add(deficiency)
            deficiencies.append(deficiency)

        await db_session.commit()

        test_run.deficiencies_found = len(deficiencies)
        db_session.add(test_run)
        await db_session.commit()

        # Step 4: Update coverage metrics
        test_run.coverage_percentage = Decimal("82.50")
        test_run.unique_paths_found = 25
        test_run.unique_states_visited = 15
        db_session.add(test_run)
        await db_session.commit()

        # Step 5: Complete test run
        test_run.status = TestRunStatus.COMPLETED
        test_run.completed_at = datetime.utcnow()
        test_run.error_summary = None
        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        # Verify final state
        assert test_run.status == TestRunStatus.COMPLETED
        assert test_run.completed_at is not None
        assert test_run.total_transitions == 50
        assert test_run.successful_transitions == 45
        assert test_run.failed_transitions == 5
        assert test_run.coverage_percentage == Decimal("82.50")
        assert test_run.deficiencies_found == 3

        # Verify deficiencies are associated
        await db_session.refresh(test_run, ["deficiencies"])
        assert len(test_run.deficiencies) == 3

    async def test_test_run_with_failure(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test workflow when test run fails."""
        # Create and start test run
        test_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="workflow-with-failure",
            status=TestRunStatus.RUNNING,
            started_at=datetime.utcnow(),
            configuration_snapshot={},
        )
        db_session.add(test_run)
        await db_session.commit()

        # Simulate failure
        test_run.status = TestRunStatus.FAILED
        test_run.completed_at = datetime.utcnow()
        test_run.error_summary = "Test runner crashed due to memory error"
        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        assert test_run.status == TestRunStatus.FAILED
        assert test_run.error_summary is not None
        assert "memory error" in test_run.error_summary.lower()

    async def test_test_run_with_timeout(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test workflow when test run times out."""
        # Create test run with short timeout
        test_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="workflow-with-timeout",
            status=TestRunStatus.RUNNING,
            started_at=datetime.utcnow(),
            max_duration_seconds=60,
            configuration_snapshot={},
        )
        db_session.add(test_run)
        await db_session.commit()

        # Simulate timeout
        test_run.status = TestRunStatus.TIMEOUT
        test_run.completed_at = datetime.utcnow()
        test_run.error_summary = "Test run exceeded maximum duration of 60 seconds"
        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        assert test_run.status == TestRunStatus.TIMEOUT
        assert test_run.max_duration_seconds == 60


@pytest.mark.asyncio
class TestDeficiencyWorkflow:
    """Test deficiency management workflow."""

    async def test_deficiency_lifecycle(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """
        Test complete deficiency lifecycle:
        1. Create (NEW)
        2. Triage (TRIAGED)
        3. Assign (ASSIGNED)
        4. Work on (IN_PROGRESS)
        5. Resolve (RESOLVED)
        6. Close (CLOSED)
        """
        # Create deficiency
        deficiency = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.HIGH,
            deficiency_type=DeficiencyType.FUNCTIONAL,
            title="Button not working",
            description="Login button does not respond",
            status=DeficiencyStatus.NEW,
        )
        db_session.add(deficiency)
        await db_session.commit()
        await db_session.refresh(deficiency)

        assert deficiency.status == DeficiencyStatus.NEW

        # Triage
        deficiency.status = DeficiencyStatus.TRIAGED
        deficiency.category = "authentication"
        db_session.add(deficiency)
        await db_session.commit()

        # Assign
        deficiency.status = DeficiencyStatus.ASSIGNED
        deficiency.assigned_at = datetime.utcnow()
        db_session.add(deficiency)
        await db_session.commit()

        # Work on it
        deficiency.status = DeficiencyStatus.IN_PROGRESS
        db_session.add(deficiency)
        await db_session.commit()

        # Resolve
        deficiency.status = DeficiencyStatus.RESOLVED
        deficiency.resolution = "fixed"
        deficiency.resolved_at = datetime.utcnow()
        db_session.add(deficiency)
        await db_session.commit()

        # Close
        deficiency.status = DeficiencyStatus.CLOSED
        db_session.add(deficiency)
        await db_session.commit()
        await db_session.refresh(deficiency)

        assert deficiency.status == DeficiencyStatus.CLOSED
        assert deficiency.resolved_at is not None

    async def test_deficiency_wont_fix(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test marking a deficiency as won't fix."""
        deficiency = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.LOW,
            deficiency_type=DeficiencyType.VISUAL,
            title="Minor visual alignment",
            description="Button 1px off center",
            status=DeficiencyStatus.NEW,
        )
        db_session.add(deficiency)
        await db_session.commit()

        # Mark as won't fix
        deficiency.status = DeficiencyStatus.WONT_FIX
        deficiency.resolution = "wont_fix"
        db_session.add(deficiency)
        await db_session.commit()
        await db_session.refresh(deficiency)

        assert deficiency.status == DeficiencyStatus.WONT_FIX
        assert deficiency.resolution == "wont_fix"


@pytest.mark.asyncio
class TestQueryAndFilterWorkflows:
    """Test complex query and filter operations."""

    async def test_filter_runs_by_multiple_criteria(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test filtering test runs by multiple criteria."""
        # Create runs with various properties
        high_coverage_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="workflow-high-coverage",
            status=TestRunStatus.COMPLETED,
            started_at=datetime.utcnow() - timedelta(days=1),
            completed_at=datetime.utcnow() - timedelta(days=1, hours=-1),
            coverage_percentage=Decimal("95.00"),
            configuration_snapshot={},
        )

        low_coverage_run = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id="workflow-low-coverage",
            status=TestRunStatus.COMPLETED,
            started_at=datetime.utcnow() - timedelta(days=2),
            completed_at=datetime.utcnow() - timedelta(days=2, hours=-1),
            coverage_percentage=Decimal("45.00"),
            configuration_snapshot={},
        )

        db_session.add_all([high_coverage_run, low_coverage_run])
        await db_session.commit()

        # Query runs with coverage > 80%
        result = await db_session.execute(
            select(SoftwareTestRun).where(
                SoftwareTestRun.project_id == test_project.id,
                SoftwareTestRun.coverage_percentage >= Decimal("80.00"),
                SoftwareTestRun.status == TestRunStatus.COMPLETED,
            )
        )
        high_coverage_runs = result.scalars().all()

        assert high_coverage_run in high_coverage_runs
        assert low_coverage_run not in high_coverage_runs

    async def test_filter_deficiencies_by_multiple_criteria(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test filtering deficiencies by multiple criteria."""
        # Create deficiencies with various properties
        critical_new = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.CRITICAL,
            deficiency_type=DeficiencyType.CRASH,
            title="Application crash",
            description="Crash on startup",
            status=DeficiencyStatus.NEW,
            tags=["critical", "blocker"],
        )

        low_resolved = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.LOW,
            deficiency_type=DeficiencyType.VISUAL,
            title="Visual issue",
            description="Minor visual bug",
            status=DeficiencyStatus.RESOLVED,
            tags=["visual"],
        )

        db_session.add_all([critical_new, low_resolved])
        await db_session.commit()

        # Query critical deficiencies that are still new
        result = await db_session.execute(
            select(TestDeficiency).where(
                TestDeficiency.test_run_id == test_run.id,
                TestDeficiency.severity.in_(
                    [DeficiencySeverity.CRITICAL, DeficiencySeverity.HIGH]
                ),
                TestDeficiency.status == DeficiencyStatus.NEW,
            )
        )
        critical_new_deficiencies = result.scalars().all()

        assert critical_new in critical_new_deficiencies
        assert low_resolved not in critical_new_deficiencies

    async def test_search_deficiencies_by_tags(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test searching deficiencies by tags."""
        # Create deficiencies with different tags
        ui_deficiency = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.MEDIUM,
            deficiency_type=DeficiencyType.FUNCTIONAL,
            title="UI issue",
            description="UI not responding",
            status=DeficiencyStatus.NEW,
            tags=["ui", "frontend"],
        )

        backend_deficiency = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=DeficiencySeverity.HIGH,
            deficiency_type=DeficiencyType.FUNCTIONAL,
            title="API error",
            description="API returning 500",
            status=DeficiencyStatus.NEW,
            tags=["backend", "api"],
        )

        db_session.add_all([ui_deficiency, backend_deficiency])
        await db_session.commit()

        # Query UI-tagged deficiencies
        # Note: JSON contains search requires PostgreSQL
        # For SQLite in tests, we'd need to load and filter in Python
        result = await db_session.execute(
            select(TestDeficiency).where(TestDeficiency.test_run_id == test_run.id)
        )
        all_deficiencies = result.scalars().all()

        ui_deficiencies = [d for d in all_deficiencies if "ui" in d.tags]

        assert ui_deficiency in ui_deficiencies
        assert backend_deficiency not in ui_deficiencies


@pytest.mark.asyncio
class TestCoverageCalculationWorkflow:
    """Test coverage calculation workflows."""

    async def test_calculate_coverage_percentage(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test calculating coverage percentage."""
        total_possible_transitions = 50
        covered_transitions = 40

        coverage = (covered_transitions / total_possible_transitions) * 100

        test_run.total_transitions = covered_transitions
        test_run.coverage_percentage = Decimal(str(coverage))
        test_run.unique_paths_found = 25
        db_session.add(test_run)
        await db_session.commit()
        await db_session.refresh(test_run)

        assert test_run.coverage_percentage == Decimal("80.00")

    async def test_track_coverage_over_time(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test tracking coverage improvements over multiple runs."""
        # Create runs with increasing coverage
        runs = []
        base_date = datetime.utcnow() - timedelta(days=10)

        for i in range(10):
            run = SoftwareTestRun(
                id=uuid4(),
                project_id=test_project.id,
                runner_connection_id=test_runner_connection.id,
                workflow_id="workflow-coverage-trend",
                status=TestRunStatus.COMPLETED,
                started_at=base_date + timedelta(days=i),
                completed_at=base_date + timedelta(days=i, hours=1),
                coverage_percentage=Decimal(f"{50 + i * 5}.00"),  # 50%, 55%, 60%, ...
                configuration_snapshot={},
            )
            db_session.add(run)
            runs.append(run)

        await db_session.commit()

        # Verify coverage trend
        result = await db_session.execute(
            select(SoftwareTestRun)
            .where(
                SoftwareTestRun.project_id == test_project.id,
                SoftwareTestRun.workflow_id == "workflow-coverage-trend",
            )
            .order_by(SoftwareTestRun.started_at)
        )
        ordered_runs = result.scalars().all()

        # Verify increasing coverage
        for i in range(len(ordered_runs) - 1):
            assert (
                ordered_runs[i + 1].coverage_percentage
                >= ordered_runs[i].coverage_percentage
            )


@pytest.mark.asyncio
class TestReliabilityStatisticsWorkflow:
    """Test reliability statistics calculation workflows."""

    async def test_calculate_success_rate(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test calculating transition success rate across runs."""
        # Create multiple runs with transition data
        runs = await create_test_runs(
            db_session,
            test_project,
            test_runner_connection,
            count=10,
            status=TestRunStatus.COMPLETED,
        )

        # Calculate overall success rate
        result = await db_session.execute(
            select(SoftwareTestRun).where(
                SoftwareTestRun.project_id == test_project.id,
                SoftwareTestRun.status == TestRunStatus.COMPLETED,
            )
        )
        completed_runs = result.scalars().all()

        total_transitions = sum(run.total_transitions for run in completed_runs)
        total_successful = sum(run.successful_transitions for run in completed_runs)

        success_rate = (
            (total_successful / total_transitions * 100) if total_transitions > 0 else 0
        )

        assert success_rate > 80  # Based on our test data factory

    async def test_identify_flaky_transitions(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test identifying transitions with inconsistent results."""
        # Create runs with varying success rates
        flaky_workflow = "workflow-flaky"

        # Run 1: 90% success
        run1 = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id=flaky_workflow,
            status=TestRunStatus.COMPLETED,
            started_at=datetime.utcnow() - timedelta(hours=3),
            completed_at=datetime.utcnow() - timedelta(hours=2),
            total_transitions=100,
            successful_transitions=90,
            failed_transitions=10,
            configuration_snapshot={},
        )

        # Run 2: 50% success (flaky!)
        run2 = SoftwareTestRun(
            id=uuid4(),
            project_id=test_project.id,
            runner_connection_id=test_runner_connection.id,
            workflow_id=flaky_workflow,
            status=TestRunStatus.COMPLETED,
            started_at=datetime.utcnow() - timedelta(hours=1),
            completed_at=datetime.utcnow(),
            total_transitions=100,
            successful_transitions=50,
            failed_transitions=50,
            configuration_snapshot={},
        )

        db_session.add_all([run1, run2])
        await db_session.commit()

        # Calculate variance in success rate
        result = await db_session.execute(
            select(SoftwareTestRun).where(SoftwareTestRun.workflow_id == flaky_workflow)
        )
        workflow_runs = result.scalars().all()

        success_rates = [
            (
                (run.successful_transitions / run.total_transitions * 100)
                if run.total_transitions > 0
                else 0
            )
            for run in workflow_runs
        ]

        # High variance indicates flakiness
        variance = max(success_rates) - min(success_rates)
        assert variance > 30  # 40% variance indicates flakiness


@pytest.mark.asyncio
class TestBatchOperationsWorkflow:
    """Test batch operations on test data."""

    async def test_bulk_update_deficiency_status(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test updating status of multiple deficiencies at once."""
        # Create multiple deficiencies
        deficiencies = []
        for i in range(10):
            deficiency = TestDeficiency(
                id=uuid4(),
                test_run_id=test_run.id,
                severity=DeficiencySeverity.MEDIUM,
                deficiency_type=DeficiencyType.FUNCTIONAL,
                title=f"Deficiency {i}",
                description=f"Test deficiency {i}",
                status=DeficiencyStatus.NEW,
            )
            db_session.add(deficiency)
            deficiencies.append(deficiency)

        await db_session.commit()

        # Bulk update to triaged
        for deficiency in deficiencies:
            deficiency.status = DeficiencyStatus.TRIAGED
            db_session.add(deficiency)

        await db_session.commit()

        # Verify all updated
        result = await db_session.execute(
            select(TestDeficiency).where(
                TestDeficiency.test_run_id == test_run.id,
                TestDeficiency.status == DeficiencyStatus.TRIAGED,
            )
        )
        triaged_deficiencies = result.scalars().all()

        assert len(triaged_deficiencies) == 10

    async def test_bulk_delete_old_test_runs(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test deleting old test runs in bulk."""
        # Create old runs
        old_date = datetime.utcnow() - timedelta(days=90)
        old_runs = []

        for i in range(5):
            run = SoftwareTestRun(
                id=uuid4(),
                project_id=test_project.id,
                runner_connection_id=test_runner_connection.id,
                workflow_id=f"old-workflow-{i}",
                status=TestRunStatus.COMPLETED,
                started_at=old_date - timedelta(days=i),
                completed_at=old_date - timedelta(days=i, hours=-1),
                configuration_snapshot={},
            )
            db_session.add(run)
            old_runs.append(run)

        await db_session.commit()

        # Delete runs older than 60 days
        cutoff_date = datetime.utcnow() - timedelta(days=60)
        result = await db_session.execute(
            select(SoftwareTestRun).where(SoftwareTestRun.started_at < cutoff_date)
        )
        runs_to_delete = result.scalars().all()

        for run in runs_to_delete:
            await db_session.delete(run)

        await db_session.commit()

        # Verify deletion
        result = await db_session.execute(
            select(SoftwareTestRun).where(SoftwareTestRun.started_at < cutoff_date)
        )
        remaining_old_runs = result.scalars().all()

        assert len(remaining_old_runs) == 0
