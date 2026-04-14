"""Repository for project comment database operations.

Provides data access for project comments, discussions, and threaded replies.
"""

from typing import Any
from uuid import UUID

from app.models.collaboration import ProjectComment
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload


class CommentRepository:
    """Repository for project comment data access operations."""

    async def get_comment(
        self, db: AsyncSession, comment_id: UUID
    ) -> ProjectComment | None:
        """Get a comment by ID."""
        result = await db.execute(
            select(ProjectComment).filter(ProjectComment.id == comment_id)
        )
        return result.scalar_one_or_none()

    async def get_comment_in_project(
        self, db: AsyncSession, comment_id: UUID, project_id: UUID
    ) -> ProjectComment | None:
        """Get a comment by ID within a specific project."""
        result = await db.execute(
            select(ProjectComment).filter(
                and_(
                    ProjectComment.id == comment_id,
                    ProjectComment.project_id == project_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_comment_with_author(
        self, db: AsyncSession, comment_id: UUID, project_id: UUID
    ) -> ProjectComment | None:
        """Get a comment with author loaded."""
        result = await db.execute(
            select(ProjectComment)
            .filter(
                and_(
                    ProjectComment.id == comment_id,
                    ProjectComment.project_id == project_id,
                )
            )
            .options(joinedload(ProjectComment.author))
        )
        return result.unique().scalar_one_or_none()

    async def get_project_comments(
        self,
        db: AsyncSession,
        project_id: UUID,
        workflow_id: str | None = None,
        action_id: str | None = None,
        parent_comment_id: UUID | None = None,
        resolved: bool | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> list[ProjectComment]:
        """Get comments for a project with filters."""
        query = (
            select(ProjectComment)
            .filter(ProjectComment.project_id == project_id)
            .options(joinedload(ProjectComment.author))
        )

        if workflow_id:
            query = query.filter(ProjectComment.workflow_id == workflow_id)

        if action_id:
            query = query.filter(ProjectComment.action_id == action_id)

        if parent_comment_id:
            query = query.filter(ProjectComment.parent_comment_id == parent_comment_id)
        else:
            # Default: only get top-level comments
            query = query.filter(ProjectComment.parent_comment_id.is_(None))

        if resolved is not None:
            query = query.filter(ProjectComment.resolved == resolved)

        result = await db.execute(
            query.offset(offset).limit(limit).order_by(ProjectComment.created_at.desc())
        )
        return list(result.unique().scalars().all())

    async def get_reply_count(self, db: AsyncSession, comment_id: UUID) -> int:
        """Get the number of replies to a comment."""
        result = await db.execute(
            select(func.count())
            .select_from(ProjectComment)
            .filter(ProjectComment.parent_comment_id == comment_id)
        )
        return result.scalar_one()

    async def create_comment(
        self,
        db: AsyncSession,
        project_id: UUID,
        author_id: UUID,
        content: str,
        workflow_id: str | None = None,
        action_id: str | None = None,
        position: dict[str, Any] | None = None,
        mentions: list[UUID] | None = None,
        parent_comment_id: UUID | None = None,
    ) -> ProjectComment:
        """Create a new comment."""
        comment = ProjectComment(
            project_id=project_id,
            workflow_id=workflow_id,
            action_id=action_id,
            author_id=author_id,
            content=content,
            position=position,
            mentions=mentions,
            parent_comment_id=parent_comment_id,
        )
        db.add(comment)
        await db.flush()
        await db.refresh(comment)
        return comment

    async def delete_comment(self, db: AsyncSession, comment: ProjectComment) -> None:
        """Delete a comment."""
        await db.delete(comment)
        await db.flush()


comment_repository = CommentRepository()
