"""Collaboration repository package.

Provides focused sub-repositories for collaboration-related database operations:
- LockRepository: Project lock CRUD for concurrent editing
- ActivityRepository: Activity log CRUD for audit trails
- CommentRepository: Comment CRUD for discussions
- AccessRepository: Access control CRUD for project sharing
"""

from app.repositories.collaboration.access_repository import (
    AccessRepository, access_repository)
from app.repositories.collaboration.activity_repository import (
    ActivityRepository, activity_repository)
from app.repositories.collaboration.comment_repository import (
    CommentRepository, comment_repository)
from app.repositories.collaboration.lock_repository import (LockRepository,
                                                            lock_repository)


class CollaborationRepository:
    """Facade that delegates to focused sub-repositories.

    Preserves backward compatibility for existing imports of
    ``collaboration_repository`` while the codebase migrates to
    the individual repository instances.
    """

    def __init__(self) -> None:
        self._lock = lock_repository
        self._activity = activity_repository
        self._comment = comment_repository
        self._access = access_repository

    # Lock operations
    get_lock = property(lambda self: self._lock.get_lock)
    get_lock_by_user = property(lambda self: self._lock.get_lock_by_user)
    get_resource_lock = property(lambda self: self._lock.get_resource_lock)
    get_resource_lock_for_update = property(
        lambda self: self._lock.get_resource_lock_for_update
    )
    get_project_locks = property(lambda self: self._lock.get_project_locks)
    get_expired_locks = property(lambda self: self._lock.get_expired_locks)
    create_lock = property(lambda self: self._lock.create_lock)
    delete_lock = property(lambda self: self._lock.delete_lock)

    # Activity operations
    create_activity = property(lambda self: self._activity.create_activity)
    get_project_activities = property(
        lambda self: self._activity.get_project_activities
    )

    # Comment operations
    get_comment = property(lambda self: self._comment.get_comment)
    get_comment_in_project = property(lambda self: self._comment.get_comment_in_project)
    get_comment_with_author = property(
        lambda self: self._comment.get_comment_with_author
    )
    get_project_comments = property(lambda self: self._comment.get_project_comments)
    get_reply_count = property(lambda self: self._comment.get_reply_count)
    create_comment = property(lambda self: self._comment.create_comment)
    delete_comment = property(lambda self: self._comment.delete_comment)

    # Access control operations
    get_access_control = property(lambda self: self._access.get_access_control)
    get_access_control_in_project = property(
        lambda self: self._access.get_access_control_in_project
    )
    get_user_access = property(lambda self: self._access.get_user_access)
    get_organization_access = property(
        lambda self: self._access.get_organization_access
    )
    get_project_collaborators = property(
        lambda self: self._access.get_project_collaborators
    )
    create_access_control = property(lambda self: self._access.create_access_control)
    delete_access_control = property(lambda self: self._access.delete_access_control)
    get_user = property(lambda self: self._access.get_user)


collaboration_repository = CollaborationRepository()

__all__ = [
    "AccessRepository",
    "access_repository",
    "ActivityRepository",
    "activity_repository",
    "CollaborationRepository",
    "collaboration_repository",
    "CommentRepository",
    "comment_repository",
    "LockRepository",
    "lock_repository",
]
