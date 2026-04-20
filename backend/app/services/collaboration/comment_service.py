"""
Comment service for project comments and discussions.

Provides functionality for:
- Creating, updating, and deleting comments
- Comment threading (replies)
- Comment resolution
- Mention handling
"""

from typing import cast
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collaboration import ProjectComment
from app.repositories.collaboration.comment_repository import comment_repository
from app.schemas.collaboration import CommentCreate, CommentResponse, CommentUpdate

logger = structlog.get_logger(__name__)


class CommentService:
    """Service for comment operations."""

    async def create_comment(
        self,
        db: AsyncSession,
        project_id: UUID,
        author_id: UUID,
        comment_data: CommentCreate,
    ) -> tuple[ProjectComment, CommentResponse]:
        """
        Create a new comment.

        Args:
            db: Database session
            project_id: Project ID
            author_id: Author user ID
            comment_data: Comment creation data

        Returns:
            Tuple of (ProjectComment model, CommentResponse with author info)
        """
        comment = await comment_repository.create_comment(
            db,
            project_id=project_id,
            author_id=author_id,
            content=comment_data.content,
            workflow_id=comment_data.workflow_id,
            action_id=comment_data.action_id,
            position=(
                comment_data.position.model_dump() if comment_data.position else None
            ),
            mentions=comment_data.mentions,
            parent_comment_id=comment_data.parent_comment_id,
        )

        await db.commit()
        await db.refresh(comment)

        logger.info("comment_created", comment_id=comment.id, project_id=project_id)

        response = CommentResponse.model_validate(comment)
        response.reply_count = 0

        return comment, response

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
    ) -> list[CommentResponse]:
        """
        Get comments for a project with filters.

        Args:
            db: Database session
            project_id: Project ID
            workflow_id: Filter by workflow ID
            action_id: Filter by action ID
            parent_comment_id: Filter by parent comment (for replies)
            resolved: Filter by resolved status
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            List of comment responses with author info and reply counts
        """
        comments = await comment_repository.get_project_comments(
            db,
            project_id=project_id,
            workflow_id=workflow_id,
            action_id=action_id,
            parent_comment_id=parent_comment_id,
            resolved=resolved,
            offset=offset,
            limit=limit,
        )

        responses = []
        for comment in comments:
            response = CommentResponse.model_validate(comment)

            if comment.author:
                response.author_username = cast(str, comment.author.username)
                response.author_email = cast(str, comment.author.email)
                response.author_avatar_url = comment.author.avatar_url

            # Get reply count
            response.reply_count = await comment_repository.get_reply_count(
                db, cast(UUID, comment.id)
            )

            responses.append(response)

        return responses

    async def get_comment(
        self,
        db: AsyncSession,
        comment_id: UUID,
        project_id: UUID,
    ) -> ProjectComment | None:
        """
        Get a specific comment.

        Args:
            db: Database session
            comment_id: Comment ID
            project_id: Project ID

        Returns:
            ProjectComment if found, None otherwise
        """
        return await comment_repository.get_comment_in_project(
            db, comment_id, project_id
        )

    async def get_comment_with_author(
        self,
        db: AsyncSession,
        comment_id: UUID,
        project_id: UUID,
    ) -> ProjectComment | None:
        """
        Get a comment with author information loaded.

        Args:
            db: Database session
            comment_id: Comment ID
            project_id: Project ID

        Returns:
            ProjectComment with author loaded if found, None otherwise
        """
        return await comment_repository.get_comment_with_author(
            db, comment_id, project_id
        )

    async def update_comment(
        self,
        db: AsyncSession,
        comment: ProjectComment,
        update_data: CommentUpdate,
        author_username: str,
        author_email: str,
        author_avatar_url: str | None,
    ) -> CommentResponse:
        """
        Update a comment.

        Args:
            db: Database session
            comment: Comment to update
            update_data: Fields to update
            author_username: Author username for response
            author_email: Author email for response
            author_avatar_url: Author avatar URL for response

        Returns:
            Updated comment response
        """
        update_dict = update_data.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            if field == "position" and value:
                setattr(
                    comment,
                    field,
                    value.model_dump() if hasattr(value, "model_dump") else value,
                )
            else:
                setattr(comment, field, value)

        await db.commit()
        await db.refresh(comment)

        logger.info("comment_updated", comment_id=comment.id)

        response = CommentResponse.model_validate(comment)
        response.author_username = author_username
        response.author_email = author_email
        response.author_avatar_url = author_avatar_url

        return response

    async def delete_comment(
        self,
        db: AsyncSession,
        comment: ProjectComment,
    ) -> None:
        """
        Delete a comment.

        Args:
            db: Database session
            comment: Comment to delete
        """
        comment_id = comment.id
        await comment_repository.delete_comment(db, comment)
        await db.commit()

        logger.info("comment_deleted", comment_id=comment_id)

    async def resolve_comment(
        self,
        db: AsyncSession,
        comment: ProjectComment,
        resolved: bool,
        resolver_id: UUID,
    ) -> CommentResponse:
        """
        Resolve or unresolve a comment.

        Args:
            db: Database session
            comment: Comment to resolve/unresolve
            resolved: True to resolve, False to unresolve
            resolver_id: User ID of resolver (required when resolving)

        Returns:
            Updated comment response
        """
        if resolved:
            comment.resolve(resolver_id)
        else:
            comment.unresolve()

        await db.commit()
        await db.refresh(comment)

        logger.info(
            "comment_resolved" if resolved else "comment_unresolved",
            comment_id=comment.id,
        )

        response = CommentResponse.model_validate(comment)
        if comment.author:
            response.author_username = cast(str, comment.author.username)
            response.author_email = cast(str, comment.author.email)
            response.author_avatar_url = comment.author.avatar_url

        return response

    async def get_parent_comment(
        self,
        db: AsyncSession,
        parent_comment_id: UUID,
    ) -> ProjectComment | None:
        """
        Get the parent comment for a reply.

        Args:
            db: Database session
            parent_comment_id: Parent comment ID

        Returns:
            Parent comment if found, None otherwise
        """
        return await comment_repository.get_comment(db, parent_comment_id)


# Global instance
comment_service = CommentService()
