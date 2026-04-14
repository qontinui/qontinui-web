"""
Integration tests for visual regression testing API endpoints.

Tests the complete API flow for visual baselines, comparisons,
and review workflows.
"""

from datetime import UTC, datetime
from io import BytesIO

import pytest
from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun
from app.models.test_screenshot import TestScreenshot
from app.models.user import User
from app.models.visual_baseline import VisualBaseline
from app.models.visual_comparison_result import (VisualComparisonResult,
                                                 VisualComparisonStatus)
from app.services.visual_testing import (BaselineManagementService,
                                         VisualComparisonService)
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def create_test_image(
    width: int = 100, height: int = 100, color: tuple = (255, 0, 0)
) -> bytes:
    """Create a test image with the given dimensions and color."""
    img = Image.new("RGB", (width, height), color)
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


# Note: test_screenshot, test_baseline, and test_comparison_result fixtures
# are defined in conftest.py


@pytest.mark.asyncio
class TestVisualBaselineModel:
    """Tests for VisualBaseline model operations."""

    async def test_create_baseline(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_user: User,
    ):
        """Test creating a visual baseline."""
        baseline = VisualBaseline(
            project_id=test_project.id,
            state_name="dashboard",
            storage_path="baselines/dashboard/v1.png",
            thumbnail_path="baselines/dashboard/v1_thumb.png",
            width=1920,
            height=1080,
            version=1,
            is_active=True,
            approved_by_user_id=test_user.id,
            approved_at=datetime.now(UTC),
            comparison_settings={
                "algorithm": "ssim",
                "threshold": 0.95,
                "ignore_regions": [],
            },
        )
        db_session.add(baseline)
        await db_session.commit()
        await db_session.refresh(baseline)

        assert baseline.id is not None
        assert baseline.state_name == "dashboard"
        assert baseline.version == 1
        assert baseline.is_active is True

    async def test_baseline_versioning(
        self,
        db_session: AsyncSession,
        test_baseline: VisualBaseline,
        test_user: User,
    ):
        """Test creating a new version of a baseline."""
        # Deactivate old baseline
        test_baseline.is_active = False
        await db_session.commit()

        # Create new version
        new_baseline = VisualBaseline(
            project_id=test_baseline.project_id,
            state_name=test_baseline.state_name,
            storage_path="visual-baselines/test-project/login_page/v2.png",
            thumbnail_path="visual-baselines/test-project/login_page/v2_thumb.png",
            width=100,
            height=100,
            version=2,
            is_active=True,
            approved_by_user_id=test_user.id,
            approved_at=datetime.now(UTC),
            comparison_settings=test_baseline.comparison_settings,
        )
        db_session.add(new_baseline)
        await db_session.commit()

        # Verify versions
        result = await db_session.execute(
            select(VisualBaseline).filter(
                VisualBaseline.project_id == test_baseline.project_id,
                VisualBaseline.state_name == test_baseline.state_name,
            )
        )
        baselines = result.scalars().all()
        assert len(baselines) == 2
        assert baselines[0].version != baselines[1].version


@pytest.mark.asyncio
class TestVisualComparisonModel:
    """Tests for VisualComparisonResult model operations."""

    async def test_create_comparison_result(
        self,
        db_session: AsyncSession,
        test_run: SoftwareTestRun,
        test_baseline: VisualBaseline,
        test_screenshot: TestScreenshot,
    ):
        """Test creating a comparison result."""
        comparison = VisualComparisonResult(
            test_run_id=test_run.id,
            baseline_id=test_baseline.id,
            screenshot_id=test_screenshot.id,
            state_name="login_page",
            comparison_algorithm="ssim",
            similarity_score=0.98,
            threshold_used=0.95,
            status=VisualComparisonStatus.PASSED,
        )
        db_session.add(comparison)
        await db_session.commit()
        await db_session.refresh(comparison)

        assert comparison.id is not None
        assert comparison.similarity_score == 0.98
        assert comparison.status == VisualComparisonStatus.PASSED

    async def test_comparison_status_transitions(
        self,
        db_session: AsyncSession,
        test_comparison_result: VisualComparisonResult,
        test_user: User,
    ):
        """Test comparison status transitions."""
        # Start as pending review
        assert test_comparison_result.status == VisualComparisonStatus.PENDING_REVIEW

        # Approve the comparison
        test_comparison_result.status = VisualComparisonStatus.APPROVED_AS_NEW
        test_comparison_result.reviewed_by_user_id = test_user.id
        test_comparison_result.reviewed_at = datetime.now(UTC)
        test_comparison_result.review_notes = "Intentional UI change"
        await db_session.commit()

        # Verify
        await db_session.refresh(test_comparison_result)
        assert test_comparison_result.status == VisualComparisonStatus.APPROVED_AS_NEW
        assert test_comparison_result.reviewed_by_user_id == test_user.id


