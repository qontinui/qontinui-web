"""
Deficiency creation service for automatic test failure tracking.

This service automatically creates TestDeficiency records when transitions fail,
extracting relevant context and determining severity/type based on error patterns.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.transition_execution import TransitionExecution

logger = structlog.get_logger(__name__)


class DeficiencyService:
    """Service for creating and managing test deficiencies."""

    @staticmethod
    def _determine_severity(
        error_type: str | None, error_message: str | None
    ) -> DeficiencySeverity:
        """
        Auto-determine deficiency severity based on error type and message.

        Args:
            error_type: Error type from transition execution
            error_message: Error message from transition execution

        Returns:
            DeficiencySeverity enum value
        """
        if not error_type and not error_message:
            return DeficiencySeverity.MEDIUM

        error_lower = (error_message or "").lower()
        type_lower = (error_type or "").lower()

        # Critical: Crash, exception, system failure
        if any(
            keyword in type_lower or keyword in error_lower
            for keyword in ["crash", "exception", "fatal", "segfault", "system"]
        ):
            return DeficiencySeverity.CRITICAL

        # High: Element not found, assertion failure, unexpected state
        if any(
            keyword in type_lower or keyword in error_lower
            for keyword in [
                "not found",
                "assertion",
                "assert",
                "unexpected",
                "failed to",
                "cannot",
            ]
        ):
            return DeficiencySeverity.HIGH

        # Medium: Timeout
        if "timeout" in type_lower or "timeout" in error_lower:
            return DeficiencySeverity.MEDIUM

        # Default to medium for unknown error types
        return DeficiencySeverity.MEDIUM

    @staticmethod
    def _determine_type(
        error_type: str | None, error_message: str | None
    ) -> DeficiencyType:
        """
        Auto-determine deficiency type based on error type and message.

        Args:
            error_type: Error type from transition execution
            error_message: Error message from transition execution

        Returns:
            DeficiencyType enum value
        """
        if not error_type and not error_message:
            return DeficiencyType.FUNCTIONAL

        error_lower = (error_message or "").lower()
        type_lower = (error_type or "").lower()

        # Crash: Exception, fatal error
        if any(
            keyword in type_lower or keyword in error_lower
            for keyword in ["crash", "exception", "fatal", "segfault"]
        ):
            return DeficiencyType.CRASH

        # Timeout
        if "timeout" in type_lower or "timeout" in error_lower:
            return DeficiencyType.TIMEOUT

        # Visual: UI, rendering, display issues
        if any(
            keyword in type_lower or keyword in error_lower
            for keyword in ["visual", "render", "display", "ui", "layout"]
        ):
            return DeficiencyType.VISUAL

        # Performance: Slow, performance degradation
        if any(
            keyword in type_lower or keyword in error_lower
            for keyword in ["slow", "performance", "lag", "delay"]
        ):
            return DeficiencyType.PERFORMANCE

        # Default to functional
        return DeficiencyType.FUNCTIONAL

    @staticmethod
    def _generate_title(transition: TransitionExecution) -> str:
        """
        Generate a descriptive title for the deficiency.

        Args:
            transition: Failed transition execution

        Returns:
            Title string
        """
        source = transition.source_state or "unknown_state"
        target = transition.target_state or "unknown_state"
        error_type = transition.error_type or "error"

        return f"Transition failed: {source} → {target} ({error_type})"

    @staticmethod
    def _generate_description(transition: TransitionExecution) -> str:
        """
        Generate a detailed description for the deficiency.

        Args:
            transition: Failed transition execution

        Returns:
            Description string
        """
        parts = [
            f"Transition from '{transition.source_state}' to '{transition.target_state}' failed.",
            "",
        ]

        if transition.error_message:
            parts.append(f"Error: {transition.error_message}")
            parts.append("")

        if transition.error_type:
            parts.append(f"Error Type: {transition.error_type}")
            parts.append("")

        # Add timing information
        if transition.execution_time_ms:
            parts.append(f"Duration: {transition.execution_time_ms}ms")

        if transition.started_at:
            parts.append(f"Started: {transition.started_at.isoformat()}")

        if transition.completed_at:
            parts.append(f"Completed: {transition.completed_at.isoformat()}")

        # Add actual vs expected state
        if transition.actual_state and transition.target_state:
            if transition.actual_state != transition.target_state:
                parts.append("")
                parts.append(f"Expected state: {transition.target_state}")
                parts.append(f"Actual state: {transition.actual_state}")

        return "\n".join(parts)

    @staticmethod
    def _extract_reproduction_steps(transition: TransitionExecution) -> list[str]:
        """
        Extract reproduction steps from transition context.

        Args:
            transition: Transition execution

        Returns:
            List of reproduction step strings
        """
        steps = []

        # Add source state navigation
        if transition.source_state:
            steps.append(f"1. Navigate to state: {transition.source_state}")

        # Add transition trigger
        if transition.transition_name:
            steps.append(f"2. Execute transition: {transition.transition_name}")
        else:
            steps.append(
                f"2. Attempt transition to state: {transition.target_state or 'unknown'}"
            )

        # Add expected result
        if transition.target_state:
            steps.append(f"3. Expected: Arrive at state '{transition.target_state}'")

        # Add actual result
        if transition.error_message:
            steps.append(f"4. Actual: {transition.error_message}")

        return steps

    @staticmethod
    def _extract_environment_info(transition: TransitionExecution) -> dict[str, Any]:
        """
        Extract environment information from transition metadata.

        Args:
            transition: Transition execution

        Returns:
            Environment info dictionary
        """
        env_info: dict[str, Any] = {}

        # Extract from execution metadata if available
        if transition.execution_metadata:
            if "os" in transition.execution_metadata:
                env_info["os"] = transition.execution_metadata["os"]
            if "browser" in transition.execution_metadata:
                env_info["browser"] = transition.execution_metadata["browser"]
            if "screen_resolution" in transition.execution_metadata:
                env_info["screen_resolution"] = transition.execution_metadata[
                    "screen_resolution"
                ]

        return env_info

    @staticmethod
    async def create_deficiency_from_failure(
        db: AsyncSession,
        transition: TransitionExecution,
        test_run_id: UUID,
    ) -> TestDeficiency:
        """
        Create a TestDeficiency record from a failed transition.

        Automatically determines severity and type based on error patterns,
        extracts relevant context, and links to the transition execution.

        Args:
            db: Database session
            transition: Failed transition execution
            test_run_id: Test run ID

        Returns:
            Created TestDeficiency record
        """
        logger.info(
            "creating_deficiency_from_failure",
            transition_id=str(transition.id),
            test_run_id=str(test_run_id),
            error_type=transition.error_type,
        )

        # Determine severity and type
        severity = DeficiencyService._determine_severity(
            transition.error_type, transition.error_message
        )
        deficiency_type = DeficiencyService._determine_type(
            transition.error_type, transition.error_message
        )

        # Generate title and description
        title = DeficiencyService._generate_title(transition)
        description = DeficiencyService._generate_description(transition)

        # Extract reproduction steps
        reproduction_steps = DeficiencyService._extract_reproduction_steps(transition)

        # Extract environment info
        environment_info = DeficiencyService._extract_environment_info(transition)

        # Extract screenshot URLs
        screenshot_urls = (
            list(transition.screenshot_urls) if transition.screenshot_urls else []
        )

        # Create deficiency
        deficiency = TestDeficiency(
            test_run_id=test_run_id,
            transition_execution_id=transition.id,
            severity=severity,
            deficiency_type=deficiency_type,
            title=title,
            description=description,
            screenshot_urls=screenshot_urls,
            reproduction_steps=reproduction_steps,
            status=DeficiencyStatus.NEW,
            environment_info=environment_info,
            reproducible=True,  # Assume reproducible since it happened in automated test
            first_seen_at=datetime.now(UTC),
            last_seen_at=datetime.now(UTC),
            occurrence_count=1,
            custom_fields={
                "auto_generated": True,
                "source": "transition_failure",
                "transition_id": str(transition.id),
                "sequence_number": transition.sequence_number,
                "error_type_raw": transition.error_type,
                "error_message_raw": transition.error_message,
            },
        )

        db.add(deficiency)
        await db.flush()
        await db.refresh(deficiency)

        logger.info(
            "deficiency_created",
            deficiency_id=str(deficiency.id),
            transition_id=str(transition.id),
            severity=severity,
            deficiency_type=deficiency_type,
        )

        return deficiency

    @staticmethod
    async def link_screenshot_to_deficiency(
        db: AsyncSession,
        deficiency: TestDeficiency,
        screenshot_url: str,
    ) -> None:
        """
        Add a screenshot URL to an existing deficiency.

        Args:
            db: Database session
            deficiency: TestDeficiency to update
            screenshot_url: Screenshot URL to add
        """
        if screenshot_url not in deficiency.screenshot_urls:
            screenshot_urls = (
                list(deficiency.screenshot_urls) if deficiency.screenshot_urls else []
            )
            screenshot_urls.append(screenshot_url)
            deficiency.screenshot_urls = screenshot_urls
            deficiency.updated_at = datetime.now(UTC)
            await db.flush()

            logger.info(
                "screenshot_linked_to_deficiency",
                deficiency_id=str(deficiency.id),
                screenshot_url=screenshot_url,
            )
