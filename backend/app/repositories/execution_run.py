"""
Repository for execution run database operations.

Handles query logic for execution runs, encapsulating database access
and providing reusable methods for listing, filtering, and aggregating
execution data.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.action_execution import ActionExecution, ActionExecutionStatus
from app.models.execution_issue import ExecutionIssue
from app.models.execution_run import ExecutionRun, ExecutionRunStatus, ExecutionRunType

logger = structlog.get_logger(__name__)


class ExecutionRunRepository:
    """Repository for execution run database operations."""

    @staticmethod
    async def list_runs(
        db: AsyncSession,
        project_id: UUID | None = None,
        run_type: ExecutionRunType | None = None,
        status: ExecutionRunStatus | None = None,
        workflow_name: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[ExecutionRun], int]:
        """
        List execution runs with optional filtering.

        Args:
            db: Database session
            project_id: Optional filter by project ID
            run_type: Optional filter by run type
            status: Optional filter by status
            workflow_name: Optional filter by workflow name from workflow_metadata
            start_date: Optional filter by start date (from)
            end_date: Optional filter by start date (to)
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            Tuple of (list of ExecutionRun, total count)
        """
        query = select(ExecutionRun)

        # Apply filters
        if project_id:
            query = query.where(ExecutionRun.project_id == project_id)
        if run_type:
            query = query.where(ExecutionRun.run_type == run_type)
        if status:
            query = query.where(ExecutionRun.status == status)
        if workflow_name:
            # Filter by workflow_name in JSONB workflow_metadata field
            query = query.where(
                ExecutionRun.workflow_metadata["workflow_name"].astext == workflow_name
            )
        if start_date:
            query = query.where(func.date(ExecutionRun.started_at) >= start_date)
        if end_date:
            query = query.where(func.date(ExecutionRun.started_at) <= end_date)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply ordering and pagination
        query = (
            query.order_by(ExecutionRun.started_at.desc()).offset(offset).limit(limit)
        )

        # Execute query
        result = await db.execute(query)
        runs = list(result.scalars().all())

        logger.debug(
            "list_runs_query_executed",
            total=total,
            returned=len(runs),
            project_id=str(project_id) if project_id else None,
        )

        return runs, total

    @staticmethod
    async def get_run_with_details(
        db: AsyncSession,
        run_id: UUID,
    ) -> ExecutionRun | None:
        """
        Get execution run with related data loaded.

        Loads action_executions, screenshots, and issues relationships
        for detailed view.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            ExecutionRun with loaded relationships, or None if not found
        """
        query = (
            select(ExecutionRun)
            .where(ExecutionRun.id == run_id)
            .options(
                selectinload(ExecutionRun.action_executions),
                selectinload(ExecutionRun.screenshots),
                selectinload(ExecutionRun.issues),
            )
        )
        result = await db.execute(query)
        run = result.scalar_one_or_none()

        if run:
            logger.debug(
                "get_run_with_details_executed",
                run_id=str(run_id),
                action_count=len(run.action_executions),
                screenshot_count=len(run.screenshots),
                issue_count=len(run.issues),
            )

        return run

    @staticmethod
    def calculate_run_stats(run: ExecutionRun) -> dict[str, int]:
        """
        Calculate statistics from a run's action executions.

        Args:
            run: ExecutionRun with action_executions loaded

        Returns:
            Dictionary with stats (total_actions, successful_actions,
            failed_actions, skipped_actions, timeout_actions,
            total_screenshots, total_issues, unique_states_visited,
            unique_actions_executed)
        """
        actions = run.action_executions
        screenshots = run.screenshots
        issues = run.issues

        return {
            "total_actions": len(actions),
            "successful_actions": sum(
                1 for a in actions if a.status == ActionExecutionStatus.SUCCESS
            ),
            "failed_actions": sum(
                1 for a in actions if a.status == ActionExecutionStatus.FAILED
            ),
            "skipped_actions": sum(
                1 for a in actions if a.status == ActionExecutionStatus.SKIPPED
            ),
            "timeout_actions": sum(
                1 for a in actions if a.status == ActionExecutionStatus.TIMEOUT
            ),
            "total_screenshots": len(screenshots),
            "total_issues": len(issues),
            "unique_states_visited": len(
                {a.from_state for a in actions if a.from_state}
            ),
            "unique_actions_executed": len({a.action_type for a in actions}),
        }

    @staticmethod
    async def list_unique_workflows(
        db: AsyncSession,
        project_id: UUID,
    ) -> list[dict[str, Any]]:
        """
        Get unique workflows from execution runs for a project.

        Args:
            db: Database session
            project_id: Project ID to filter by

        Returns:
            List of dicts with workflow_id, workflow_name, run_count, last_run_at
        """
        # Get all runs for the project that have workflow metadata
        query = select(ExecutionRun).where(
            ExecutionRun.project_id == project_id,
            ExecutionRun.workflow_metadata.isnot(None),
        )
        result = await db.execute(query)
        runs = result.scalars().all()

        # Extract unique workflows
        workflows: dict[str, dict[str, Any]] = {}
        for run in runs:
            if run.workflow_metadata:
                workflow_name = run.workflow_metadata.get("workflow_name")
                workflow_id = run.workflow_metadata.get("workflow_id")
                if workflow_name:
                    key = workflow_id or workflow_name
                    if key not in workflows:
                        workflows[key] = {
                            "workflow_id": workflow_id,
                            "workflow_name": workflow_name,
                            "run_count": 0,
                            "last_run_at": None,
                        }
                    workflows[key]["run_count"] += 1
                    if (
                        workflows[key]["last_run_at"] is None
                        or run.started_at > workflows[key]["last_run_at"]
                    ):
                        workflows[key]["last_run_at"] = run.started_at

        # Sort by last_run_at descending
        sorted_workflows = sorted(
            workflows.values(),
            key=lambda w: w["last_run_at"] or datetime.min,
            reverse=True,
        )

        # Convert datetime to ISO string for JSON serialization
        for workflow in sorted_workflows:
            if workflow["last_run_at"] is not None:
                workflow["last_run_at"] = workflow["last_run_at"].isoformat()

        logger.debug(
            "list_unique_workflows_executed",
            project_id=str(project_id),
            workflow_count=len(sorted_workflows),
        )

        return sorted_workflows

    @staticmethod
    async def get_execution_trends(
        db: AsyncSession,
        project_id: UUID,
        run_type: ExecutionRunType | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict[str, Any]]:
        """
        Get execution runs grouped by date for trend analysis.

        Args:
            db: Database session
            project_id: Project ID to filter by
            run_type: Optional filter by run type
            start_date: Start date for range
            end_date: End date for range

        Returns:
            List of daily data points with date, runs_count, success_rate,
            avg_duration_seconds, total_actions, issues_count
        """
        # Build query
        query = select(ExecutionRun).where(ExecutionRun.project_id == project_id)

        if start_date:
            query = query.where(func.date(ExecutionRun.started_at) >= start_date)
        if end_date:
            query = query.where(func.date(ExecutionRun.started_at) <= end_date)
        if run_type:
            query = query.where(ExecutionRun.run_type == run_type)

        result = await db.execute(query)
        runs = result.scalars().all()

        # Group by date
        daily_data: dict[str, list[ExecutionRun]] = defaultdict(list)
        for r in runs:
            day = r.started_at.date().isoformat()
            daily_data[day].append(r)

        # Build data points
        data_points: list[dict[str, Any]] = []
        for day_str, day_runs in sorted(daily_data.items()):
            completed = [
                r
                for r in day_runs
                if r.status in [ExecutionRunStatus.COMPLETED, ExecutionRunStatus.FAILED]
            ]
            successful = [
                r for r in completed if r.status == ExecutionRunStatus.COMPLETED
            ]
            success_rate = len(successful) / len(completed) * 100 if completed else 0

            # Get action and issue counts for these runs
            run_ids = [r.id for r in day_runs]
            action_count_query = select(func.count()).where(
                ActionExecution.run_id.in_(run_ids)
            )
            action_count_result = await db.execute(action_count_query)
            total_actions = action_count_result.scalar() or 0

            issue_count_query = select(func.count()).where(
                ExecutionIssue.run_id.in_(run_ids)
            )
            issue_count_result = await db.execute(issue_count_query)
            total_issues = issue_count_result.scalar() or 0

            durations = [r.duration_seconds for r in day_runs if r.duration_seconds]
            avg_duration = sum(durations) // len(durations) if durations else 0

            data_points.append(
                {
                    "date": day_str,
                    "runs_count": len(day_runs),
                    "success_rate": round(success_rate, 2),
                    "avg_duration_seconds": avg_duration,
                    "total_actions": total_actions,
                    "issues_count": total_issues,
                }
            )

        logger.debug(
            "get_execution_trends_executed",
            project_id=str(project_id),
            data_point_count=len(data_points),
        )

        return data_points

    @staticmethod
    async def get_reliability_stats(
        db: AsyncSession,
        project_id: UUID,
        run_type: ExecutionRunType | None = None,
        days: int = 30,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """
        Get action reliability statistics for identifying flaky tests.

        Args:
            db: Database session
            project_id: Project ID to filter by
            run_type: Optional filter by run type
            days: Number of days to analyze
            limit: Maximum number of actions to return

        Returns:
            List of dicts with action_name, action_type, total_executions,
            successful_executions, failed_executions, success_rate,
            avg_duration_ms, p50_duration_ms, p95_duration_ms, common_errors
        """
        from qontinui_schemas.common import utc_now

        cutoff = utc_now() - timedelta(days=days)

        # Get runs in time range
        run_query = select(ExecutionRun.id).where(
            ExecutionRun.project_id == project_id,
            ExecutionRun.started_at >= cutoff,
        )
        if run_type:
            run_query = run_query.where(ExecutionRun.run_type == run_type)

        run_result = await db.execute(run_query)
        run_ids = list(run_result.scalars().all())

        if not run_ids:
            return []

        # Get all actions for these runs
        action_query = select(ActionExecution).where(
            ActionExecution.run_id.in_(run_ids)
        )
        action_result = await db.execute(action_query)
        actions = action_result.scalars().all()

        # Aggregate stats by action name
        action_stats: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "action_name": "",
                "action_type": None,
                "total": 0,
                "successful": 0,
                "failed": 0,
                "durations": [],
                "errors": defaultdict(int),
            }
        )

        for action in actions:
            key = action.action_name
            stats = action_stats[key]
            stats["action_name"] = action.action_name
            stats["action_type"] = action.action_type
            stats["total"] += 1
            if action.duration_ms:
                stats["durations"].append(action.duration_ms)

            if action.status == ActionExecutionStatus.SUCCESS:
                stats["successful"] += 1
            elif action.status in [
                ActionExecutionStatus.FAILED,
                ActionExecutionStatus.ERROR,
            ]:
                stats["failed"] += 1
                if action.error_message:
                    stats["errors"][action.error_message[:100]] += 1

        # Build response
        result_list: list[dict[str, Any]] = []
        for _key, stats in action_stats.items():
            if stats["total"] == 0:
                continue

            durations = sorted(stats["durations"]) if stats["durations"] else [0]
            p50_idx = len(durations) // 2
            p95_idx = int(len(durations) * 0.95)

            common_errors = [
                {
                    "error_type": err,
                    "count": count,
                    "percentage": (
                        round(count / stats["failed"] * 100, 2)
                        if stats["failed"] > 0
                        else 0
                    ),
                }
                for err, count in sorted(stats["errors"].items(), key=lambda x: -x[1])[
                    :5
                ]
            ]

            action_type_value = stats["action_type"]
            if hasattr(action_type_value, "value"):
                action_type_value = action_type_value.value

            result_list.append(
                {
                    "action_name": stats["action_name"],
                    "action_type": action_type_value,
                    "total_executions": stats["total"],
                    "successful_executions": stats["successful"],
                    "failed_executions": stats["failed"],
                    "success_rate": round(
                        stats["successful"] / stats["total"] * 100, 2
                    ),
                    "avg_duration_ms": (
                        sum(durations) // len(durations) if durations else 0
                    ),
                    "p50_duration_ms": (
                        durations[p50_idx]
                        if durations and p50_idx < len(durations)
                        else 0
                    ),
                    "p95_duration_ms": (
                        durations[p95_idx]
                        if durations and p95_idx < len(durations)
                        else (durations[-1] if durations else 0)
                    ),
                    "common_errors": common_errors,
                }
            )

        # Sort by failure rate descending (lowest success rate first)
        result_list.sort(key=lambda x: x["success_rate"])

        logger.debug(
            "get_reliability_stats_executed",
            project_id=str(project_id),
            action_count=len(result_list[:limit]),
        )

        return result_list[:limit]

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        run_id: UUID,
    ) -> ExecutionRun | None:
        """
        Get execution run by ID.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            ExecutionRun or None if not found
        """
        query = select(ExecutionRun).where(ExecutionRun.id == run_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_cost_trend_data(
        db: AsyncSession,
        project_id: UUID,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict[str, Any]]:
        """
        Get execution runs with their action executions for cost trend analysis.

        Returns run IDs grouped by date, along with all associated actions
        so callers can extract LLM metrics from extra_metadata.

        Args:
            db: Database session
            project_id: Project ID to filter by
            start_date: Start date for range
            end_date: End date for range

        Returns:
            List of dicts with run date info and associated action executions
        """
        # Get runs in range
        query = select(ExecutionRun).where(ExecutionRun.project_id == project_id)

        if start_date:
            query = query.where(func.date(ExecutionRun.started_at) >= start_date)
        if end_date:
            query = query.where(func.date(ExecutionRun.started_at) <= end_date)

        result = await db.execute(query)
        runs = result.scalars().all()

        if not runs:
            return []

        # Group runs by date
        daily_runs: dict[str, list[ExecutionRun]] = defaultdict(list)
        for r in runs:
            day = r.started_at.date().isoformat()
            daily_runs[day].append(r)

        # For each day, fetch all actions
        data_points: list[dict[str, Any]] = []
        for day_str, day_runs in sorted(daily_runs.items()):
            run_ids = [r.id for r in day_runs]

            action_query = select(ActionExecution).where(
                ActionExecution.run_id.in_(run_ids)
            )
            action_result = await db.execute(action_query)
            actions = list(action_result.scalars().all())

            data_points.append(
                {
                    "date": day_str,
                    "runs_count": len(day_runs),
                    "actions": actions,
                }
            )

        logger.debug(
            "get_cost_trend_data_executed",
            project_id=str(project_id),
            data_point_count=len(data_points),
        )

        return data_points
