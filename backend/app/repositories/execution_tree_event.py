"""
Repository for execution tree event database operations.

Handles query logic for execution tree events, encapsulating database access
and providing reusable methods for listing, filtering, and tree reconstruction.
"""

from uuid import UUID

import structlog
from app.models.execution_tree_event import ExecutionTreeEvent
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ExecutionTreeEventRepository:
    """Repository for execution tree event database operations."""

    @staticmethod
    async def list_for_run(
        db: AsyncSession,
        run_id: UUID,
        event_type: str | None = None,
        node_type: str | None = None,
        offset: int = 0,
        limit: int = 500,
    ) -> tuple[list[ExecutionTreeEvent], int]:
        """
        List tree events for a run with optional filtering.

        Args:
            db: Database session
            run_id: ID of the execution run
            event_type: Optional filter by event type
            node_type: Optional filter by node type
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            Tuple of (list of ExecutionTreeEvent ordered by sequence, total count)
        """
        query = select(ExecutionTreeEvent).where(ExecutionTreeEvent.run_id == run_id)

        if event_type:
            query = query.where(ExecutionTreeEvent.event_type == event_type)
        if node_type:
            query = query.where(ExecutionTreeEvent.node_type == node_type)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply ordering and pagination
        query = query.order_by(ExecutionTreeEvent.sequence).offset(offset).limit(limit)

        result = await db.execute(query)
        events = list(result.scalars().all())

        logger.debug(
            "list_for_run_executed",
            run_id=str(run_id),
            total=total,
            returned=len(events),
        )

        return events, total

    @staticmethod
    async def get_all_for_run(
        db: AsyncSession,
        run_id: UUID,
    ) -> list[ExecutionTreeEvent]:
        """
        Get all tree events for a run ordered by sequence.

        Used for tree reconstruction where we need all events.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            List of all ExecutionTreeEvent ordered by sequence
        """
        query = (
            select(ExecutionTreeEvent)
            .where(ExecutionTreeEvent.run_id == run_id)
            .order_by(ExecutionTreeEvent.sequence)
        )

        result = await db.execute(query)
        events = list(result.scalars().all())

        logger.debug(
            "get_all_for_run_executed",
            run_id=str(run_id),
            count=len(events),
        )

        return events

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        event_id: UUID,
    ) -> ExecutionTreeEvent | None:
        """
        Get tree event by ID.

        Args:
            db: Database session
            event_id: ID of the tree event

        Returns:
            ExecutionTreeEvent or None if not found
        """
        query = select(ExecutionTreeEvent).where(ExecutionTreeEvent.id == event_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def create(
        db: AsyncSession,
        event: ExecutionTreeEvent,
    ) -> ExecutionTreeEvent:
        """
        Create a new tree event record.

        Args:
            db: Database session
            event: ExecutionTreeEvent instance to create

        Returns:
            Created ExecutionTreeEvent with populated ID
        """
        db.add(event)
        await db.flush()

        logger.debug(
            "tree_event_created",
            event_id=str(event.id),
            run_id=str(event.run_id),
            node_id=event.node_id,
        )

        return event

    @staticmethod
    async def batch_create(
        db: AsyncSession,
        events: list[ExecutionTreeEvent],
    ) -> list[UUID]:
        """
        Create multiple tree events efficiently.

        Args:
            db: Database session
            events: List of ExecutionTreeEvent instances to create

        Returns:
            List of created event IDs
        """
        event_ids: list[UUID] = []

        for event in events:
            db.add(event)
            await db.flush()
            event_ids.append(event.id)

        await db.commit()

        logger.info(
            "batch_create_executed",
            count=len(event_ids),
        )

        return event_ids
