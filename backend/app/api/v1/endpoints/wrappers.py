"""Wrapper marketplace API endpoints — Phase 6.

Surfaces the four wrapper marketplace tables (entries, ratings, comments,
install events) to the qontinui-web frontend. Endpoint paths intentionally
omit the ``/api`` prefix here — this router is mounted at
``/api/wrappers`` directly on the FastAPI app in :mod:`app.main`,
bypassing the ``/api/v1`` versioned router so the frontend's REST shape
stays as documented in the integration plan.

Auth model:
* List/detail endpoints are public (read-only marketplace browse).
* Ratings + comments require an authenticated user.
* Install-event ingestion is unauthenticated (anonymous runner pings)
  and the ``runner_id`` is sha256-hashed before storage.

TODO: when moderator tooling lands, gate ``moderation_state`` updates
behind a superuser dependency and surface them via dedicated admin
routes.
"""

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.schemas.wrapper import (
    InstallEventAck,
    InstallEventCreate,
    WrapperCommentCreate,
    WrapperCommentRead,
    WrapperEntryDetailRead,
    WrapperEntryRead,
    WrapperRatingCreate,
    WrapperRatingSummary,
)
from app.services.wrapper_service import WrapperService

logger = structlog.get_logger(__name__)

router = APIRouter()


def get_service() -> WrapperService:
    return WrapperService()


# =============================================================================
# Public list / detail
# =============================================================================


@router.get(
    "",
    response_model=list[WrapperEntryRead],
    summary="List wrappers in the marketplace",
)
async def list_wrappers(
    q: str | None = Query(None, description="Free-text search (name/desc/id)"),
    category: str | None = Query(None, description="Filter by category tag"),
    verified: bool | None = Query(None, description="Filter to verified-only entries"),
    sort: str = Query(
        "installs",
        pattern="^(installs|rating|recent)$",
        description="installs | rating | recent",
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_async_db),
    service: WrapperService = Depends(get_service),
) -> list[WrapperEntryRead]:
    return await service.list_entries(
        db,
        q=q,
        category=category,
        verified=verified,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{wrapper_id}",
    response_model=WrapperEntryDetailRead,
    summary="Wrapper detail with comments",
)
async def get_wrapper(
    wrapper_id: str,
    db: AsyncSession = Depends(get_async_db),
    service: WrapperService = Depends(get_service),
) -> WrapperEntryDetailRead:
    entry = await service.get_entry(db, wrapper_id)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wrapper not found",
        )
    return entry


# =============================================================================
# Ratings (auth required)
# =============================================================================


@router.post(
    "/{wrapper_id}/ratings",
    response_model=WrapperRatingSummary,
    status_code=status.HTTP_200_OK,
    summary="Rate a wrapper (1..5 stars)",
)
async def upsert_rating(
    wrapper_id: str,
    data: WrapperRatingCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: WrapperService = Depends(get_service),
) -> WrapperRatingSummary:
    if not await service.entry_exists(db, wrapper_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wrapper not found",
        )
    avg, count = await service.upsert_rating(db, wrapper_id, current_user.id, data)
    return WrapperRatingSummary(
        wrapper_id=wrapper_id,
        avg_rating=avg,
        rating_count=count,
    )


@router.delete(
    "/{wrapper_id}/ratings",
    response_model=WrapperRatingSummary,
    summary="Remove your rating for a wrapper",
)
async def delete_rating(
    wrapper_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: WrapperService = Depends(get_service),
) -> WrapperRatingSummary:
    if not await service.entry_exists(db, wrapper_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wrapper not found",
        )
    avg, count = await service.delete_rating(db, wrapper_id, current_user.id)
    return WrapperRatingSummary(
        wrapper_id=wrapper_id,
        avg_rating=avg,
        rating_count=count,
    )


# =============================================================================
# Comments (auth required)
# =============================================================================


@router.post(
    "/{wrapper_id}/comments",
    response_model=WrapperCommentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Post a comment (or threaded reply) on a wrapper",
)
async def create_comment(
    wrapper_id: str,
    data: WrapperCommentCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: WrapperService = Depends(get_service),
) -> WrapperCommentRead:
    if not await service.entry_exists(db, wrapper_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wrapper not found",
        )
    try:
        return await service.create_comment(db, wrapper_id, current_user.id, data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


# =============================================================================
# Install events (anonymous — runner ping)
# =============================================================================


@router.post(
    "/{wrapper_id}/install-events",
    response_model=InstallEventAck,
    status_code=status.HTTP_201_CREATED,
    summary="Anonymous install-event ping (runner_id is sha256-hashed)",
)
async def record_install_event(
    wrapper_id: str,
    data: InstallEventCreate,
    db: AsyncSession = Depends(get_async_db),
    service: WrapperService = Depends(get_service),
) -> InstallEventAck:
    if not await service.entry_exists(db, wrapper_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wrapper not found",
        )
    install_count = await service.record_install_event(db, wrapper_id, data)
    return InstallEventAck(wrapper_id=wrapper_id, install_count=install_count)
