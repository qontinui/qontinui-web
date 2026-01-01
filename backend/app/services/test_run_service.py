"""
Service for test run business logic.

Handles test run creation, completion, and associated operations
like transition and deficiency reporting. Separates business logic
from HTTP handling.
"""

from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.transition_execution import (
    TransitionExecution,
    TransitionExecutionStatus,
)
from app.schemas.testing import (
    CoverageUpdate,
    DeficiencyBatchCreate,
    TestRunComplete,
    TestRunCreate,
    TransitionBatchCreate,
    TransitionCreate,
)

logger = structlog.get_logger(__name__)


class TestRunNotFoundError(Exception):
    """Raised when a test run is not found."""


class ProjectNotFoundError(Exception):
    """Raised when a project is not found."""


class ProjectAccessDeniedError(Exception):
    """Raised when user doesn't have access to project."""


# Status string to enum mappings
TRANSITION_STATUS_MAP = {
    "success": TransitionExecutionStatus.SUCCESS,
    "failed": TransitionExecutionStatus.FAILED,
    "timeout": TransitionExecutionStatus.TIMEOUT,
    "skipped": TransitionExecutionStatus.SKIPPED,
}

TEST_RUN_STATUS_MAP = {
    "completed": TestRunStatus.COMPLETED,
    "failed": TestRunStatus.FAILED,
    "timeout": TestRunStatus.TIMEOUT,
    "aborted": TestRunStatus.CANCELLED,
    "crashed": TestRunStatus.FAILED,
}

DEFICIENCY_SEVERITY_MAP = {
    "critical": DeficiencySeverity.CRITICAL,
    "high": DeficiencySeverity.HIGH,
    "medium": DeficiencySeverity.MEDIUM,
    "low": DeficiencySeverity.LOW,
    "informational": DeficiencySeverity.INFO,
}

DEFICIENCY_TYPE_MAP = {
    "functional_bug": DeficiencyType.FUNCTIONAL,
    "ui_issue": DeficiencyType.VISUAL,
    "performance": DeficiencyType.PERFORMANCE,
    "crash": DeficiencyType.CRASH,
    "security": DeficiencyType.SECURITY,
    "accessibility": DeficiencyType.ACCESSIBILITY,
    "other": DeficiencyType.DATA,
}


