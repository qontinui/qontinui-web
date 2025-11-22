"""Authorization utilities for access control."""

from app.models.project import Project
from app.models.user import User
from fastapi import HTTPException, status


def verify_project_access(project: Project, user: User, action: str = "access") -> None:
    """
    Verify user has permission to access a project.

    Args:
        project: The project to check access for
        user: The user attempting access
        action: Description of the action (for error message)

    Raises:
        HTTPException: If user lacks permission (403 Forbidden)
    """
    if not is_project_owner(project, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Not enough permissions to {action} this project",
        )


def is_project_owner(project: Project, user: User) -> bool:
    """
    Check if user is the project owner or a superuser.

    Args:
        project: The project to check ownership for
        user: The user to check

    Returns:
        True if user owns the project or is a superuser
    """
    return project.owner_id == user.id or user.is_superuser


def verify_superuser(user: User, action: str = "perform this action") -> None:
    """
    Verify user is a superuser.

    Args:
        user: The user to check
        action: Description of the action (for error message)

    Raises:
        HTTPException: If user is not a superuser (403 Forbidden)
    """
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Superuser privileges required to {action}",
        )
