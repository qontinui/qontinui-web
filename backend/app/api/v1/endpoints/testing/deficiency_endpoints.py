"""
Deficiency management endpoints.

These endpoints handle:
- Listing and filtering deficiencies
- Getting deficiency details
- Updating deficiency status/severity
- Adding comments to deficiencies
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.schemas.testing import (DeficiencyCommentCreate,
                                 DeficiencyCommentResponse, DeficiencyDetail,
                                 DeficiencyListResponse, DeficiencyResponse,
                                 DeficiencyUpdate)
from app.services.deficiency_management_service import \
    DeficiencyManagementService
from app.services.test_run_service import TestRunService
from fastapi import APIRouter, Depends, Query, status
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import (DeficiencyNotFoundError, ProjectAccessDeniedError,
                   TestRunNotFoundError, get_deficiency_service,
                   get_test_run_service, handle_deficiency_not_found,
                   handle_project_access_denied, handle_test_run_not_found,
                   verify_project_access_or_raise)

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.get("/deficiencies", response_model=DeficiencyListResponse)
async def list_deficiencies(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TestRunService = Depends(get_test_run_service),
    def_service: DeficiencyManagementService = Depends(get_deficiency_service),
    project_id: UUID = Query(..., description="Filter by project ID"),
    deficiency_status: str | None = Query(None, description="Filter by status"),
    severity: str | None = Query(None, description="Filter by severity"),
    deficiency_type: str | None = Query(None, description="Filter by type"),
    run_id: UUID | None = Query(None, description="Filter by specific test run"),
    search: str | None = Query(None, description="Search in title/description"),
    limit: int = Query(50, ge=1, le=200, description="Page size (max 200)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort order (asc/desc)"),
) -> Any:
    """List all deficiencies across test runs with filtering."""
    await verify_project_access_or_raise(service, db, project_id, current_user.id)

    deficiencies, total, summary = await def_service.list_deficiencies(
        db=db,
        project_id=project_id,
        deficiency_status=deficiency_status,
        severity=severity,
        deficiency_type=deficiency_type,
        run_id=run_id,
        search=search,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    deficiency_responses = [
        DeficiencyResponse(
            deficiency_id=d.id,
            run_id=d.test_run_id,
            title=d.title,
            description=d.description,
            severity=d.severity,
            status=d.status,
            deficiency_type=d.deficiency_type,
            state=None,
            transition_sequence_number=None,
            screenshot_count=len(d.screenshot_urls) if d.screenshot_urls else 0,
            created_at=d.created_at,
            updated_at=d.updated_at,
            run_info=None,
        )
        for d in deficiencies
    ]

    return DeficiencyListResponse(
        deficiencies=deficiency_responses,
        pagination={
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        },
        summary=summary,
    )


async def _get_deficiency_with_access(
    db: AsyncSession,
    deficiency_id: UUID,
    current_user: User,
    service: TestRunService,
    def_service: DeficiencyManagementService,
) -> Any:
    """Helper to get deficiency with access verification."""

    async def verify_access(db: AsyncSession, test_run_id: UUID) -> None:
        await service.get_test_run_with_access(db, test_run_id, current_user.id)

    try:
        return await def_service.get_deficiency_with_access(
            db, deficiency_id, verify_access
        )
    except DeficiencyNotFoundError:
        raise handle_deficiency_not_found()
    except TestRunNotFoundError:
        raise handle_test_run_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


@router.get("/deficiencies/{deficiency_id}", response_model=DeficiencyDetail)
async def get_deficiency(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TestRunService = Depends(get_test_run_service),
    def_service: DeficiencyManagementService = Depends(get_deficiency_service),
    deficiency_id: UUID,
) -> Any:
    """Get detailed information about a specific deficiency."""
    deficiency = await _get_deficiency_with_access(
        db, deficiency_id, current_user, service, def_service
    )

    detail_data = await def_service.get_deficiency_detail(db, deficiency)
    return DeficiencyDetail(**detail_data)


@router.patch("/deficiencies/{deficiency_id}", response_model=DeficiencyDetail)
async def update_deficiency(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TestRunService = Depends(get_test_run_service),
    def_service: DeficiencyManagementService = Depends(get_deficiency_service),
    deficiency_id: UUID,
    update_in: DeficiencyUpdate,
) -> Any:
    """Update deficiency status, severity, or assignment."""
    deficiency = await _get_deficiency_with_access(
        db, deficiency_id, current_user, service, def_service
    )
    deficiency = await def_service.update_deficiency(db, deficiency, update_in)

    detail_data = await def_service.get_deficiency_detail(db, deficiency)
    return DeficiencyDetail(**detail_data)


@router.post(
    "/deficiencies/{deficiency_id}/comments",
    response_model=DeficiencyCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_deficiency_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TestRunService = Depends(get_test_run_service),
    def_service: DeficiencyManagementService = Depends(get_deficiency_service),
    deficiency_id: UUID,
    comment_in: DeficiencyCommentCreate,
) -> Any:
    """Add a comment to a deficiency for team collaboration."""
    deficiency = await _get_deficiency_with_access(
        db, deficiency_id, current_user, service, def_service
    )
    comment_id, _ = await def_service.add_comment(
        db, deficiency, comment_in, current_user
    )

    return DeficiencyCommentResponse(
        comment_id=comment_id,
        deficiency_id=deficiency_id,
        user={
            "user_id": str(current_user.id),
            "email": current_user.email,
            "full_name": getattr(current_user, "full_name", None),
        },
        comment=comment_in.comment,
        created_at=utc_now(),
    )
