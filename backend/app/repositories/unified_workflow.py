"""
Repository for Unified Workflow database operations.

Handles query logic for workflow definitions: list, search, CRUD.
"""

from uuid import UUID

import structlog
from app.models.unified_workflow import UnifiedWorkflow
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class UnifiedWorkflowRepository:
    """Repository for unified workflow database operations."""

    @staticmethod
    async def list_workflows(
        db: AsyncSession,
        user_id: UUID | None = None,
        project_id: UUID | None = None,
        category: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[UnifiedWorkflow], int]:
        """List workflows with optional filters and pagination."""
        query = select(UnifiedWorkflow)

        if user_id:
            query = query.where(UnifiedWorkflow.created_by_user_id == user_id)
        if project_id:
            query = query.where(UnifiedWorkflow.project_id == project_id)
        if category:
            query = query.where(UnifiedWorkflow.category == category)

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = (
            query.order_by(UnifiedWorkflow.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )

        result = await db.execute(query)
        workflows = list(result.scalars().all())

        logger.debug(
            "list_workflows",
            total=total,
            returned=len(workflows),
            user_id=str(user_id) if user_id else None,
        )

        return workflows, total

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        workflow_id: UUID,
    ) -> UnifiedWorkflow | None:
        """Get a workflow by its ID."""
        query = select(UnifiedWorkflow).where(UnifiedWorkflow.id == workflow_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def search(
        db: AsyncSession,
        user_id: UUID | None = None,
        q: str | None = None,
        category: str | None = None,
        tag: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[UnifiedWorkflow], int]:
        """Search workflows with text query and filters."""
        query = select(UnifiedWorkflow)

        if user_id:
            query = query.where(UnifiedWorkflow.created_by_user_id == user_id)
        if q:
            pattern = f"%{q}%"
            query = query.where(
                or_(
                    UnifiedWorkflow.name.ilike(pattern),
                    UnifiedWorkflow.description.ilike(pattern),
                )
            )
        if category:
            query = query.where(UnifiedWorkflow.category == category)
        if tag:
            # JSONB array containment: tags @> '["tag_value"]'
            tag_json = func.cast(
                func.concat('["', tag, '"]'),
                UnifiedWorkflow.tags.type,
            )
            query = query.where(UnifiedWorkflow.tags.op("@>")(tag_json))

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = (
            query.order_by(UnifiedWorkflow.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )

        result = await db.execute(query)
        workflows = list(result.scalars().all())

        return workflows, total

    @staticmethod
    async def create(
        db: AsyncSession,
        workflow: UnifiedWorkflow,
    ) -> UnifiedWorkflow:
        """Create a new workflow."""
        db.add(workflow)
        await db.flush()
        await db.refresh(workflow)
        return workflow

    @staticmethod
    async def update(
        db: AsyncSession,
        workflow: UnifiedWorkflow,
    ) -> UnifiedWorkflow:
        """Update an existing workflow."""
        await db.flush()
        await db.refresh(workflow)
        return workflow

    @staticmethod
    async def delete(
        db: AsyncSession,
        workflow: UnifiedWorkflow,
    ) -> None:
        """Delete a workflow."""
        await db.delete(workflow)
        await db.flush()
