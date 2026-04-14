"""Test orchestration logic for testing WebSocket.

Handles the business logic for test execution, including:
- Session management (start/end)
- Transition execution tracking
- Deficiency recording

Note: Screenshot handling is delegated to screenshot_handler module.
"""

from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import (DeficiencySeverity, DeficiencyStatus,
                                        DeficiencyType, TestDeficiency)
from app.models.transition_execution import (TransitionExecution,
                                             TransitionExecutionStatus)
from app.models.user import User
from app.schemas.testing_ws import (DeficiencyData, SessionEndData,
                                    SessionStartData, TransitionCompletedData,
                                    TransitionStartedData)
from app.websockets.message_types import (create_error_response,
                                          create_timestamp)
from app.websockets.testing.screenshot_handler import \
    handle_screenshot as _handle_screenshot
from pydantic import ValidationError
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

logger = structlog.get_logger(__name__)


class TestOrchestrator:
    """Orchestrates test execution for a WebSocket session.

    Manages the lifecycle of test runs including session management,
    transition tracking, screenshot uploads, and deficiency recording.
    """

    def __init__(
        self,
        db: AsyncSession,
        user: User,
        connection_record_id: int | None = None,
    ) -> None:
        """Initialize the test orchestrator.

        Args:
            db: Database session.
            user: Authenticated user.
            connection_record_id: Optional runner connection record ID.
        """
        self.db = db
        self.user = user
        self.connection_record_id = connection_record_id
        self.test_run_id: UUID | None = None
        self.logger = structlog.get_logger(__name__)

    @property
    def user_id(self) -> UUID:
        """Get the user ID."""
        return UUID(str(self.user.id))

    async def handle_session_start(self, message: dict[str, Any]) -> dict[str, Any]:
        """Handle session_start message.

        Creates SoftwareTestRun record and returns the test run ID.

        Args:
            message: Message data containing session start details.

        Returns:
            Response message with test_run_id.
        """
        try:
            # Validate and parse message data
            try:
                session_data = SessionStartData(**message)
            except ValidationError as e:
                return create_error_response(f"Invalid session_start data: {str(e)}")

            # Verify project exists and user has access
            user_org_subquery: Select = select(User.personal_org_id).where(
                User.id == self.user.id  # type: ignore[arg-type]
            )
            project_query = select(Project).where(
                Project.id == session_data.project_id,
                Project.organization_id.in_(user_org_subquery),
            )
            project_result = await self.db.execute(project_query)
            project = project_result.scalar_one_or_none()

            if not project:
                return create_error_response(
                    f"Project {session_data.project_id} not found or access denied"
                )

            # Create test run record
            test_run = SoftwareTestRun(
                project_id=session_data.project_id,
                runner_connection_id=self.connection_record_id,
                workflow_id=session_data.workflow_id,
                status=TestRunStatus.RUNNING,
                started_at=utc_now(),
                configuration_snapshot=session_data.configuration_snapshot,
                test_mode=session_data.test_mode,
                max_duration_seconds=session_data.max_duration_seconds,
                seed_value=session_data.seed_value,
                runner_metadata=session_data.runner_metadata,
            )

            self.db.add(test_run)
            await self.db.commit()
            await self.db.refresh(test_run)

            self.test_run_id = test_run.id

            self.logger.info(
                "test_run_started",
                test_run_id=str(test_run.id),
                project_id=str(session_data.project_id),
                workflow_id=session_data.workflow_id,
                user_id=str(self.user.id),
            )

            return {
                "type": "session_started",
                "test_run_id": str(test_run.id),
                "timestamp": create_timestamp(),
            }

        except Exception as e:
            self.logger.error(
                "session_start_error", error=str(e), error_type=type(e).__name__
            )
            return create_error_response(f"Failed to start test session: {str(e)}")

    async def handle_transition_started(
        self, message: dict[str, Any]
    ) -> dict[str, Any]:
        """Handle transition_started message.

        Creates TransitionExecution record with status "running".

        Args:
            message: Message data containing transition start details.

        Returns:
            Response message with transition_execution_id.
        """
        try:
            if not self.test_run_id:
                return create_error_response(
                    "No active test session. Start session first."
                )

            # Validate and parse message data
            try:
                transition_data = TransitionStartedData(**message)
            except ValidationError as e:
                return create_error_response(
                    f"Invalid transition_started data: {str(e)}"
                )

            # Create transition execution record
            transition_execution = TransitionExecution(
                test_run_id=self.test_run_id,
                transition_id=transition_data.transition_id,
                transition_name=transition_data.transition_name,
                sequence_number=transition_data.sequence_number,
                status=TransitionExecutionStatus.SUCCESS,
                started_at=transition_data.timestamp,
                source_state=transition_data.source_state,
                target_state=transition_data.target_state,
            )

            self.db.add(transition_execution)
            await self.db.commit()
            await self.db.refresh(transition_execution)

            self.logger.info(
                "transition_started",
                transition_execution_id=str(transition_execution.id),
                test_run_id=str(self.test_run_id),
                transition_id=transition_data.transition_id,
                sequence_number=transition_data.sequence_number,
            )

            return {
                "type": "transition_started_ack",
                "transition_execution_id": str(transition_execution.id),
                "timestamp": create_timestamp(),
            }

        except Exception as e:
            self.logger.error(
                "transition_started_error", error=str(e), error_type=type(e).__name__
            )
            return create_error_response(f"Failed to record transition start: {str(e)}")

    async def handle_transition_completed(
        self, message: dict[str, Any]
    ) -> dict[str, Any]:
        """Handle transition_completed message.

        Updates TransitionExecution record with result and timing.

        Args:
            message: Message data containing transition completion details.

        Returns:
            Response message with transition_execution_id.
        """
        try:
            if not self.test_run_id:
                return create_error_response(
                    "No active test session. Start session first."
                )

            # Validate and parse message data
            try:
                transition_data = TransitionCompletedData(**message)
            except ValidationError as e:
                return create_error_response(
                    f"Invalid transition_completed data: {str(e)}"
                )

            # Find the transition execution record
            query = select(TransitionExecution).where(
                TransitionExecution.test_run_id == self.test_run_id,
                TransitionExecution.transition_id == transition_data.transition_id,
                TransitionExecution.sequence_number == transition_data.sequence_number,
            )
            result = await self.db.execute(query)
            transition_execution = result.scalar_one_or_none()

            if not transition_execution:
                return create_error_response(
                    f"Transition execution not found for sequence {transition_data.sequence_number}"
                )

            # Update transition execution record
            transition_execution.status = TransitionExecutionStatus(
                transition_data.status
            )
            transition_execution.completed_at = transition_data.timestamp
            transition_execution.execution_time_ms = transition_data.execution_time_ms
            transition_execution.actual_state = transition_data.actual_state
            transition_execution.state_match = transition_data.state_match
            transition_execution.error_type = transition_data.error_type
            transition_execution.error_message = transition_data.error_message
            transition_execution.error_stacktrace = transition_data.error_stacktrace
            transition_execution.input_data = transition_data.input_data
            transition_execution.output_data = transition_data.output_data
            transition_execution.action_count = transition_data.action_count
            transition_execution.retry_count = transition_data.retry_count
            transition_execution.execution_metadata = transition_data.metadata

            await self.db.commit()
            await self.db.refresh(transition_execution)

            # Update test run aggregate statistics
            await self._update_test_run_statistics(transition_data.status)

            self.logger.info(
                "transition_completed",
                transition_execution_id=str(transition_execution.id),
                test_run_id=str(self.test_run_id),
                status=transition_data.status,
                execution_time_ms=transition_data.execution_time_ms,
            )

            return {
                "type": "transition_completed_ack",
                "transition_execution_id": str(transition_execution.id),
                "timestamp": create_timestamp(),
            }

        except Exception as e:
            self.logger.error(
                "transition_completed_error", error=str(e), error_type=type(e).__name__
            )
            return create_error_response(
                f"Failed to record transition completion: {str(e)}"
            )

    async def _update_test_run_statistics(self, status: str) -> None:
        """Update test run aggregate statistics.

        Args:
            status: Transition execution status.
        """
        if not self.test_run_id:
            return

        test_run_query = select(SoftwareTestRun).where(
            SoftwareTestRun.id == self.test_run_id
        )
        test_run_result = await self.db.execute(test_run_query)
        test_run = test_run_result.scalar_one_or_none()

        if test_run:
            test_run.total_transitions += 1
            if status == "success":
                test_run.successful_transitions += 1
            elif status == "failed" or status == "error":
                test_run.failed_transitions += 1
            elif status == "skipped":
                test_run.skipped_transitions += 1

            await self.db.commit()

    async def handle_screenshot(self, message: dict[str, Any]) -> dict[str, Any]:
        """Handle screenshot message with S3 upload and database storage.

        Delegates to the screenshot_handler module.

        Args:
            message: Message data containing screenshot image and metadata.

        Returns:
            Response message with screenshot_id.
        """
        return await _handle_screenshot(
            message=message,
            db=self.db,
            user_id=self.user_id,
            test_run_id=self.test_run_id,
        )

    async def handle_deficiency(self, message: dict[str, Any]) -> dict[str, Any]:
        """Handle deficiency message.

        Creates TestDeficiency record for bugs/issues found during testing.

        Args:
            message: Message data containing deficiency details.

        Returns:
            Response message with deficiency_id.
        """
        try:
            if not self.test_run_id:
                return create_error_response(
                    "No active test session. Start session first."
                )

            # Validate and parse message data
            try:
                deficiency_data = DeficiencyData(**message)
            except ValidationError as e:
                return create_error_response(f"Invalid deficiency data: {str(e)}")

            # Find transition execution if provided
            transition_execution_id = None
            if deficiency_data.transition_id and deficiency_data.sequence_number:
                query = select(TransitionExecution).where(
                    TransitionExecution.test_run_id == self.test_run_id,
                    TransitionExecution.transition_id == deficiency_data.transition_id,
                    TransitionExecution.sequence_number
                    == deficiency_data.sequence_number,
                )
                result = await self.db.execute(query)
                transition_execution = result.scalar_one_or_none()
                if transition_execution:
                    transition_execution_id = transition_execution.id

            # Create deficiency record
            deficiency = TestDeficiency(
                test_run_id=self.test_run_id,
                transition_execution_id=transition_execution_id,
                severity=DeficiencySeverity(deficiency_data.severity),
                deficiency_type=DeficiencyType(deficiency_data.deficiency_type),
                title=deficiency_data.title,
                description=deficiency_data.description,
                reproduction_steps=deficiency_data.reproduction_steps,
                screenshot_urls=[
                    f"testing/{str(screenshot_id)}"
                    for screenshot_id in deficiency_data.screenshot_ids
                ],
                environment_info=deficiency_data.environment_info,
                preconditions=deficiency_data.preconditions,
                tags=deficiency_data.tags,
                custom_fields=deficiency_data.custom_fields,
                status=DeficiencyStatus.NEW,
            )

            self.db.add(deficiency)
            await self.db.commit()
            await self.db.refresh(deficiency)

            # Update test run deficiencies count
            await self._increment_deficiencies_count()

            self.logger.info(
                "deficiency_recorded",
                deficiency_id=str(deficiency.id),
                test_run_id=str(self.test_run_id),
                severity=deficiency_data.severity,
                deficiency_type=deficiency_data.deficiency_type,
            )

            return {
                "type": "deficiency_recorded",
                "deficiency_id": str(deficiency.id),
                "timestamp": create_timestamp(),
            }

        except Exception as e:
            self.logger.error(
                "deficiency_handler_error",
                error=str(e),
                error_type=type(e).__name__,
            )
            return create_error_response(f"Failed to record deficiency: {str(e)}")

    async def _increment_deficiencies_count(self) -> None:
        """Increment the deficiencies count in the test run."""
        if not self.test_run_id:
            return

        test_run_query = select(SoftwareTestRun).where(
            SoftwareTestRun.id == self.test_run_id
        )
        test_run_result = await self.db.execute(test_run_query)
        test_run = test_run_result.scalar_one_or_none()

        if test_run:
            test_run.deficiencies_found += 1
            await self.db.commit()

    async def handle_session_end(self, message: dict[str, Any]) -> dict[str, Any]:
        """Handle session_end message.

        Updates SoftwareTestRun status and final metrics.

        Args:
            message: Message data containing session end details.

        Returns:
            Response message with test_run_id and final status.
        """
        try:
            if not self.test_run_id:
                return create_error_response("No active test session to end.")

            # Validate and parse message data
            try:
                session_data = SessionEndData(**message)
            except ValidationError as e:
                return create_error_response(f"Invalid session_end data: {str(e)}")

            # Update test run record
            query = select(SoftwareTestRun).where(
                SoftwareTestRun.id == self.test_run_id
            )
            result = await self.db.execute(query)
            test_run = result.scalar_one_or_none()

            if not test_run:
                return create_error_response(f"Test run {self.test_run_id} not found")

            test_run.status = TestRunStatus(session_data.status)
            test_run.completed_at = utc_now()
            test_run.error_summary = session_data.error_summary
            test_run.total_transitions = session_data.total_transitions
            test_run.successful_transitions = session_data.successful_transitions
            test_run.failed_transitions = session_data.failed_transitions
            test_run.skipped_transitions = session_data.skipped_transitions
            test_run.coverage_percentage = Decimal(
                str(session_data.coverage_percentage)
            )
            test_run.unique_paths_found = session_data.unique_paths_found
            test_run.unique_states_visited = session_data.unique_states_visited
            test_run.deficiencies_found = session_data.deficiencies_found

            await self.db.commit()
            await self.db.refresh(test_run)

            test_run_id_str = str(self.test_run_id)

            self.logger.info(
                "test_run_ended",
                test_run_id=test_run_id_str,
                status=session_data.status,
                total_transitions=session_data.total_transitions,
                deficiencies_found=session_data.deficiencies_found,
            )

            # Clear test_run_id after session end
            self.test_run_id = None

            return {
                "type": "session_ended",
                "test_run_id": test_run_id_str,
                "status": session_data.status,
                "timestamp": create_timestamp(),
            }

        except Exception as e:
            self.logger.error(
                "session_end_error", error=str(e), error_type=type(e).__name__
            )
            return create_error_response(f"Failed to end test session: {str(e)}")
