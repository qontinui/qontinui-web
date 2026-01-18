"""
Service for execution run business logic.

Handles run creation, completion, action reporting, analytics,
and response mapping. Separates business logic from HTTP handling.
"""

import json
from datetime import date
from typing import Any
from uuid import UUID

import structlog

# Import schemas from qontinui-schemas
from qontinui_schemas.api.execution import (
    ActionExecutionBatch,
    ActionExecutionBatchResponse,
    ActionExecutionListResponse,
    ActionExecutionResponse,
    ActionReliabilityStats,
    ActionStatus,
    ActionType,
    CoverageData,
    ExecutionRunComplete,
    ExecutionRunCompleteResponse,
    ExecutionRunCreate,
    ExecutionRunDetail,
    ExecutionRunListResponse,
    ExecutionRunResponse,
    ExecutionStats,
    ExecutionTrendDataPoint,
    ExecutionTrendResponse,
    ExecutionWorkflowMetadata,
    Pagination,
    RunnerMetadata,
    RunStatus,
    RunType,
)
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_config import get_redis
from app.models.action_execution import (
    ActionExecution,
    ActionExecutionStatus,
    ActionExecutionType,
)
from app.models.execution_run import ExecutionRun, ExecutionRunStatus, ExecutionRunType
from app.repositories.action_execution import ActionExecutionRepository
from app.repositories.execution_run import ExecutionRunRepository

logger = structlog.get_logger(__name__)


# =============================================================================
# Type Mapping Functions
# =============================================================================


def _map_run_type_to_model(run_type: RunType) -> ExecutionRunType:
    """Map schema RunType to model ExecutionRunType."""
    mapping = {
        RunType.QA_TEST: ExecutionRunType.QA_TEST,
        RunType.INTEGRATION_TEST: ExecutionRunType.INTEGRATION_TEST,
        RunType.LIVE_AUTOMATION: ExecutionRunType.LIVE_AUTOMATION,
        RunType.RECORDING: ExecutionRunType.RECORDING,
        RunType.DEBUG: ExecutionRunType.DEBUG,
    }
    return mapping.get(run_type, ExecutionRunType.LIVE_AUTOMATION)


def _map_run_status_to_model(run_status: RunStatus) -> ExecutionRunStatus:
    """Map schema RunStatus to model ExecutionRunStatus."""
    mapping = {
        RunStatus.PENDING: ExecutionRunStatus.PENDING,
        RunStatus.RUNNING: ExecutionRunStatus.RUNNING,
        RunStatus.COMPLETED: ExecutionRunStatus.COMPLETED,
        RunStatus.FAILED: ExecutionRunStatus.FAILED,
        RunStatus.TIMEOUT: ExecutionRunStatus.TIMEOUT,
        RunStatus.CANCELLED: ExecutionRunStatus.CANCELLED,
        RunStatus.PAUSED: ExecutionRunStatus.PAUSED,
    }
    return mapping.get(run_status, ExecutionRunStatus.RUNNING)


def _map_action_type_to_model(action_type: ActionType) -> ActionExecutionType:
    """Map schema ActionType to model ActionExecutionType."""
    mapping = {
        ActionType.FIND: ActionExecutionType.FIND,
        ActionType.CLICK: ActionExecutionType.CLICK,
        ActionType.DOUBLE_CLICK: ActionExecutionType.DOUBLE_CLICK,
        ActionType.RIGHT_CLICK: ActionExecutionType.RIGHT_CLICK,
        ActionType.TYPE: ActionExecutionType.TYPE,
        ActionType.KEY_PRESS: ActionExecutionType.KEY_PRESS,
        ActionType.SCROLL: ActionExecutionType.SCROLL,
        ActionType.DRAG: ActionExecutionType.DRAG,
        ActionType.GO_TO_STATE: ActionExecutionType.GO_TO_STATE,
        ActionType.CUSTOM: ActionExecutionType.CUSTOM,
    }
    return mapping.get(action_type, ActionExecutionType.CUSTOM)


def _map_action_status_to_model(action_status: ActionStatus) -> ActionExecutionStatus:
    """Map schema ActionStatus to model ActionExecutionStatus."""
    mapping = {
        ActionStatus.SUCCESS: ActionExecutionStatus.SUCCESS,
        ActionStatus.FAILED: ActionExecutionStatus.FAILED,
        ActionStatus.TIMEOUT: ActionExecutionStatus.TIMEOUT,
        ActionStatus.SKIPPED: ActionExecutionStatus.SKIPPED,
        ActionStatus.ERROR: ActionExecutionStatus.ERROR,
        ActionStatus.PENDING: ActionExecutionStatus.PENDING,
    }
    return mapping.get(action_status, ActionExecutionStatus.PENDING)


