"""
Collaboration notification types.

Provides specific notification methods for mentions, shares, comments, replies, etc.
"""

from uuid import UUID

from app.models.notification import Notification, NotificationType
from sqlalchemy.ext.asyncio import AsyncSession


class CollaborationNotifications:
    """Mixin providing collaboration notification methods."""

    async def send_mention_notification(
        self,
        db: AsyncSession,
        mentioned_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: UUID,
        project_name: str,
        comment_id: UUID,
        comment_content: str,
        resource_type: str = "comment",
    ) -> Notification | None:
        """Send notification when user is mentioned in a comment."""
        # Don't notify users if they mention themselves
        if mentioned_user_id == actor_id:
            return None

        title = f"{actor_username} mentioned you in {project_name}"
        message = f"{actor_username} mentioned you: {comment_content[:100]}..."

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "comment_id": str(comment_id),
            "deep_link": f"/projects/{project_id}/comments/{comment_id}",
        }

        return await self.create_notification(  # type: ignore[attr-defined, no-any-return]
            db=db,
            user_id=mentioned_user_id,
            notification_type=NotificationType.MENTION,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type=resource_type,
            resource_id=str(comment_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_share_notification(
        self,
        db: AsyncSession,
        shared_with_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: UUID,
        project_name: str,
        permission_level: str,
    ) -> Notification | None:
        """Send notification when project is shared with user."""
        title = f"{actor_username} shared {project_name} with you"
        message = f"You now have {permission_level} access to {project_name}"

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "permission_level": permission_level,
            "deep_link": f"/projects/{project_id}",
        }

        return await self.create_notification(  # type: ignore[attr-defined, no-any-return]
            db=db,
            user_id=shared_with_user_id,
            notification_type=NotificationType.SHARE,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type="project",
            resource_id=str(project_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_comment_notification(
        self,
        db: AsyncSession,
        notify_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: UUID,
        project_name: str,
        comment_id: UUID,
        comment_content: str,
    ) -> Notification | None:
        """Send notification when comment is added to a resource."""
        # Don't notify user of their own comments
        if notify_user_id == actor_id:
            return None

        title = f"{actor_username} commented on {project_name}"
        message = f"{actor_username}: {comment_content[:100]}..."

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "comment_id": str(comment_id),
            "deep_link": f"/projects/{project_id}/comments/{comment_id}",
        }

        return await self.create_notification(  # type: ignore[attr-defined, no-any-return]
            db=db,
            user_id=notify_user_id,
            notification_type=NotificationType.COMMENT,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type="comment",
            resource_id=str(comment_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_reply_notification(
        self,
        db: AsyncSession,
        notify_user_id: UUID,
        actor_id: UUID,
        actor_username: str,
        project_id: UUID,
        project_name: str,
        comment_id: UUID,
        parent_comment_id: UUID,
        reply_content: str,
    ) -> Notification | None:
        """Send notification when someone replies to a comment."""
        # Don't notify user of their own replies
        if notify_user_id == actor_id:
            return None

        title = f"{actor_username} replied to your comment"
        message = f"{actor_username}: {reply_content[:100]}..."

        metadata = {
            "project_id": project_id,
            "project_name": project_name,
            "comment_id": str(comment_id),
            "parent_comment_id": str(parent_comment_id),
            "deep_link": f"/projects/{project_id}/comments/{parent_comment_id}",
        }

        return await self.create_notification(  # type: ignore[attr-defined, no-any-return]
            db=db,
            user_id=notify_user_id,
            notification_type=NotificationType.REPLY,
            title=title,
            message=message,
            actor_id=actor_id,
            project_id=project_id,
            resource_type="comment",
            resource_id=str(comment_id),
            metadata=metadata,
            send_email=True,
        )

    async def send_lock_released_notification(
        self,
        db: AsyncSession,
        notify_user_id: UUID,
        project_id: UUID,
        resource_type: str,
        resource_id: str,
        resource_name: str | None = None,
    ) -> Notification | None:
        """Send notification when a lock is released."""
        title = f"Resource available: {resource_name or resource_id}"
        message = f"The {resource_type} is now available for editing"

        metadata = {
            "project_id": project_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "deep_link": f"/projects/{project_id}",
        }

        return await self.create_notification(  # type: ignore[attr-defined, no-any-return]
            db=db,
            user_id=notify_user_id,
            notification_type=NotificationType.LOCK_RELEASED,
            title=title,
            message=message,
            project_id=project_id,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata=metadata,
            send_email=False,  # Don't send email for lock releases
        )
