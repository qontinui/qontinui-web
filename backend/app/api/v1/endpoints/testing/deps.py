"""
Shared dependencies and error handling for testing endpoints.

This module provides:
- Dependency injection for services
- Common error handling helpers to reduce boilerplate
"""

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_runner_user_from_token
from app.models.user import User
from app.services.deficiency_management_service import (
    DeficiencyManagementService,
    DeficiencyNotFoundError,
    deficiency_management_service,
)
from app.services.test_run_service import (
    ProjectAccessDeniedError,
    ProjectNotFoundError,
    TestRunNotFoundError,
    TestRunService,
    test_run_service,
)

# HTTP Bearer scheme for runner token authentication
security = HTTPBearer()


# ============================================================================
# Dependency Injection
# ============================================================================


def get_test_run_service() -> TestRunService:
    """Get the test run service."""
    return test_run_service


def get_deficiency_service() -> DeficiencyManagementService:
    """Get the deficiency management service."""
    return deficiency_management_service


async def get_runner_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_async_db),
) -> User:
    """Validate JWT and return associated user for runner endpoints."""
    return await get_runner_user_from_token(credentials.credentials, db)


# ============================================================================
# Error Handling Helpers
# ============================================================================


def handle_project_not_found() -> HTTPException:
    """Create HTTPException for project not found."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Project not found",
    )


def handle_project_access_denied() -> HTTPException:
    """Create HTTPException for project access denied."""
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not authorized to access this project",
    )


def handle_test_run_not_found() -> HTTPException:
    """Create HTTPException for test run not found."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Test run not found",
    )


def handle_deficiency_not_found() -> HTTPException:
    """Create HTTPException for deficiency not found."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Deficiency not found",
    )


async def verify_project_access_or_raise(
    service: TestRunService,
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
) -> None:
    """Verify project access or raise appropriate HTTPException."""
    try:
        await service.verify_project_access(db, project_id, user_id)
    except ProjectNotFoundError:
        raise handle_project_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


async def verify_test_run_access_or_raise(
    service: TestRunService,
    db: AsyncSession,
    run_id: UUID,
    user_id: UUID,
) -> None:
    """Verify test run access or raise appropriate HTTPException."""
    try:
        await service.get_test_run_with_access(db, run_id, user_id)
    except TestRunNotFoundError:
        raise handle_test_run_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


# Re-export exception types for use in endpoint modules
__all__ = [
    "security",
    "get_test_run_service",
    "get_deficiency_service",
    "get_runner_user",
    "handle_project_not_found",
    "handle_project_access_denied",
    "handle_test_run_not_found",
    "handle_deficiency_not_found",
    "verify_project_access_or_raise",
    "verify_test_run_access_or_raise",
    "ProjectNotFoundError",
    "ProjectAccessDeniedError",
    "TestRunNotFoundError",
    "DeficiencyNotFoundError",
]