class TestRunService:
    """Service for test run operations."""

    async def verify_project_access(
        self, db: AsyncSession, project_id: UUID, user_id: UUID
    ) -> Project:
        """
        Verify user has access to the project.

        Args:
            db: Database session
            project_id: Project ID to check
            user_id: User ID to verify

        Returns:
            Project if access is granted

        Raises:
            ProjectNotFoundError: Project not found
            ProjectAccessDeniedError: User not authorized
        """
        result = await db.execute(select(Project).filter(Project.id == project_id))
        project = result.scalar_one_or_none()

        if not project:
            raise ProjectNotFoundError(f"Project {project_id} not found")

        if project.owner_id != user_id:
            raise ProjectAccessDeniedError(
                f"User {user_id} not authorized to access project {project_id}"
            )

        return project

    async def get_test_run_with_access(
        self, db: AsyncSession, run_id: UUID, user_id: UUID
    ) -> SoftwareTestRun:
        """
        Get test run and verify user has access.

        Args:
            db: Database session
            run_id: Test run ID
            user_id: User ID to verify

        Returns:
            SoftwareTestRun if access is granted

        Raises:
            TestRunNotFoundError: Test run not found
            ProjectAccessDeniedError: User not authorized
        """
        result = await db.execute(
            select(SoftwareTestRun).filter(SoftwareTestRun.id == run_id)
        )
        test_run = result.scalar_one_or_none()

        if not test_run:
            raise TestRunNotFoundError(f"Test run {run_id} not found")

        # Verify project access
        await self.verify_project_access(db, test_run.project_id, user_id)

        return test_run

    async def create_test_run(
        self, db: AsyncSession, run_in: TestRunCreate, user_id: UUID
    ) -> SoftwareTestRun:
        """
        Create a new test run.

        Args:
            db: Database session
            run_in: Test run creation data
            user_id: ID of the user creating the run

        Returns:
            Created SoftwareTestRun

        Raises:
            ProjectNotFoundError: Project not found
            ProjectAccessDeniedError: User not authorized
        """
        logger.info(
            "creating_test_run",
            user_id=str(user_id),
            project_id=str(run_in.project_id),
            run_name=run_in.run_name,
        )

        await self.verify_project_access(db, run_in.project_id, user_id)

        test_run = SoftwareTestRun(
            project_id=run_in.project_id,
            runner_connection_id=None,
            workflow_id=run_in.workflow_metadata.get("workflow_id"),
            status=TestRunStatus.RUNNING,
            started_at=utc_now(),
            runner_metadata=run_in.runner_metadata,
            configuration_snapshot={
                **run_in.configuration_snapshot,
                "workflow_metadata": run_in.workflow_metadata,
                "run_name": run_in.run_name,
                "description": run_in.description,
            },
            test_mode=run_in.configuration_snapshot.get("strategy"),
            max_duration_seconds=run_in.configuration_snapshot.get(
                "max_duration_seconds", 3600
            ),
            tags=run_in.workflow_metadata.get("tags", []),
        )
        db.add(test_run)
        await db.commit()
        await db.refresh(test_run)

        logger.info(
            "test_run_created",
            run_id=str(test_run.id),
            project_id=str(test_run.project_id),
            user_id=str(user_id),
        )

        return test_run

    async def report_transitions(
        self,
        db: AsyncSession,
        run_id: UUID,
        batch_in: TransitionBatchCreate,
        user_id: UUID,
    ) -> tuple[list[UUID], int, int, SoftwareTestRun]:
        """
        Report transition execution results.

        Args:
            db: Database session
            run_id: Test run ID
            batch_in: Batch of transitions to report
            user_id: User ID for access verification

        Returns:
            Tuple of (transition_ids, successful_count, failed_count, test_run)
        """
        logger.info(
            "reporting_transitions",
            user_id=str(user_id),
            run_id=str(run_id),
            transition_count=len(batch_in.transitions),
        )

        test_run = await self.get_test_run_with_access(db, run_id, user_id)

        transition_ids: list[UUID] = []
        successful_count = 0
        failed_count = 0

        for t in batch_in.transitions:
            transition_id, is_success = await self._process_transition(db, run_id, t)
            transition_ids.append(transition_id)
            if is_success:
                successful_count += 1
            else:
                failed_count += 1

        # Update test run aggregate statistics
        test_run.total_transitions += len(batch_in.transitions)
        test_run.successful_transitions += successful_count
        test_run.failed_transitions += failed_count

        await db.commit()

        logger.info(
            "transitions_recorded",
            run_id=str(run_id),
            count=len(transition_ids),
            successful=successful_count,
            failed=failed_count,
        )

        return transition_ids, successful_count, failed_count, test_run

    async def _process_transition(
        self,
        db: AsyncSession,
        run_id: UUID,
        t: TransitionCreate,
    ) -> tuple[UUID, bool]:
        """
        Process a single transition (create or update).

        Args:
            db: Database session
            run_id: Test run ID
            t: Transition data

        Returns:
            Tuple of (transition_id, is_success)
        """
        # Check for existing transition with same sequence number (for idempotency)
        result = await db.execute(
            select(TransitionExecution).filter(
                and_(
                    TransitionExecution.test_run_id == run_id,
                    TransitionExecution.sequence_number == t.sequence_number,
                )
            )
        )
        existing = result.scalar_one_or_none()

        execution_status = TRANSITION_STATUS_MAP.get(
            t.status, TransitionExecutionStatus.ERROR
        )

        if existing:
            # Update existing transition
            existing.status = execution_status
            existing.started_at = t.started_at
            existing.completed_at = t.completed_at
            existing.execution_time_ms = t.duration_ms
            existing.error_message = t.error_message
            existing.error_type = t.error_type
            existing.source_state = t.from_state
            existing.target_state = t.to_state
            existing.execution_metadata = t.metadata
            transition_id = existing.id
        else:
            # Create new transition
            transition = TransitionExecution(
                test_run_id=run_id,
                transition_id=f"{t.from_state}->{t.to_state}",
                transition_name=t.transition_name,
                sequence_number=t.sequence_number,
                status=execution_status,
                started_at=t.started_at,
                completed_at=t.completed_at,
                execution_time_ms=t.duration_ms,
                error_type=t.error_type,
                error_message=t.error_message,
                source_state=t.from_state,
                target_state=t.to_state,
                execution_metadata=t.metadata,
                action_count=t.metadata.get("actions_executed", 0),
                retry_count=t.metadata.get("retry_count", 0),
            )
            db.add(transition)
            await db.flush()
            transition_id = transition.id

        is_success = execution_status == TransitionExecutionStatus.SUCCESS
        return transition_id, is_success

    async def report_deficiencies(
        self,
        db: AsyncSession,
        run_id: UUID,
        batch_in: DeficiencyBatchCreate,
        user_id: UUID,
    ) -> list[UUID]:
        """
        Report deficiencies found during testing.

        Args:
            db: Database session
            run_id: Test run ID
            batch_in: Batch of deficiencies to report
            user_id: User ID for access verification

        Returns:
            List of created deficiency IDs
        """
        logger.info(
            "reporting_deficiencies",
            user_id=str(user_id),
            run_id=str(run_id),
            deficiency_count=len(batch_in.deficiencies),
        )

        test_run = await self.get_test_run_with_access(db, run_id, user_id)

        deficiency_ids: list[UUID] = []

        for d in batch_in.deficiencies:
            # Find related transition if sequence number provided
            transition_execution_id = None
            if d.transition_sequence_number:
                result = await db.execute(
                    select(TransitionExecution).filter(
                        and_(
                            TransitionExecution.test_run_id == run_id,
                            TransitionExecution.sequence_number
                            == d.transition_sequence_number,
                        )
                    )
                )
                transition = result.scalar_one_or_none()
                if transition:
                    transition_execution_id = transition.id

            deficiency = TestDeficiency(
                test_run_id=run_id,
                transition_execution_id=transition_execution_id,
                severity=DEFICIENCY_SEVERITY_MAP.get(
                    d.severity, DeficiencySeverity.MEDIUM
                ),
                deficiency_type=DEFICIENCY_TYPE_MAP.get(
                    d.deficiency_type, DeficiencyType.FUNCTIONAL
                ),
                title=d.title,
                description=d.description,
                screenshot_urls=[str(sid) for sid in d.screenshot_ids],
                reproduction_steps=d.reproduction_steps,
                status=DeficiencyStatus.NEW,
                environment_info=d.metadata.get("environment", {}),
                custom_fields=d.metadata,
                first_seen_at=utc_now(),
                last_seen_at=utc_now(),
            )
            db.add(deficiency)
            await db.flush()
            deficiency_ids.append(deficiency.id)

        # Update test run deficiency count
        test_run.deficiencies_found += len(batch_in.deficiencies)

        await db.commit()

        logger.info(
            "deficiencies_recorded",
            run_id=str(run_id),
            count=len(deficiency_ids),
        )

        return deficiency_ids

    async def update_coverage(
        self,
        db: AsyncSession,
        run_id: UUID,
        coverage_in: CoverageUpdate,
        user_id: UUID,
    ) -> SoftwareTestRun:
        """
        Update coverage metrics for a test run.

        Args:
            db: Database session
            run_id: Test run ID
            coverage_in: Coverage update data
            user_id: User ID for access verification

        Returns:
            Updated SoftwareTestRun
        """
        logger.info(
            "updating_coverage",
            user_id=str(user_id),
            run_id=str(run_id),
            coverage_percentage=coverage_in.coverage_percentage,
        )

        test_run = await self.get_test_run_with_access(db, run_id, user_id)

        # Update coverage metrics
        test_run.coverage_percentage = Decimal(str(coverage_in.coverage_percentage))
        test_run.total_transitions = coverage_in.total_transitions_executed
        test_run.unique_paths_found = coverage_in.unique_transitions_covered
        test_run.unique_states_visited = len(coverage_in.state_coverage_map)

        # Store detailed coverage data in configuration_snapshot
        test_run.configuration_snapshot = {
            **test_run.configuration_snapshot,
            "coverage_data": {
                "transition_coverage_map": coverage_in.transition_coverage_map,
                "state_coverage_map": coverage_in.state_coverage_map,
                "uncovered_transitions": coverage_in.uncovered_transitions,
            },
        }

        await db.commit()

        logger.info(
            "coverage_updated",
            run_id=str(run_id),
            coverage_percentage=coverage_in.coverage_percentage,
        )

        return test_run

    async def complete_test_run(
        self,
        db: AsyncSession,
        run_id: UUID,
        complete_in: TestRunComplete,
        user_id: UUID,
    ) -> tuple[SoftwareTestRun, int]:
        """
        Mark test run as completed and record final metrics.

        Args:
            db: Database session
            run_id: Test run ID
            complete_in: Completion data
            user_id: User ID for access verification

        Returns:
            Tuple of (updated SoftwareTestRun, duration_seconds)
        """
        logger.info(
            "completing_test_run",
            user_id=str(user_id),
            run_id=str(run_id),
            final_status=complete_in.status,
        )

        test_run = await self.get_test_run_with_access(db, run_id, user_id)

        # Update test run with final status
        test_run.status = TEST_RUN_STATUS_MAP.get(
            complete_in.status, TestRunStatus.COMPLETED
        )
        test_run.completed_at = complete_in.ended_at

        # Update metrics from final_metrics
        metrics = complete_in.final_metrics
        test_run.total_transitions = metrics.get(
            "total_transitions_executed", test_run.total_transitions
        )
        test_run.successful_transitions = metrics.get(
            "successful_transitions", test_run.successful_transitions
        )
        test_run.failed_transitions = metrics.get(
            "failed_transitions", test_run.failed_transitions
        )
        test_run.coverage_percentage = Decimal(
            str(metrics.get("coverage_percentage", float(test_run.coverage_percentage)))
        )
        test_run.deficiencies_found = metrics.get(
            "total_deficiencies_found", test_run.deficiencies_found
        )
        test_run.error_summary = complete_in.summary

        # Store final metrics in configuration_snapshot
        test_run.configuration_snapshot = {
            **test_run.configuration_snapshot,
            "final_metrics": complete_in.final_metrics,
        }

        await db.commit()

        # Calculate duration
        duration_seconds = 0
        if test_run.started_at and test_run.completed_at:
            duration_seconds = int(
                (test_run.completed_at - test_run.started_at).total_seconds()
            )

        logger.info(
            "test_run_completed",
            run_id=str(run_id),
            status=test_run.status,
            duration_seconds=duration_seconds,
        )

        return test_run, duration_seconds

    def build_test_run_response_data(self, run: SoftwareTestRun) -> dict[str, Any]:
        """
        Build response data for a test run.

        Args:
            run: The SoftwareTestRun model

        Returns:
            Dictionary with response data
        """
        duration_seconds = None
        if run.started_at and run.completed_at:
            duration_seconds = int((run.completed_at - run.started_at).total_seconds())

        return {
            "run_id": run.id,
            "project_id": run.project_id,
            "run_name": run.configuration_snapshot.get("run_name", f"Run {run.id}"),
            "status": run.status,
            "started_at": run.started_at,
            "ended_at": run.completed_at,
            "duration_seconds": duration_seconds,
            "runner_metadata": run.runner_metadata,
            "created_at": run.created_at,
        }


# Singleton instance
test_run_service = TestRunService()
