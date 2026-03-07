"""
Known Issues API endpoints.

CRUD and aggregation for known issue tracking. Issues are scoped to
the user's personal organization.
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.services.known_issue_service import (
    KnownIssueCreate,
    KnownIssueListQuery,
    KnownIssueListResponse,
    KnownIssueResponse,
    KnownIssueService,
    KnownIssueStats,
    KnownIssueUpdate,
    ResolveRequest,
)
from app.services.permissions import get_personal_organization

logger = structlog.get_logger(__name__)

router = APIRouter()


def get_service() -> KnownIssueService:
    return KnownIssueService()


async def _resolve_org_id(db: AsyncSession, user: User) -> UUID:
    """Get the user's personal organization ID, raising 500 if missing."""
    org = await get_personal_organization(db, user.id)
    if not org:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Personal organization not found. Please contact support.",
        )
    return org.id  # type: ignore[return-value]


# =============================================================================
# CRUD Endpoints
# =============================================================================


@router.post(
    "",
    response_model=KnownIssueResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a known issue",
)
async def create_known_issue(
    data: KnownIssueCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: KnownIssueService = Depends(get_service),
) -> KnownIssueResponse:
    org_id = await _resolve_org_id(db, current_user)
    return await service.create_known_issue(db, org_id, current_user.id, data)


@router.get(
    "",
    response_model=KnownIssueListResponse,
    summary="List known issues",
)
async def list_known_issues(
    issue_status: str | None = Query(
        None, alias="status", description="Filter by status"
    ),
    category: str | None = Query(None, description="Filter by category"),
    severity: str | None = Query(None, description="Filter by severity"),
    scope_type: str | None = Query(None, description="Filter by scope type"),
    scope_value: str | None = Query(None, description="Filter by scope value"),
    provenance: str | None = Query(None, description="Filter by provenance"),
    search: str | None = Query(None, description="Search title and description"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: KnownIssueService = Depends(get_service),
) -> KnownIssueListResponse:
    org_id = await _resolve_org_id(db, current_user)
    query = KnownIssueListQuery(
        status=issue_status,
        category=category,
        severity=severity,
        scope_type=scope_type,
        scope_value=scope_value,
        provenance=provenance,
        search=search,
        offset=offset,
        limit=limit,
    )
    return await service.list_known_issues(db, org_id, query)


@router.get(
    "/stats",
    response_model=KnownIssueStats,
    summary="Get known issue stats",
)
async def get_issue_stats(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: KnownIssueService = Depends(get_service),
) -> KnownIssueStats:
    org_id = await _resolve_org_id(db, current_user)
    return await service.get_issue_stats(db, org_id)


@router.get(
    "/{issue_id}",
    response_model=KnownIssueResponse,
    summary="Get a known issue",
)
async def get_known_issue(
    issue_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: KnownIssueService = Depends(get_service),
) -> KnownIssueResponse:
    org_id = await _resolve_org_id(db, current_user)
    return await service.get_known_issue(db, org_id, issue_id)


@router.put(
    "/{issue_id}",
    response_model=KnownIssueResponse,
    summary="Update a known issue",
)
async def update_known_issue(
    issue_id: UUID,
    data: KnownIssueUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: KnownIssueService = Depends(get_service),
) -> KnownIssueResponse:
    org_id = await _resolve_org_id(db, current_user)
    return await service.update_known_issue(db, org_id, issue_id, data)


@router.delete(
    "/{issue_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a known issue",
)
async def delete_known_issue(
    issue_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: KnownIssueService = Depends(get_service),
) -> None:
    org_id = await _resolve_org_id(db, current_user)
    await service.delete_known_issue(db, org_id, issue_id)


@router.post(
    "/{issue_id}/resolve",
    response_model=KnownIssueResponse,
    summary="Resolve a known issue",
)
async def resolve_known_issue(
    issue_id: UUID,
    data: ResolveRequest | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: KnownIssueService = Depends(get_service),
) -> KnownIssueResponse:
    org_id = await _resolve_org_id(db, current_user)
    resolve_data = data or ResolveRequest()
    return await service.resolve_known_issue(db, org_id, issue_id, resolve_data)