# =============================================================================
# Response Mapping Functions
# =============================================================================


def model_to_run_response(run: ExecutionRun) -> ExecutionRunResponse:
    """Convert ExecutionRun model to ExecutionRunResponse schema."""
    return ExecutionRunResponse(
        id=run.id,
        project_id=run.project_id,
        run_type=RunType(
            run.run_type.value if hasattr(run.run_type, "value") else run.run_type
        ),
        run_name=run.run_name,
        status=RunStatus(
            run.status.value if hasattr(run.status, "value") else run.status
        ),
        started_at=run.started_at,
        ended_at=run.ended_at,
        duration_seconds=run.duration_seconds,
        runner_metadata=(
            RunnerMetadata(**run.runner_metadata)
            if run.runner_metadata
            else RunnerMetadata(
                runner_version="unknown",
                os="unknown",
                hostname="unknown",
                screen_resolution=None,
                python_version=None,
            )
        ),
        workflow_metadata=(
            ExecutionWorkflowMetadata(**run.workflow_metadata)
            if run.workflow_metadata
            else None
        ),
        created_at=run.created_at,
    )


def model_to_action_response(action: ActionExecution) -> ActionExecutionResponse:
    """Convert ActionExecution model to ActionExecutionResponse schema."""
    return ActionExecutionResponse(
        id=action.id,
        run_id=action.run_id,
        sequence_number=action.sequence_number,
        action_type=ActionType(
            action.action_type.value
            if hasattr(action.action_type, "value")
            else action.action_type
        ),
        action_name=action.action_name,
        status=ActionStatus(
            action.status.value if hasattr(action.status, "value") else action.status
        ),
        started_at=action.started_at,
        completed_at=action.completed_at or action.started_at,
        duration_ms=action.duration_ms or 0,
        from_state=action.from_state,
        to_state=action.to_state,
        error_message=action.error_message,
    )


# =============================================================================
# Service Class
# =============================================================================