@pytest.mark.asyncio
class TestBaselineManagementService:
    """Tests for BaselineManagementService."""

    async def test_get_baseline_for_state(
        self,
        db_session: AsyncSession,
        test_baseline: VisualBaseline,
    ):
        """Test finding active baseline for a state."""
        service = BaselineManagementService()
        baseline = await service.get_baseline_for_state(
            db=db_session,
            project_id=test_baseline.project_id,
            state_name="login_page",
        )

        assert baseline is not None
        assert baseline.id == test_baseline.id
        assert baseline.is_active is True

    async def test_get_baseline_for_nonexistent_state(
        self,
        db_session: AsyncSession,
        test_project: Project,
    ):
        """Test finding baseline for non-existent state returns None."""
        service = BaselineManagementService()
        baseline = await service.get_baseline_for_state(
            db=db_session,
            project_id=test_project.id,
            state_name="nonexistent_state",
        )

        assert baseline is None


@pytest.mark.asyncio
class TestVisualComparisonService:
    """Tests for VisualComparisonService."""

    async def test_review_comparison_approve(
        self,
        db_session: AsyncSession,
        test_comparison_result: VisualComparisonResult,
        test_user: User,
    ):
        """Test approving a comparison."""
        service = VisualComparisonService()
        result = await service.review_comparison(
            db=db_session,
            comparison_id=test_comparison_result.id,
            decision="approved",
            user_id=test_user.id,
            notes="Looks good",
        )

        assert result.status == VisualComparisonStatus.PASSED
        assert result.reviewed_by_user_id == test_user.id
        assert result.review_notes == "Looks good"

    async def test_review_comparison_reject(
        self,
        db_session: AsyncSession,
        test_comparison_result: VisualComparisonResult,
        test_user: User,
    ):
        """Test rejecting a comparison."""
        service = VisualComparisonService()
        result = await service.review_comparison(
            db=db_session,
            comparison_id=test_comparison_result.id,
            decision="rejected",
            user_id=test_user.id,
            notes="This is a regression",
        )

        assert result.status == VisualComparisonStatus.FAILED
        assert result.reviewed_by_user_id == test_user.id

    async def test_review_comparison_new_baseline(
        self,
        db_session: AsyncSession,
        test_comparison_result: VisualComparisonResult,
        test_user: User,
    ):
        """Test setting comparison as new baseline."""
        service = VisualComparisonService()
        result = await service.review_comparison(
            db=db_session,
            comparison_id=test_comparison_result.id,
            decision="new_baseline",
            user_id=test_user.id,
            notes="Intentional redesign",
        )

        assert result.status == VisualComparisonStatus.APPROVED_AS_NEW
        assert result.reviewed_by_user_id == test_user.id

    async def test_get_pending_reviews(
        self,
        db_session: AsyncSession,
        test_comparison_result: VisualComparisonResult,
        test_project: Project,
    ):
        """Test getting pending reviews for a project."""
        service = VisualComparisonService()
        results = await service.get_pending_reviews(
            db=db_session,
            project_id=test_project.id,
        )

        assert len(results) >= 1
        assert all(r.status == VisualComparisonStatus.PENDING_REVIEW for r in results)


@pytest.mark.asyncio
class TestScreenshotWithVisualRegression:
    """Tests for screenshot upload with visual regression integration."""

    async def test_screenshot_state_name_populated(
        self,
        db_session: AsyncSession,
        test_screenshot: TestScreenshot,
    ):
        """Test that screenshot has state_name field populated."""
        assert test_screenshot.state_name == "login_page"

    async def test_screenshot_baseline_association(
        self,
        db_session: AsyncSession,
        test_comparison_result: VisualComparisonResult,
    ):
        """Test that comparison correctly associates screenshot and baseline."""
        await db_session.refresh(test_comparison_result)

        assert test_comparison_result.screenshot_id is not None
        assert test_comparison_result.baseline_id is not None
        assert test_comparison_result.state_name == "login_page"


@pytest.mark.asyncio
class TestVisualRegressionStats:
    """Tests for visual regression statistics."""

    async def test_comparison_stats_calculation(
        self,
        db_session: AsyncSession,
        test_run: SoftwareTestRun,
        test_baseline: VisualBaseline,
        test_screenshot: TestScreenshot,
    ):
        """Test calculating comparison statistics."""
        # Create multiple comparisons with different statuses
        comparisons = [
            VisualComparisonResult(
                test_run_id=test_run.id,
                baseline_id=test_baseline.id,
                screenshot_id=test_screenshot.id,
                state_name=f"state_{i}",
                comparison_algorithm="ssim",
                similarity_score=0.95 + (i * 0.01),
                threshold_used=0.95,
                status=status,
            )
            for i, status in enumerate(
                [
                    VisualComparisonStatus.PASSED,
                    VisualComparisonStatus.PASSED,
                    VisualComparisonStatus.FAILED,
                    VisualComparisonStatus.PENDING_REVIEW,
                ]
            )
        ]

        for comp in comparisons:
            db_session.add(comp)
        await db_session.commit()

        # Query and verify
        result = await db_session.execute(
            select(VisualComparisonResult).filter(
                VisualComparisonResult.test_run_id == test_run.id
            )
        )
        all_comparisons = result.scalars().all()

        passed = sum(
            1 for c in all_comparisons if c.status == VisualComparisonStatus.PASSED
        )
        failed = sum(
            1 for c in all_comparisons if c.status == VisualComparisonStatus.FAILED
        )
        pending = sum(
            1
            for c in all_comparisons
            if c.status == VisualComparisonStatus.PENDING_REVIEW
        )

        assert passed >= 2
        assert failed >= 1
        assert pending >= 1
