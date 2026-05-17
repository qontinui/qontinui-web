"""
Visual comparison service.

Handles the compare workflow, review management, and pending reviews.

NOTE: As of plan-2026-05-17-web-image-slim, `compare_screenshot` raises
HTTPException(503) for the ignore-regions path (qontinui.vision.comparison
no longer lives in the web image). The standard path also fails at
`self.comparator`, which is the parent class's 503 short-circuit. The
runner-bridge replacement is tracked under
plan-2026-05-17-ws-bridge-for-violating-routers.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.software_test_run import SoftwareTestRun
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.test_screenshot import TestScreenshot
from app.models.visual_comparison_result import (
    ReviewDecision,
    VisualComparisonResult,
    VisualComparisonStatus,
)
from app.services.visual_testing.comparison_engine import ComparisonEngine

logger = structlog.get_logger(__name__)


class ComparisonService(ComparisonEngine):
    """Service for visual regression comparisons."""

    def __init__(self):
        super().__init__()
        # Lazy import to avoid circular dependency
        self._baseline_service = None

    @property
    def baseline_service(self):
        if self._baseline_service is None:
            from app.services.visual_testing import baseline_management_service

            self._baseline_service = baseline_management_service
        return self._baseline_service

    async def compare_screenshot(  # noqa: C901
        self,
        db: AsyncSession,
        screenshot_id: UUID,
        baseline_id: UUID | None = None,
        algorithm: str | None = None,
        threshold: float | None = None,
    ) -> VisualComparisonResult:
        """
        Compare a screenshot against its baseline.

        Args:
            db: Database session
            screenshot_id: Screenshot to compare
            baseline_id: Optional explicit baseline ID (otherwise auto-lookup)
            algorithm: Override comparison algorithm
            threshold: Override comparison threshold

        Returns:
            VisualComparisonResult with comparison details

        Raises:
            ValueError: If screenshot not found
        """
        logger.info(
            "comparing_screenshot",
            screenshot_id=str(screenshot_id),
            baseline_id=str(baseline_id) if baseline_id else None,
        )

        # Get the screenshot
        result = await db.execute(
            select(TestScreenshot)
            .options(selectinload(TestScreenshot.test_run))
            .where(TestScreenshot.id == screenshot_id)
        )
        screenshot = result.scalar_one_or_none()

        if not screenshot:
            raise ValueError(f"Screenshot not found: {screenshot_id}")

        if not screenshot.state_name:
            raise ValueError(
                f"Screenshot {screenshot_id} has no state_name for baseline matching"
            )

        # Get the test run for project context
        test_run = screenshot.test_run
        project_id = test_run.project_id
        workflow_id = test_run.workflow_id

        # Find baseline if not provided
        baseline = None
        if baseline_id:
            baseline = await self.baseline_service.get_baseline_by_id(db, baseline_id)
        else:
            baseline = await self.baseline_service.get_baseline_for_state(
                db, project_id, screenshot.state_name, workflow_id
            )

        # Handle no baseline case
        if not baseline:
            logger.info(
                "no_baseline_found",
                screenshot_id=str(screenshot_id),
                state_name=screenshot.state_name,
            )

            comparison_result = VisualComparisonResult(
                test_run_id=test_run.id,
                baseline_id=None,
                screenshot_id=screenshot_id,
                transition_execution_id=screenshot.transition_execution_id,
                state_name=screenshot.state_name,
                comparison_algorithm="none",
                similarity_score=0.0,
                threshold_used=0.0,
                status=VisualComparisonStatus.NO_BASELINE,
                diff_regions=[],
                execution_time_ms=0,
            )

            db.add(comparison_result)
            await db.flush()
            await db.refresh(comparison_result)

            return comparison_result

        # Get comparison settings from baseline
        comp_algorithm = algorithm or baseline.algorithm
        comp_threshold = threshold if threshold is not None else baseline.threshold
        ignore_regions = baseline.ignore_regions

        # Download images
        try:
            baseline_bytes = self.storage.download_file(baseline.storage_path)
            screenshot_bytes = self.storage.download_file(screenshot.storage_path)
        except Exception as e:
            logger.error(
                "image_download_failed",
                error=str(e),
            )
            comparison_result = VisualComparisonResult(
                test_run_id=test_run.id,
                baseline_id=baseline.id,
                screenshot_id=screenshot_id,
                transition_execution_id=screenshot.transition_execution_id,
                state_name=screenshot.state_name,
                comparison_algorithm=comp_algorithm,
                similarity_score=0.0,
                threshold_used=comp_threshold,
                status=VisualComparisonStatus.FAILED,
                diff_regions=[],
                execution_time_ms=0,
                error_message=f"Failed to download images: {str(e)}",
            )

            db.add(comparison_result)
            await db.flush()
            await db.refresh(comparison_result)

            return comparison_result

        # Convert to numpy arrays
        baseline_img = self._bytes_to_numpy(baseline_bytes)
        screenshot_img = self._bytes_to_numpy(screenshot_bytes)

        # Apply ignore regions if any
        if ignore_regions:
            # DEFERRED: ws-bridge — qontinui.vision.comparison no longer lives
            # in the web image (plan-2026-05-17-web-image-slim). Surface a
            # structured 503 BEFORE the import would ImportError.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "endpoint_requires_runner_bridge",
                    "message": (
                        "This endpoint depends on qontinui runtime functionality that lives on "
                        "the runner. The web - runner WebSocket bridge for this functionality is "
                        "not yet implemented. See architectural-decisions.md "
                        "'Web - runner WebSocket boundary'."
                    ),
                    "runner_module": "qontinui.vision.comparison",
                    "endpoint": "comparison_service.compare_screenshot (ignore_regions path)",
                    "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
                },
            )

        # Run comparison
        try:
            comp_result = self.comparator.compare(
                baseline=baseline_img,
                screenshot=screenshot_img,
                algorithm=comp_algorithm,
                threshold=comp_threshold,
            )
        except Exception as e:
            logger.error(
                "comparison_failed",
                error=str(e),
            )
            comparison_result = VisualComparisonResult(
                test_run_id=test_run.id,
                baseline_id=baseline.id,
                screenshot_id=screenshot_id,
                transition_execution_id=screenshot.transition_execution_id,
                state_name=screenshot.state_name,
                comparison_algorithm=comp_algorithm,
                similarity_score=0.0,
                threshold_used=comp_threshold,
                status=VisualComparisonStatus.FAILED,
                diff_regions=[],
                execution_time_ms=0,
                error_message=f"Comparison failed: {str(e)}",
            )

            db.add(comparison_result)
            await db.flush()
            await db.refresh(comparison_result)

            return comparison_result

        # Determine status. Local var renamed to avoid shadowing fastapi
        # `status` (imported above for the 503 short-circuit's
        # status.HTTP_503_SERVICE_UNAVAILABLE) — mypy flags shadowed binding
        # as used-before-def.
        if comp_result.passed:
            comparison_status = VisualComparisonStatus.PASSED
        else:
            comparison_status = VisualComparisonStatus.PENDING_REVIEW

        # Generate and upload diff image if there are differences
        diff_image_path = None
        if not comp_result.passed and comp_result.diff_mask is not None:
            try:
                diff_png = self.comparator.generate_diff_image(
                    baseline_img, screenshot_img, comp_result.diff_mask
                )
                diff_image_path = await self._upload_diff_image(
                    test_run.id, screenshot_id, diff_png
                )
            except Exception as e:
                logger.warning(
                    "diff_image_generation_failed",
                    error=str(e),
                )

        # Create comparison result
        comparison_result = VisualComparisonResult(
            test_run_id=test_run.id,
            baseline_id=baseline.id,
            screenshot_id=screenshot_id,
            transition_execution_id=screenshot.transition_execution_id,
            state_name=screenshot.state_name,
            comparison_algorithm=comp_algorithm,
            similarity_score=comp_result.similarity_score,
            threshold_used=comp_threshold,
            status=comparison_status,
            diff_image_path=diff_image_path,
            diff_regions=[r.to_dict() for r in comp_result.diff_regions],
            execution_time_ms=comp_result.execution_time_ms,
        )

        db.add(comparison_result)
        await db.flush()
        await db.refresh(comparison_result)

        logger.info(
            "comparison_completed",
            comparison_id=str(comparison_result.id),
            status=comparison_status.value,
            similarity_score=comp_result.similarity_score,
            threshold=comp_threshold,
        )

        return comparison_result

    async def compare_test_run(
        self,
        db: AsyncSession,
        test_run_id: UUID,
        state_filter: str | None = None,
    ) -> list[VisualComparisonResult]:
        """
        Compare all screenshots in a test run against their baselines.

        Args:
            db: Database session
            test_run_id: Test run ID
            state_filter: Optional state name filter

        Returns:
            List of VisualComparisonResult records
        """
        logger.info(
            "comparing_test_run",
            test_run_id=str(test_run_id),
            state_filter=state_filter,
        )

        # Get all screenshots with state_name
        conditions = [
            TestScreenshot.test_run_id == test_run_id,
            TestScreenshot.state_name.isnot(None),
        ]

        if state_filter:
            conditions.append(TestScreenshot.state_name == state_filter)

        result = await db.execute(select(TestScreenshot).where(and_(*conditions)))
        screenshots = result.scalars().all()

        results = []
        for screenshot in screenshots:
            try:
                comparison_result = await self.compare_screenshot(db, screenshot.id)
                results.append(comparison_result)
            except Exception as e:
                logger.error(
                    "screenshot_comparison_failed",
                    screenshot_id=str(screenshot.id),
                    error=str(e),
                )

        logger.info(
            "test_run_comparison_completed",
            test_run_id=str(test_run_id),
            total_screenshots=len(screenshots),
            total_comparisons=len(results),
        )

        return results

    async def review_comparison(
        self,
        db: AsyncSession,
        comparison_id: UUID,
        decision: ReviewDecision | str,
        user_id: UUID,
        notes: str | None = None,
    ) -> VisualComparisonResult:
        """
        Submit a review decision for a comparison result.

        Args:
            db: Database session
            comparison_id: Comparison result ID
            decision: Review decision (approved, rejected, new_baseline)
            user_id: User making the review
            notes: Optional review notes

        Returns:
            Updated VisualComparisonResult

        Raises:
            ValueError: If comparison not found
        """
        # Handle decision as either string or enum
        decision_value = decision.value if hasattr(decision, "value") else decision
        logger.info(
            "reviewing_comparison",
            comparison_id=str(comparison_id),
            decision=decision_value,
            user_id=str(user_id),
        )

        result = await db.execute(
            select(VisualComparisonResult)
            .options(
                selectinload(VisualComparisonResult.screenshot),
                selectinload(VisualComparisonResult.test_run),
            )
            .where(VisualComparisonResult.id == comparison_id)
        )
        comparison = result.scalar_one_or_none()

        if not comparison:
            raise ValueError(f"Comparison not found: {comparison_id}")

        # Update review fields
        comparison.reviewed_by_user_id = user_id
        comparison.reviewed_at = datetime.now(UTC)
        comparison.review_decision = decision_value
        comparison.review_notes = notes

        # Handle decision (compare as strings)
        if decision_value == ReviewDecision.APPROVED.value:
            # Difference is acceptable, no action needed
            comparison.status = VisualComparisonStatus.PASSED

        elif decision_value == ReviewDecision.REJECTED.value:
            # Difference is a bug, create deficiency
            comparison.status = VisualComparisonStatus.FAILED

            deficiency = await self._create_visual_deficiency(db, comparison)
            comparison.deficiency_id = deficiency.id

        elif decision_value == ReviewDecision.NEW_BASELINE.value:
            # Update baseline with the new screenshot
            comparison.status = VisualComparisonStatus.APPROVED_AS_NEW

            # Create new baseline from the screenshot
            test_run = comparison.test_run
            await self.baseline_service.create_from_screenshot(
                db=db,
                project_id=test_run.project_id,
                state_name=comparison.state_name,
                screenshot_id=comparison.screenshot_id,
                user_id=user_id,
                workflow_id=test_run.workflow_id,
                approval_notes=notes or "Updated via visual regression review",
            )

        await db.flush()
        await db.refresh(comparison)

        logger.info(
            "comparison_reviewed",
            comparison_id=str(comparison_id),
            decision=decision_value,
            new_status=comparison.status,
        )

        return comparison

    async def get_pending_reviews(
        self,
        db: AsyncSession,
        project_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> list[VisualComparisonResult]:
        """
        Get comparisons pending review for a project.

        Args:
            db: Database session
            project_id: Project ID
            skip: Pagination offset
            limit: Maximum results

        Returns:
            List of VisualComparisonResult awaiting review
        """
        result = await db.execute(
            select(VisualComparisonResult)
            .join(SoftwareTestRun)
            .where(
                and_(
                    SoftwareTestRun.project_id == project_id,
                    VisualComparisonResult.status
                    == VisualComparisonStatus.PENDING_REVIEW,
                )
            )
            .order_by(VisualComparisonResult.created_at.desc())
            .offset(skip)
            .limit(limit)
        )

        return list(result.scalars().all())

    async def get_comparison_by_id(
        self,
        db: AsyncSession,
        comparison_id: UUID,
    ) -> VisualComparisonResult | None:
        """
        Get a comparison result by ID.

        Args:
            db: Database session
            comparison_id: Comparison ID

        Returns:
            VisualComparisonResult or None
        """
        result = await db.execute(
            select(VisualComparisonResult)
            .options(
                selectinload(VisualComparisonResult.baseline),
                selectinload(VisualComparisonResult.screenshot),
            )
            .where(VisualComparisonResult.id == comparison_id)
        )
        return result.scalar_one_or_none()

    async def get_diff_image_url(
        self,
        comparison: VisualComparisonResult,
        expiration: int = 3600,
    ) -> str | None:
        """
        Get presigned URL for diff image.

        Args:
            comparison: VisualComparisonResult
            expiration: URL expiration in seconds

        Returns:
            Presigned URL or None
        """
        if not comparison.diff_image_path:
            return None
        return self.storage.generate_presigned_url(
            comparison.diff_image_path, expiration
        )

    async def _create_visual_deficiency(
        self,
        db: AsyncSession,
        comparison: VisualComparisonResult,
    ) -> TestDeficiency:
        """Create a deficiency from a failed visual comparison."""
        # Generate title and description
        title = f"Visual regression: {comparison.state_name}"
        description = (
            f"Visual regression detected in state '{comparison.state_name}'.\n\n"
            f"Similarity score: {comparison.similarity_score:.2%}\n"
            f"Threshold: {comparison.threshold_used:.2%}\n"
            f"Algorithm: {comparison.comparison_algorithm}\n\n"
            f"The screenshot differs from the approved baseline beyond the acceptable threshold."
        )

        if comparison.diff_regions:
            description += f"\n\nDiff regions detected: {len(comparison.diff_regions)}"

        # Create deficiency
        deficiency = TestDeficiency(
            test_run_id=comparison.test_run_id,
            transition_execution_id=comparison.transition_execution_id,
            severity=DeficiencySeverity.MEDIUM,
            deficiency_type=DeficiencyType.VISUAL,
            title=title,
            description=description,
            screenshot_urls=[],
            reproduction_steps=[
                f"1. Navigate to state: {comparison.state_name}",
                "2. Compare visual appearance against approved baseline",
                f"3. Observe differences (similarity: {comparison.similarity_score:.2%})",
            ],
            status=DeficiencyStatus.NEW,
            environment_info={},
            reproducible=True,
            first_seen_at=datetime.now(UTC),
            last_seen_at=datetime.now(UTC),
            occurrence_count=1,
            custom_fields={
                "auto_generated": True,
                "source": "visual_regression",
                "comparison_id": str(comparison.id),
                "state_name": comparison.state_name,
                "similarity_score": comparison.similarity_score,
                "threshold": comparison.threshold_used,
                "algorithm": comparison.comparison_algorithm,
            },
        )

        db.add(deficiency)
        await db.flush()
        await db.refresh(deficiency)

        logger.info(
            "visual_deficiency_created",
            deficiency_id=str(deficiency.id),
            comparison_id=str(comparison.id),
            state_name=comparison.state_name,
        )

        return deficiency
