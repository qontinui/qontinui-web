"""
Repository for action execution database operations.

Handles query logic for action executions, encapsulating database access
and providing reusable methods for listing, filtering, and batch operations.
"""

from uuid import UUID

import structlog
from app.models.action_execution import (ActionExecution,
                                         ActionExecutionStatus,
                                         ActionExecutionType)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ActionExecutionRepository:
    """Repository for action execution database operations."""

    @staticmethod
    async def list_for_run(
        db: AsyncSession,
        run_id: UUID,
        action_type: ActionExecutionType | None = None,
        status: ActionExecutionStatus | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[list[ActionExecution], int]:
        """
        List action executions for a run with optional filtering.

        Args:
            db: Database session
            run_id: ID of the execution run
            action_type: Optional filter by action type
            status: Optional filter by status
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            Tuple of (list of ActionExecution, total count)
        """
        # Build query
        query = select(ActionExecution).where(ActionExecution.run_id == run_id)

        if action_type:
            query = query.where(ActionExecution.action_type == action_type)
        if status:
            query = query.where(ActionExecution.status == status)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply ordering and pagination
        query = (
            query.order_by(ActionExecution.sequence_number).offset(offset).limit(limit)
        )

        result = await db.execute(query)
        actions = list(result.scalars().all())

        logger.debug(
            "list_for_run_executed",
            run_id=str(run_id),
            total=total,
            returned=len(actions),
        )

        return actions, total

    @staticmethod
    async def get_all_for_run(
        db: AsyncSession,
        run_id: UUID,
    ) -> list[ActionExecution]:
        """
        Get all action executions for a run (no pagination).

        Used for aggregation operations like cost summaries where
        all actions must be inspected.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            List of all ActionExecution records for the run
        """
        query = (
            select(ActionExecution)
            .where(ActionExecution.run_id == run_id)
            .order_by(ActionExecution.sequence_number)
        )
        result = await db.execute(query)
        actions = list(result.scalars().all())

        logger.debug(
            "get_all_for_run_executed",
            run_id=str(run_id),
            total=len(actions),
        )

        return actions

    @staticmethod
    async def batch_create(
        db: AsyncSession,
        run_id: UUID,
        actions_data: list[dict],
    ) -> list[UUID]:
        """
        Create multiple action executions efficiently.

        Args:
            db: Database session
            run_id: ID of the execution run
            actions_data: List of dictionaries with action data.
                Each dict should contain:
                - sequence_number: int
                - action_type: ActionExecutionType
                - action_name: str
                - status: ActionExecutionStatus
                - started_at: datetime
                - completed_at: datetime | None
                - duration_ms: int | None
                - from_state: str | None
                - to_state: str | None
                - actual_state: str | None
                - input_data: dict
                - output_data: dict
                - error_message: str | None
                - error_type: str | None
                - extra_metadata: dict

        Returns:
            List of created action IDs
        """
        action_ids: list[UUID] = []

        for action_data in actions_data:
            action = ActionExecution(
                run_id=run_id,
                sequence_number=action_data["sequence_number"],
                action_type=action_data["action_type"],
                action_name=action_data["action_name"],
                status=action_data["status"],
                started_at=action_data["started_at"],
                completed_at=action_data.get("completed_at"),
                duration_ms=action_data.get("duration_ms"),
                from_state=action_data.get("from_state"),
                to_state=action_data.get("to_state"),
                actual_state=action_data.get("actual_state"),
                input_data=action_data.get("input_data", {}),
                output_data=action_data.get("output_data", {}),
                error_message=action_data.get("error_message"),
                error_type=action_data.get("error_type"),
                extra_metadata=action_data.get("extra_metadata", {}),
            )
            db.add(action)
            await db.flush()  # Get the ID
            action_ids.append(action.id)

        await db.commit()

        logger.info(
            "batch_create_executed",
            run_id=str(run_id),
            action_count=len(action_ids),
        )

        return action_ids

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        action_id: UUID,
    ) -> ActionExecution | None:
        """
        Get action execution by ID.

        Args:
            db: Database session
            action_id: ID of the action execution

        Returns:
            ActionExecution or None if not found
        """
        query = select(ActionExecution).where(ActionExecution.id == action_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_by_run_and_sequence(
        db: AsyncSession,
        run_id: UUID,
        sequence_number: int,
    ) -> ActionExecution | None:
        """
        Get action execution by run ID and sequence number.

        Args:
            db: Database session
            run_id: ID of the execution run
            sequence_number: Sequence number of the action

        Returns:
            ActionExecution or None if not found
        """
        query = select(ActionExecution).where(
            ActionExecution.run_id == run_id,
            ActionExecution.sequence_number == sequence_number,
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def count_by_status(
        db: AsyncSession,
        run_id: UUID,
    ) -> dict[str, int]:
        """
        Count actions by status for a run.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            Dictionary mapping status values to counts
        """
        query = select(ActionExecution).where(ActionExecution.run_id == run_id)
        result = await db.execute(query)
        actions = result.scalars().all()

        status_counts: dict[str, int] = {}
        for status_enum in ActionExecutionStatus:
            status_counts[status_enum.value] = sum(
                1 for a in actions if a.status == status_enum
            )

        return status_counts
