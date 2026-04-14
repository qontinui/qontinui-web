"""
Tests for automatic deficiency creation service.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
)
from app.models.transition_execution import (
    TransitionExecution,
    TransitionExecutionStatus,
)
from app.services.deficiency_service import DeficiencyService


class TestDeficiencyService:
    """Test automatic deficiency creation from failed transitions."""

    def test_determine_severity_timeout(self):
        """Test severity determination for timeout errors."""
        severity = DeficiencyService._determine_severity(
            "timeout", "Connection timeout"
        )
        assert severity == DeficiencySeverity.MEDIUM

    def test_determine_severity_crash(self):
        """Test severity determination for crash errors."""
        severity = DeficiencyService._determine_severity(
            "exception", "Fatal exception occurred"
        )
        assert severity == DeficiencySeverity.CRITICAL

    def test_determine_severity_element_not_found(self):
        """Test severity determination for element not found errors."""
        severity = DeficiencyService._determine_severity(
            "element_not_found", "Button not found"
        )
        assert severity == DeficiencySeverity.HIGH

    def test_determine_severity_assertion_failure(self):
        """Test severity determination for assertion failures."""
        severity = DeficiencyService._determine_severity(
            "assertion_failed", "Assert failed: expected true"
        )
        assert severity == DeficiencySeverity.HIGH

    def test_determine_type_timeout(self):
        """Test type determination for timeout errors."""
        deficiency_type = DeficiencyService._determine_type(
            "timeout", "Request timeout"
        )
        assert deficiency_type == DeficiencyType.TIMEOUT

    def test_determine_type_crash(self):
        """Test type determination for crash errors."""
        deficiency_type = DeficiencyService._determine_type(
            "crash", "Application crashed"
        )
        assert deficiency_type == DeficiencyType.CRASH

    def test_determine_type_visual(self):
        """Test type determination for visual errors."""
        deficiency_type = DeficiencyService._determine_type(
            "ui_issue", "Rendering problem"
        )
        assert deficiency_type == DeficiencyType.VISUAL

    def test_determine_type_performance(self):
        """Test type determination for performance errors."""
        deficiency_type = DeficiencyService._determine_type(
            "slow", "Page load too slow"
        )
        assert deficiency_type == DeficiencyType.PERFORMANCE

    def test_generate_title(self):
        """Test title generation from transition."""
        transition = TransitionExecution(
            test_run_id=uuid4(),
            transition_id="login->dashboard",
            sequence_number=1,
            status=TransitionExecutionStatus.FAILED,
            started_at=datetime.now(UTC),
            source_state="login",
            target_state="dashboard",
            error_type="timeout",
        )

        title = DeficiencyService._generate_title(transition)
        assert "login" in title
        assert "dashboard" in title
        assert "timeout" in title

    def test_generate_description(self):
        """Test description generation from transition."""
        transition = TransitionExecution(
            test_run_id=uuid4(),
            transition_id="login->dashboard",
            sequence_number=1,
            status=TransitionExecutionStatus.FAILED,
            started_at=datetime.now(UTC),
            completed_at=datetime.now(UTC),
            source_state="login",
            target_state="dashboard",
            error_type="timeout",
            error_message="Request timed out after 30s",
            execution_time_ms=30000,
        )

        description = DeficiencyService._generate_description(transition)
        assert "login" in description
        assert "dashboard" in description
        assert "timeout" in description
        assert "Request timed out after 30s" in description
        assert "30000ms" in description

    def test_extract_reproduction_steps(self):
        """Test reproduction steps extraction."""
        transition = TransitionExecution(
            test_run_id=uuid4(),
            transition_id="login->dashboard",
            transition_name="successful_login",
            sequence_number=1,
            status=TransitionExecutionStatus.FAILED,
            started_at=datetime.now(UTC),
            source_state="login",
            target_state="dashboard",
            error_message="Login button not found",
        )

        steps = DeficiencyService._extract_reproduction_steps(transition)
        assert len(steps) > 0
        assert any("login" in step.lower() for step in steps)
        assert any("dashboard" in step.lower() for step in steps)
        assert any("not found" in step.lower() for step in steps)

    def test_extract_environment_info(self):
        """Test environment info extraction."""
        transition = TransitionExecution(
            test_run_id=uuid4(),
            transition_id="login->dashboard",
            sequence_number=1,
            status=TransitionExecutionStatus.FAILED,
            started_at=datetime.now(UTC),
            execution_metadata={
                "os": "Windows 11",
                "browser": "Chrome 119",
                "screen_resolution": "1920x1080",
            },
        )

        env_info = DeficiencyService._extract_environment_info(transition)
        assert env_info["os"] == "Windows 11"
        assert env_info["browser"] == "Chrome 119"
        assert env_info["screen_resolution"] == "1920x1080"

    @pytest.mark.asyncio
    async def test_create_deficiency_from_failure(self, async_db_session):
        """Test automatic deficiency creation from failed transition."""
        test_run_id = uuid4()

        # Create a failed transition
        transition = TransitionExecution(
            test_run_id=test_run_id,
            transition_id="login->dashboard",
            transition_name="successful_login",
            sequence_number=1,
            status=TransitionExecutionStatus.FAILED,
            started_at=datetime.now(UTC),
            completed_at=datetime.now(UTC),
            execution_time_ms=5000,
            source_state="login",
            target_state="dashboard",
            error_type="element_not_found",
            error_message="Login button not found on page",
            screenshot_urls=["https://s3.amazonaws.com/screenshots/error-1.png"],
        )
        async_db_session.add(transition)
        await async_db_session.commit()
        await async_db_session.refresh(transition)

        # Create deficiency from failure
        deficiency = await DeficiencyService.create_deficiency_from_failure(
            db=async_db_session,
            transition=transition,
            test_run_id=test_run_id,
        )

        # Verify deficiency was created correctly
        assert deficiency.id is not None
        assert deficiency.test_run_id == test_run_id
        assert deficiency.transition_execution_id == transition.id
        assert (
            deficiency.severity == DeficiencySeverity.HIGH
        )  # element_not_found → high
        assert deficiency.deficiency_type == DeficiencyType.FUNCTIONAL
        assert deficiency.status == DeficiencyStatus.NEW
        assert "login" in deficiency.title.lower()
        assert "dashboard" in deficiency.title.lower()
        assert "Login button not found" in deficiency.description
        assert len(deficiency.screenshot_urls) == 1
        assert len(deficiency.reproduction_steps) > 0
        assert deficiency.reproducible is True
        assert deficiency.custom_fields["auto_generated"] is True
        assert deficiency.custom_fields["source"] == "transition_failure"

    @pytest.mark.asyncio
    async def test_link_screenshot_to_deficiency(self, async_db_session):
        """Test linking screenshots to existing deficiencies."""
        from app.models.test_deficiency import TestDeficiency

        test_run_id = uuid4()

        # Create a deficiency
        deficiency = TestDeficiency(
            test_run_id=test_run_id,
            severity=DeficiencySeverity.HIGH,
            deficiency_type=DeficiencyType.FUNCTIONAL,
            title="Test deficiency",
            description="Test description",
            screenshot_urls=[],
            status=DeficiencyStatus.NEW,
        )
        async_db_session.add(deficiency)
        await async_db_session.commit()
        await async_db_session.refresh(deficiency)

        # Link screenshot
        screenshot_url = "https://s3.amazonaws.com/screenshots/new-screenshot.png"
        await DeficiencyService.link_screenshot_to_deficiency(
            db=async_db_session,
            deficiency=deficiency,
            screenshot_url=screenshot_url,
        )
        await async_db_session.refresh(deficiency)

        # Verify screenshot was added
        assert screenshot_url in deficiency.screenshot_urls

        # Try adding the same screenshot again (should not duplicate)
        await DeficiencyService.link_screenshot_to_deficiency(
            db=async_db_session,
            deficiency=deficiency,
            screenshot_url=screenshot_url,
        )
        await async_db_session.refresh(deficiency)

        # Should still only have one screenshot
        assert deficiency.screenshot_urls.count(screenshot_url) == 1