class ExecutionRunService:
    """Service for execution run operations."""

    def __init__(
        self,
        run_repo: ExecutionRunRepository,
        action_repo: ActionExecutionRepository,
    ) -> None:
        """Initialize with repositories."""
        self.run_repo = run_repo
        self.action_repo = action_repo

    async def create_run(
        self,
        db: AsyncSession,
        run_data: ExecutionRunCreate,
        user_id: UUID,
    ) -> ExecutionRunResponse:
        """
        Create a new execution run.

        Args:
            db: Database session
            run_data: Run creation data
            user_id: ID of the user creating the run

        Returns:
            Created ExecutionRunResponse
        """
        now = utc_now()

        logger.info(
            "create_run_timestamp",
            now_str=str(now),
            now_repr=repr(now),
            now_iso=now.isoformat(),
            tzinfo=str(now.tzinfo),
        )

        # Ensure workflow_metadata includes initial_state_ids
        if run_data.workflow_metadata:
            wm_dict = run_data.workflow_metadata.model_dump()
            if (
                "initial_state_ids" not in wm_dict
                or wm_dict.get("initial_state_ids") is None
            ):
                wm_dict["initial_state_ids"] = (
                    run_data.workflow_metadata.initial_state_ids or []
                )
        else:
            wm_dict = None

        run = ExecutionRun(
            project_id=run_data.project_id,
            created_by_user_id=user_id,
            run_type=_map_run_type_to_model(run_data.run_type),
            run_name=run_data.run_name,
            description=run_data.description,
            status=ExecutionRunStatus.RUNNING,
            started_at=now,
            runner_metadata=run_data.runner_metadata.model_dump(),
            workflow_metadata=wm_dict,
            configuration=run_data.configuration or {},
            max_duration_seconds=run_data.max_duration_seconds,
        )

        db.add(run)
        await db.commit()
        await db.refresh(run)

        logger.info(
            "Created execution run",
            run_id=str(run.id),
            run_name=run_data.run_name,
            run_type=run_data.run_type.value,
            project_id=str(run_data.project_id),
            user_id=str(user_id),
        )

        # Broadcast session_start event to Redis
        await self._broadcast_session_start(user_id, run, run_data, wm_dict or {}, now)

        return model_to_run_response(run)

    async def _broadcast_session_start(
        self,
        user_id: UUID,
        run: ExecutionRun,
        run_data: ExecutionRunCreate,
        wm_dict: dict[str, Any],
        now: Any,
    ) -> None:
        """Broadcast session_start event to Redis for Live Monitor."""
        try:
            redis_client = await get_redis()
            runner_meta = run_data.runner_metadata.model_dump()
            session_start_event = {
                "type": "session_start",
                "session_id": str(run.id),
                "project_id": str(run_data.project_id),
                "runner_version": runner_meta.get("runner_version"),
                "runner_os": runner_meta.get("runner_os"),
                "runner_hostname": runner_meta.get("runner_hostname"),
                "workflow_name": wm_dict.get("workflow_name"),
                "run_name": run_data.run_name,
                "run_type": run_data.run_type.value,
                "timestamp": now.isoformat(),
            }
            channel = f"runner:status:updates:{user_id}"
            await redis_client.publish(channel, json.dumps(session_start_event))
            logger.info(
                "session_start_broadcast",
                user_id=str(user_id),
                run_id=str(run.id),
                channel=channel,
            )
        except Exception as e:
            logger.error("session_start_broadcast_failed", error=str(e))

    async def list_runs(
        self,
        db: AsyncSession,
        project_id: UUID | None = None,
        run_type: RunType | None = None,
        status_filter: RunStatus | None = None,
        workflow_name: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> ExecutionRunListResponse:
        """
        List execution runs with optional filtering.

        Args:
            db: Database session
            project_id: Optional filter by project ID
            run_type: Optional filter by run type
            status_filter: Optional filter by status
            workflow_name: Optional filter by workflow name
            start_date: Optional filter by start date (from)
            end_date: Optional filter by start date (to)
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            ExecutionRunListResponse with runs and pagination
        """
        runs, total = await self.run_repo.list_runs(
            db,
            project_id=project_id,
            run_type=_map_run_type_to_model(run_type) if run_type else None,
            status=_map_run_status_to_model(status_filter) if status_filter else None,
            workflow_name=workflow_name,
            start_date=start_date,
            end_date=end_date,
            offset=offset,
            limit=limit,
        )

        return ExecutionRunListResponse(
            runs=[model_to_run_response(r) for r in runs],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=offset + limit < total,
            ),
        )

    async def get_run_detail(
        self,
        db: AsyncSession,
        run_id: UUID,
    ) -> ExecutionRunDetail | None:
        """
        Get detailed execution run information.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            ExecutionRunDetail or None if not found
        """
        run = await self.run_repo.get_run_with_details(db, run_id)
        if not run:
            return None

        # Calculate stats using repository helper
        stats_dict = self.run_repo.calculate_run_stats(run)
        stats = ExecutionStats(**stats_dict)

        return ExecutionRunDetail(
            id=run.id,
            project_id=run.project_id,
            run_type=RunType(
                run.run_type.value if hasattr(run.run_type, "value") else run.run_type
            ),
            run_name=run.run_name,
            status=RunStatus(
                run.status.value if hasattr(run.status, "value") else run.status
            ),
            started_at=run.started_at,
            ended_at=run.ended_at,
            duration_seconds=run.duration_seconds,
            runner_metadata=(
                RunnerMetadata(**run.runner_metadata)
                if run.runner_metadata
                else RunnerMetadata(
                    runner_version="unknown",
                    os="unknown",
                    hostname="unknown",
                    screen_resolution=None,
                    python_version=None,
                )
            ),
            workflow_metadata=(
                ExecutionWorkflowMetadata(**run.workflow_metadata)
                if run.workflow_metadata
                else None
            ),
            created_at=run.created_at,
            description=run.description,
            configuration=run.configuration or {},
            stats=stats,
            coverage=(
                CoverageData(**run.coverage_data)
                if run.coverage_data
                else None
            ),
            updated_at=run.updated_at,
        )

    async def complete_run(
        self,
        db: AsyncSession,
        run_id: UUID,
        complete_data: ExecutionRunComplete,
        user_id: UUID,
    ) -> ExecutionRunCompleteResponse | None:
        """
        Complete an execution run.

        Args:
            db: Database session
            run_id: ID of the execution run
            complete_data: Completion data
            user_id: ID of the user completing the run

        Returns:
            ExecutionRunCompleteResponse or None if not found
        """
        run = await self.run_repo.get_by_id(db, run_id)
        if not run:
            return None

        # Calculate duration
        duration_seconds = int(
            (complete_data.ended_at - run.started_at).total_seconds()
        )

        # Update run
        run.status = _map_run_status_to_model(complete_data.status)
        run.ended_at = complete_data.ended_at
        run.duration_seconds = duration_seconds
        run.stats = complete_data.stats.model_dump()
        run.coverage_data = (
            complete_data.coverage.model_dump() if complete_data.coverage else None
        )
        run.error_message = complete_data.error_message
        run.updated_at = utc_now()

        await db.commit()
        await db.refresh(run)

        logger.info(
            "Completed execution run",
            run_id=str(run_id),
            status=complete_data.status.value,
            duration_seconds=duration_seconds,
            user_id=str(user_id),
        )

        # Broadcast session_end event to Redis
        await self._broadcast_session_end(
            user_id, run_id, complete_data, duration_seconds
        )

        return ExecutionRunCompleteResponse(
            id=run_id,
            status=complete_data.status,
            started_at=run.started_at,
            ended_at=complete_data.ended_at,
            duration_seconds=duration_seconds,
            stats=complete_data.stats,
        )

    async def _broadcast_session_end(
        self,
        user_id: UUID,
        run_id: UUID,
        complete_data: ExecutionRunComplete,
        duration_seconds: int,
    ) -> None:
        """Broadcast session_end event to Redis for Live Monitor."""
        try:
            redis_client = await get_redis()
            session_end_event = {
                "type": "session_end",
                "session_id": str(run_id),
                "status": complete_data.status.value,
                "error_message": complete_data.error_message,
                "duration_seconds": duration_seconds,
                "timestamp": complete_data.ended_at.isoformat(),
            }
            channel = f"runner:status:updates:{user_id}"
            await redis_client.publish(channel, json.dumps(session_end_event))
            logger.info(
                "session_end_broadcast",
                user_id=str(user_id),
                run_id=str(run_id),
                channel=channel,
            )
        except Exception as e:
            logger.error("session_end_broadcast_failed", error=str(e))

    async def cancel_or_delete_run(
        self,
        db: AsyncSession,
        run_id: UUID,
        user_id: UUID,
    ) -> bool:
        """
        Cancel a running execution or delete a completed run.

        Args:
            db: Database session
            run_id: ID of the execution run
            user_id: ID of the user performing the action

        Returns:
            True if run was found and processed, False if not found
        """
        run = await self.run_repo.get_by_id(db, run_id)
        if not run:
            return False

        if run.status == ExecutionRunStatus.RUNNING:
            run.status = ExecutionRunStatus.CANCELLED
            run.ended_at = utc_now()
            run.duration_seconds = int((run.ended_at - run.started_at).total_seconds())
            await db.commit()
            logger.info(
                "Cancelled execution run", run_id=str(run_id), user_id=str(user_id)
            )
        else:
            await db.delete(run)
            await db.commit()
            logger.info(
                "Deleted execution run", run_id=str(run_id), user_id=str(user_id)
            )

        return True

    async def list_workflows(
        self,
        db: AsyncSession,
        project_id: UUID,
    ) -> list[dict[str, Any]]:
        """
        Get unique workflows from execution runs for a project.

        Args:
            db: Database session
            project_id: Project ID to filter by

        Returns:
            List of workflow dicts with run counts
        """
        return await self.run_repo.list_unique_workflows(db, project_id)

    async def report_actions(
        self,
        db: AsyncSession,
        run_id: UUID,
        batch: ActionExecutionBatch,
    ) -> ActionExecutionBatchResponse:
        """
        Report a batch of action executions for a run.

        Args:
            db: Database session
            run_id: ID of the execution run
            batch: Batch of actions to report

        Returns:
            ActionExecutionBatchResponse with created action IDs
        """
        action_ids: list[UUID] = []

        for action_data in batch.actions:
            action = ActionExecution(
                run_id=run_id,
                sequence_number=action_data.sequence_number,
                action_type=_map_action_type_to_model(action_data.action_type),
                action_name=action_data.action_name,
                status=_map_action_status_to_model(action_data.status),
                started_at=action_data.started_at,
                completed_at=action_data.completed_at,
                duration_ms=action_data.duration_ms,
                from_state=action_data.from_state,
                to_state=action_data.to_state,
                actual_state=action_data.actual_state,
                input_data=action_data.input_data or {},
                output_data=action_data.output_data or {},
                error_message=action_data.error_message,
                error_type=action_data.error_type,
                extra_metadata=action_data.metadata or {},
            )
            db.add(action)
            await db.flush()
            action_ids.append(action.id)

        await db.commit()

        logger.info(
            "Reported action executions",
            run_id=str(run_id),
            action_count=len(batch.actions),
        )

        return ActionExecutionBatchResponse(
            run_id=run_id,
            actions_recorded=len(batch.actions),
            action_ids=action_ids,
        )

    async def list_actions(
        self,
        db: AsyncSession,
        run_id: UUID,
        action_type: ActionType | None = None,
        status_filter: ActionStatus | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> ActionExecutionListResponse:
        """
        List action executions for a run.

        Args:
            db: Database session
            run_id: ID of the execution run
            action_type: Optional filter by action type
            status_filter: Optional filter by status
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            ActionExecutionListResponse with actions and pagination
        """
        actions, total = await self.action_repo.list_for_run(
            db,
            run_id=run_id,
            action_type=(
                _map_action_type_to_model(action_type) if action_type else None
            ),
            status=(
                _map_action_status_to_model(status_filter) if status_filter else None
            ),
            offset=offset,
            limit=limit,
        )

        return ActionExecutionListResponse(
            actions=[model_to_action_response(a) for a in actions],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=offset + limit < total,
            ),
        )

    async def get_execution_trends(
        self,
        db: AsyncSession,
        project_id: UUID,
        run_type: RunType | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        granularity: str = "daily",
    ) -> ExecutionTrendResponse:
        """
        Get execution trend data for analytics.

        Args:
            db: Database session
            project_id: Project ID to filter by
            run_type: Optional filter by run type
            start_date: Start date for range
            end_date: End date for range
            granularity: Granularity (daily, weekly, monthly)

        Returns:
            ExecutionTrendResponse with trend data
        """
        data_points_raw = await self.run_repo.get_execution_trends(
            db,
            project_id=project_id,
            run_type=_map_run_type_to_model(run_type) if run_type else None,
            start_date=start_date,
            end_date=end_date,
        )

        # Convert to response schema
        data_points = [ExecutionTrendDataPoint(**dp) for dp in data_points_raw]

        # Calculate overall stats
        total_runs = sum(dp.runs_count for dp in data_points)
        total_actions = sum(dp.total_actions for dp in data_points)
        total_issues = sum(dp.issues_count for dp in data_points)

        # Calculate weighted success rate
        if data_points:
            weighted_success = sum(
                dp.success_rate * dp.runs_count
                for dp in data_points
                if dp.runs_count > 0
            )
            total_completed = sum(
                dp.runs_count for dp in data_points if dp.runs_count > 0
            )
            avg_success_rate = (
                round(weighted_success / total_completed, 2) if total_completed else 0
            )
        else:
            avg_success_rate = 0

        overall_stats = {
            "total_runs": total_runs,
            "successful_runs": 0,
            "failed_runs": 0,
            "success_rate": avg_success_rate,
            "avg_success_rate": avg_success_rate,
            "total_actions": total_actions,
            "total_issues": total_issues,
        }

        return ExecutionTrendResponse(
            project_id=project_id,
            run_type=run_type,
            start_date=start_date.isoformat() if start_date else "",
            end_date=end_date.isoformat() if end_date else "",
            granularity=granularity,
            data_points=data_points,
            overall_stats=overall_stats,
        )

    async def get_reliability_stats(
        self,
        db: AsyncSession,
        project_id: UUID,
        run_type: RunType | None = None,
        days: int = 30,
        limit: int = 20,
    ) -> list[ActionReliabilityStats]:
        """
        Get action reliability statistics.

        Args:
            db: Database session
            project_id: Project ID to filter by
            run_type: Optional filter by run type
            days: Number of days to analyze
            limit: Maximum number of actions to return

        Returns:
            List of ActionReliabilityStats
        """
        stats_raw = await self.run_repo.get_reliability_stats(
            db,
            project_id=project_id,
            run_type=_map_run_type_to_model(run_type) if run_type else None,
            days=days,
            limit=limit,
        )

        result_list: list[ActionReliabilityStats] = []
        for stat in stats_raw:
            action_type_value = stat["action_type"]
            result_list.append(
                ActionReliabilityStats(
                    action_name=stat["action_name"],
                    action_type=(
                        ActionType(action_type_value)
                        if action_type_value
                        else ActionType.CUSTOM
                    ),
                    total_executions=stat["total_executions"],
                    successful_executions=stat["successful_executions"],
                    failed_executions=stat["failed_executions"],
                    success_rate=stat["success_rate"],
                    avg_duration_ms=stat["avg_duration_ms"],
                    p50_duration_ms=stat["p50_duration_ms"],
                    p95_duration_ms=stat["p95_duration_ms"],
                    common_errors=stat["common_errors"],
                )
            )

        return result_list
