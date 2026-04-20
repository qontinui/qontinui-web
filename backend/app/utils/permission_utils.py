"""
Shared permission checking utilities for project resource endpoints.

Provides common permission and access checking functions used across
project images, screenshots, and files endpoints.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.crud.project import get_project
from app.middleware.error_handler import forbidden_error, not_found_error
from app.models.organization import PermissionLevel
from app.services.limit_checker import LimitChecker
from app.services.permission_service import permission_service


async def check_project_permission(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    required_level: PermissionLevel,
) -> None:
    """
    Check if user has required permission level for project.

    Verifies:
    1. Project exists
    2. User has at least the required permission level

    Args:
        db: Async database session
        project_id: UUID of the project
        user_id: UUID of the user
        required_level: Minimum required permission level (VIEW, EDIT, ADMIN)

    Raises:
        HTTPException: 404 if project not found
        HTTPException: 403 if insufficient permissions
    """
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_permission = await permission_service.can_user_access_project(
        db, user_id, project_id, required_level
    )
    if not has_permission:
        raise forbidden_error(
            f"{required_level.value} permission required for this operation",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )


async def check_read_only_mode(
    db: AsyncSession,
    user_id: UUID,
    subscription_tier: str,
) -> None:
    """
    Check if user is in read-only mode and raise error if so.

    Users are in read-only mode when they exceed their plan limits.

    Args:
        db: Async database session
        user_id: UUID of the user
        subscription_tier: User's subscription tier

    Raises:
        HTTPException: 403 if account is in read-only mode
    """
    is_read_only, reason = await LimitChecker.is_read_only(
        db, user_id, subscription_tier
    )
    if is_read_only:
        raise forbidden_error(
            f"Account is in read-only mode. {reason}. Upgrade your plan to continue.",
            ErrorCode.ACCOUNT_READ_ONLY,
        )
