"""
Repository for software test run database operations.

Handles queries for test runs, coverage trends, and reliability statistics,
following the repository pattern to separate data access from business logic.
"""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import TestDeficiency
from app.models.test_screenshot import TestScreenshot
from app.models.transition_execution import (
    TransitionExecution,
    TransitionExecutionStatus,
)

logger = structlog.get_logger(__name__)


class TestRunRepository:
    """Repository for software test run database operations."""

    @staticmethod
    async def list_runs(
        db: AsyncSession,
        project_id: UUID,
        status: str | None = None,
        runner_hostname: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        sort_by: str = "started_at",
        sort_order: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[SoftwareTestRun], int]:
        """
        List test runs with filtering and sorting.

        Args:
            db: Database session
            project_id: Project ID to filter by
            status: Optional status filter (running, completed, failed, timeout, aborted)
            runner_hostname: Optional filter by runner machine hostname
            start_date: Filter runs started after this date
            end_date: Filter runs started before this date
            sort_by: Field to sort by (started_at, ended_at, coverage_percentage)
            sort_order: Sort direction (asc or desc)
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Tuple of (test runs list, total count)
        """
        # Build query with filters
        query = select(SoftwareTestRun).filter(SoftwareTestRun.project_id == project_id)

        # Apply optional filters
        if status:
            status_map = {
                "running": TestRunStatus.RUNNING,
                "completed": TestRunStatus.COMPLETED,
                "failed": TestRunStatus.FAILED,
                "timeout": TestRunStatus.TIMEOUT,
                "aborted": TestRunStatus.CANCELLED,
            }
            if status in status_map:
                query = query.filter(SoftwareTestRun.status == status_map[status])

        if runner_hostname:
            query = query.filter(
                SoftwareTestRun.runner_metadata["hostname"].astext == runner_hostname
            )

        if start_date:
            query = query.filter(SoftwareTestRun.started_at >= start_date)

        if end_date:
            query = query.filter(SoftwareTestRun.started_at <= end_date)

        # Get total count before pagination
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply sorting
        sort_column = getattr(SoftwareTestRun, sort_by, SoftwareTestRun.started_at)
        if sort_order == "desc":
            query = query.order_by(sort_column.desc())
        else:
            query = query.order_by(sort_column.asc())

        # Apply pagination
        query = query.limit(limit).offset(offset)
        result = await db.execute(query)
        runs = result.scalars().all()

        logger.debug(
            "test_runs_listed",
            project_id=str(project_id),
            total=total,
            returned=len(runs),
            status_filter=status,
        )

        return list(runs), total

    @staticmethod
    async def get_run_detail(
        db: AsyncSession,
        run_id: UUID,
        include_transitions: bool = False,
        include_deficiencies: bool = False,
        include_screenshots: bool = False,
    ) -> tuple[
        SoftwareTestRun | None,
        list[TransitionExecution] | None,
        list[TestDeficiency] | None,
        list[TestScreenshot] | None,
    ]:
        """
        Get test run with optional related data.

        Args:
            db: Database session
            run_id: Test run ID
            include_transitions: Include full list of transitions
            include_deficiencies: Include full list of deficiencies
            include_screenshots: Include full list of screenshots

        Returns:
            Tuple of (test_run, transitions, deficiencies, screenshots)
            Related data lists are None if not requested
        """
        # Get the test run
        result = await db.execute(
            select(SoftwareTestRun).filter(SoftwareTestRun.id == run_id)
        )
        test_run = result.scalar_one_or_none()

        if not test_run:
            return None, None, None, None

        # Load related data based on include flags
        transitions_list: list[TransitionExecution] | None = None
        deficiencies_list: list[TestDeficiency] | None = None
        screenshots_list: list[TestScreenshot] | None = None

        if include_transitions:
            result = await db.execute(
                select(TransitionExecution)
                .filter(TransitionExecution.test_run_id == run_id)
                .order_by(TransitionExecution.sequence_number)
            )
            transitions_list = list(result.scalars().all())

        if include_deficiencies:
            result = await db.execute(
                select(TestDeficiency)
                .filter(TestDeficiency.test_run_id == run_id)
                .order_by(TestDeficiency.created_at.desc())
            )
            deficiencies_list = list(result.scalars().all())

        if include_screenshots:
            result = await db.execute(
                select(TestScreenshot)
                .filter(TestScreenshot.test_run_id == run_id)
                .order_by(TestScreenshot.captured_at.asc())
            )
            screenshots_list = list(result.scalars().all())

        logger.debug(
            "test_run_detail_fetched",
            run_id=str(run_id),
            include_transitions=include_transitions,
            include_deficiencies=include_deficiencies,
            include_screenshots=include_screenshots,
            transitions_count=len(transitions_list) if transitions_list else 0,
            deficiencies_count=len(deficiencies_list) if deficiencies_list else 0,
            screenshots_count=len(screenshots_list) if screenshots_list else 0,
        )

        return test_run, transitions_list, deficiencies_list, screenshots_list

    @staticmethod
    async def get_coverage_trends(
        db: AsyncSession,
        project_id: UUID,
        workflow_id: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        granularity: str = "daily",
    ) -> dict[str, Any]:
        """
        Get time-series coverage data for trend visualization.

        Args:
            db: Database session
            project_id: Project ID to filter by
            workflow_id: Optional workflow ID filter
            start_date: Start of date range
            end_date: End of date range
            granularity: Data aggregation level (daily, weekly, monthly)

        Returns:
            Dictionary with:
                - data_points: List of coverage data points
                - overall_stats: Aggregate statistics
                - start_date: Actual start date of data
                - end_date: Actual end date of data
        """
        # Build query for completed test runs
        query = select(SoftwareTestRun).filter(
            SoftwareTestRun.project_id == project_id,
            SoftwareTestRun.status == TestRunStatus.COMPLETED,
        )

        if workflow_id:
            query = query.filter(SoftwareTestRun.workflow_id == workflow_id)

        if start_date:
            query = query.filter(SoftwareTestRun.started_at >= start_date)

        if end_date:
            query = query.filter(SoftwareTestRun.started_at <= end_date)

        query = query.order_by(SoftwareTestRun.started_at.asc())

        result = await db.execute(query)
        runs = result.scalars().all()

        # Group runs by date based on granularity
        data_by_date: dict[str, list[SoftwareTestRun]] = defaultdict(list)
        for run in runs:
            if granularity == "daily":
                date_key = run.started_at.strftime("%Y-%m-%d")
            elif granularity == "weekly":
                # Get start of week (Monday)
                week_start = run.started_at - timedelta(days=run.started_at.weekday())
                date_key = week_start.strftime("%Y-%m-%d")
            else:  # monthly
                date_key = run.started_at.strftime("%Y-%m-01")
            data_by_date[date_key].append(run)

        # Build data points
        data_points = []
        for date_key, date_runs in sorted(data_by_date.items()):
            coverages = [float(r.coverage_percentage) for r in date_runs]
            transitions = sum(r.total_transitions for r in date_runs)
            unique_transitions = sum(r.unique_paths_found for r in date_runs)

            data_points.append(
                {
                    "date": date_key,
                    "runs_count": len(date_runs),
                    "avg_coverage_percentage": (
                        sum(coverages) / len(coverages) if coverages else 0
                    ),
                    "max_coverage_percentage": max(coverages) if coverages else 0,
                    "min_coverage_percentage": min(coverages) if coverages else 0,
                    "total_transitions_executed": transitions,
                    "unique_transitions_covered": unique_transitions,
                }
            )

        # Calculate overall statistics
        all_coverages = [float(r.coverage_percentage) for r in runs]
        trend = "stable"
        if len(data_points) >= 2:
            first_avg_val = data_points[0]["avg_coverage_percentage"]
            last_avg_val = data_points[-1]["avg_coverage_percentage"]
            # Cast to float - values are numeric from aggregation
            first_avg = float(first_avg_val) if first_avg_val is not None else 0.0  # type: ignore[arg-type]
            last_avg = float(last_avg_val) if last_avg_val is not None else 0.0  # type: ignore[arg-type]
            if last_avg > first_avg + 5:
                trend = "increasing"
            elif last_avg < first_avg - 5:
                trend = "decreasing"

        overall_stats = {
            "total_runs": len(runs),
            "avg_coverage_percentage": (
                sum(all_coverages) / len(all_coverages) if all_coverages else 0
            ),
            "coverage_trend": trend,
            "total_unique_transitions": sum(r.unique_paths_found for r in runs),
        }

        # Determine actual date range
        actual_start = runs[0].started_at.strftime("%Y-%m-%d") if runs else ""
        actual_end = runs[-1].started_at.strftime("%Y-%m-%d") if runs else ""

        logger.debug(
            "coverage_trends_calculated",
            project_id=str(project_id),
            workflow_id=workflow_id,
            granularity=granularity,
            data_points_count=len(data_points),
            trend=trend,
        )

        return {
            "data_points": data_points,
            "overall_stats": overall_stats,
            "start_date": actual_start,
            "end_date": actual_end,
        }

    @staticmethod
    async def get_reliability_stats(
        db: AsyncSession,
        project_id: UUID,
        workflow_id: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        min_executions: int = 5,
    ) -> dict[str, Any]:
        """
        Get per-transition reliability statistics.

        Args:
            db: Database session
            project_id: Project ID to filter by
            workflow_id: Optional workflow ID filter
            start_date: Start of date range
            end_date: End of date range
            min_executions: Minimum executions required to include a transition

        Returns:
            Dictionary with:
                - transition_stats: List of per-transition statistics
                - overall_reliability: Aggregate reliability metrics
                - date_range: The date range of data
        """
        # Get test runs for this project (and optionally workflow)
        runs_query = select(SoftwareTestRun.id).filter(
            SoftwareTestRun.project_id == project_id,
        )

        if workflow_id:
            runs_query = runs_query.filter(SoftwareTestRun.workflow_id == workflow_id)

        if start_date:
            runs_query = runs_query.filter(SoftwareTestRun.started_at >= start_date)

        if end_date:
            runs_query = runs_query.filter(SoftwareTestRun.started_at <= end_date)

        # Get all transitions for these runs
        result = await db.execute(
            select(TransitionExecution).filter(
                TransitionExecution.test_run_id.in_(runs_query)
            )
        )
        transitions = result.scalars().all()

        # Group transitions by transition_id
        transition_groups: dict[str, list[TransitionExecution]] = defaultdict(list)
        for t in transitions:
            transition_groups[t.transition_id].append(t)

        # Build statistics for each transition
        transition_stats = []
        total_success_rate: float = 0.0
        most_reliable: str | None = None
        least_reliable: str | None = None
        max_success_rate: float = -1.0
        min_success_rate: float = 101.0

        for transition_id, group in transition_groups.items():
            if len(group) < min_executions:
                continue

            successful = sum(
                1 for t in group if t.status == TransitionExecutionStatus.SUCCESS
            )
            failed = len(group) - successful
            success_rate = (successful / len(group)) * 100 if group else 0

            durations = [
                t.execution_time_ms for t in group if t.execution_time_ms is not None
            ]
            avg_duration = sum(durations) // len(durations) if durations else 0
            sorted_durations = sorted(durations)
            median_duration = (
                sorted_durations[len(sorted_durations) // 2] if sorted_durations else 0
            )
            p95_index = int(len(sorted_durations) * 0.95)
            p95_duration = sorted_durations[p95_index] if sorted_durations else 0

            # Get failure modes
            failure_counts: dict[str, int] = defaultdict(int)
            for t in group:
                if t.status != TransitionExecutionStatus.SUCCESS and t.error_type:
                    failure_counts[t.error_type] += 1

            failure_modes = [
                {
                    "error_type": error_type,
                    "count": count,
                    "percentage": (count / failed * 100) if failed > 0 else 0,
                }
                for error_type, count in failure_counts.items()
            ]

            # Get from/to state from first transition
            first_t = group[0]
            stats = {
                "transition_name": first_t.transition_name or transition_id,
                "from_state": first_t.source_state or "",
                "to_state": first_t.target_state or "",
                "total_executions": len(group),
                "successful_executions": successful,
                "failed_executions": failed,
                "success_rate": success_rate,
                "avg_duration_ms": avg_duration,
                "median_duration_ms": median_duration,
                "p95_duration_ms": p95_duration,
                "failure_modes": failure_modes,
            }
            transition_stats.append(stats)
            total_success_rate += success_rate

            transition_name = first_t.transition_name or transition_id
            if success_rate > max_success_rate:
                max_success_rate = success_rate
                most_reliable = transition_name
            if success_rate < min_success_rate:
                min_success_rate = success_rate
                least_reliable = transition_name

        avg_success_rate = (
            total_success_rate / len(transition_stats) if transition_stats else 0
        )

        overall_reliability = {
            "total_transitions_analyzed": len(transition_stats),
            "avg_success_rate": avg_success_rate,
            "most_reliable_transition": most_reliable,
            "least_reliable_transition": least_reliable,
        }

        date_range = {
            "start": start_date.strftime("%Y-%m-%d") if start_date else "",
            "end": end_date.strftime("%Y-%m-%d") if end_date else "",
        }

        logger.debug(
            "reliability_stats_calculated",
            project_id=str(project_id),
            workflow_id=workflow_id,
            transitions_analyzed=len(transition_stats),
            avg_success_rate=avg_success_rate,
        )

        return {
            "transition_stats": transition_stats,
            "overall_reliability": overall_reliability,
            "date_range": date_range,
        }

    @staticmethod
    async def get_by_id(db: AsyncSession, run_id: UUID) -> SoftwareTestRun | None:
        """
        Get a test run by ID.

        Args:
            db: Database session
            run_id: Test run ID

        Returns:
            The SoftwareTestRun or None if not found
        """
        result = await db.execute(
            select(SoftwareTestRun).filter(SoftwareTestRun.id == run_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_with_project_access(
        db: AsyncSession, run_id: UUID
    ) -> tuple[SoftwareTestRun | None, UUID | None]:
        """
        Get a test run by ID and return its project_id for access verification.

        Args:
            db: Database session
            run_id: Test run ID

        Returns:
            Tuple of (test_run, project_id)
        """
        result = await db.execute(
            select(SoftwareTestRun).filter(SoftwareTestRun.id == run_id)
        )
        test_run = result.scalar_one_or_none()

        if test_run:
            return test_run, test_run.project_id
        return None, None

    @staticmethod
    def build_run_detail_response(
        test_run: SoftwareTestRun,
        transitions: list[TransitionExecution] | None,
        deficiencies: list[TestDeficiency] | None,
        screenshots: list[TestScreenshot] | None,
    ) -> dict[str, Any]:
        """
        Build a detailed response dictionary from test run data.

        Args:
            test_run: The test run model
            transitions: Optional list of transition executions
            deficiencies: Optional list of deficiencies
            screenshots: Optional list of screenshots

        Returns:
            Dictionary suitable for TestRunDetail response
        """
        # Build base response
        response: dict[str, Any] = {
            "id": test_run.id,
            "project_id": test_run.project_id,
            "workflow_id": test_run.workflow_id,
            "status": test_run.status,
            "started_at": test_run.started_at,
            "ended_at": test_run.completed_at,
            "total_transitions": test_run.total_transitions,
            "coverage_percentage": float(test_run.coverage_percentage),
            "unique_states_visited": test_run.unique_states_visited,
            "unique_paths_found": test_run.unique_paths_found,
            "deficiencies_found": test_run.deficiencies_found,
            "runner_metadata": test_run.runner_metadata or {},
            "description": test_run.configuration_snapshot.get("description"),
            "workflow_metadata": test_run.configuration_snapshot.get(
                "workflow_metadata", {}
            ),
            "configuration_snapshot": test_run.configuration_snapshot,
            "final_metrics": test_run.configuration_snapshot.get("final_metrics"),
            "coverage_data": test_run.configuration_snapshot.get("coverage_data"),
            "updated_at": test_run.updated_at,
            "created_by": test_run.configuration_snapshot.get("created_by"),
        }

        # Add optional related data
        if transitions is not None:
            response["transitions"] = [
                {
                    "id": t.id,
                    "transition_id": t.transition_id,
                    "transition_name": t.transition_name,
                    "source_state": t.source_state,
                    "target_state": t.target_state,
                    "sequence_number": t.sequence_number,
                    "status": t.status,
                    "started_at": t.started_at,
                    "ended_at": t.ended_at,
                    "execution_time_ms": t.execution_time_ms,
                    "error_message": t.error_message,
                    "error_type": t.error_type,
                }
                for t in transitions
            ]

        if deficiencies is not None:
            response["deficiencies"] = [
                {
                    "id": d.id,
                    "title": d.title,
                    "description": d.description,
                    "severity": d.severity,
                    "type": d.deficiency_type,
                    "status": d.status,
                    "created_at": d.created_at,
                    "resolved_at": d.resolved_at,
                }
                for d in deficiencies
            ]

        if screenshots is not None:
            response["screenshots"] = [
                {
                    "id": s.id,
                    "filename": s.filename,
                    "path": s.path,
                    "captured_at": s.captured_at,
                    "context": s.context,
                }
                for s in screenshots
            ]

        return response


class CoverageRepository:
    """Repository for coverage-related database operations."""

    @staticmethod
    async def get_latest_coverage(
        db: AsyncSession,
        project_id: UUID,
        workflow_id: str | None = None,
    ) -> dict[str, Any] | None:
        """
        Get the latest coverage data for a project/workflow.

        Args:
            db: Database session
            project_id: Project ID
            workflow_id: Optional workflow ID filter

        Returns:
            Coverage data from the most recent completed run, or None
        """
        query = select(SoftwareTestRun).filter(
            SoftwareTestRun.project_id == project_id,
            SoftwareTestRun.status == TestRunStatus.COMPLETED,
        )

        if workflow_id:
            query = query.filter(SoftwareTestRun.workflow_id == workflow_id)

        query = query.order_by(SoftwareTestRun.completed_at.desc()).limit(1)

        result = await db.execute(query)
        run = result.scalar_one_or_none()

        if not run:
            return None

        return {
            "run_id": run.id,
            "coverage_percentage": float(run.coverage_percentage),
            "unique_paths_found": run.unique_paths_found,
            "unique_states_visited": run.unique_states_visited,
            "total_transitions": run.total_transitions,
            "completed_at": run.completed_at,
            "coverage_data": run.configuration_snapshot.get("coverage_data", {}),
        }

    @staticmethod
    async def get_coverage_comparison(
        db: AsyncSession,
        project_id: UUID,
        workflow_id: str | None = None,
        runs_to_compare: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Get coverage data for recent runs for comparison.

        Args:
            db: Database session
            project_id: Project ID
            workflow_id: Optional workflow ID filter
            runs_to_compare: Number of recent runs to include

        Returns:
            List of coverage data dictionaries for recent runs
        """
        query = select(SoftwareTestRun).filter(
            SoftwareTestRun.project_id == project_id,
            SoftwareTestRun.status == TestRunStatus.COMPLETED,
        )

        if workflow_id:
            query = query.filter(SoftwareTestRun.workflow_id == workflow_id)

        query = query.order_by(SoftwareTestRun.completed_at.desc()).limit(
            runs_to_compare
        )

        result = await db.execute(query)
        runs = result.scalars().all()

        return [
            {
                "run_id": run.id,
                "run_name": run.configuration_snapshot.get("run_name", f"Run {run.id}"),
                "coverage_percentage": float(run.coverage_percentage),
                "unique_paths_found": run.unique_paths_found,
                "total_transitions": run.total_transitions,
                "completed_at": run.completed_at,
                "deficiencies_found": run.deficiencies_found,
            }
            for run in runs
        ]
