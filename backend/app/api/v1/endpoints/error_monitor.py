"""
API endpoints for error monitor management.

Provides CRUD and aggregation for error monitoring entries.
"""

from datetime import UTC
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.error_monitor import ErrorMonitorEntry
from app.models.user import User
from app.schemas.error_monitor import (
    ErrorMonitorEntryCreate,
    ErrorMonitorEntryResponse,
    ErrorMonitorEntryUpdate,
    ErrorMonitorListResponse,
    ErrorMonitorSummary,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("", response_model=ErrorMonitorListResponse)
async def list_errors(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    severity: str | None = Query(None),
    error_status: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List error monitor entries for the current user."""
    query = select(ErrorMonitorEntry).where(
        ErrorMonitorEntry.created_by_user_id == current_user.id
    )

    if severity:
        query = query.where(ErrorMonitorEntry.severity == severity)
    if error_status:
        query = query.where(ErrorMonitorEntry.status == error_status)
    if search:
        query = query.where(
            ErrorMonitorEntry.message.ilike(f"%{search}%")
            | ErrorMonitorEntry.error_type.ilike(f"%{search}%")
        )

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar_one()

    query = (
        query.order_by(ErrorMonitorEntry.last_seen_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    items = list(result.scalars().all())

    return ErrorMonitorListResponse(
        items=[ErrorMonitorEntryResponse.model_validate(i) for i in items],
        pagination={
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total,
        },
    )


@router.get("/summary", response_model=ErrorMonitorSummary)
async def get_error_summary(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get error monitor summary stats."""
    base = select(ErrorMonitorEntry).where(
        ErrorMonitorEntry.created_by_user_id == current_user.id
    )

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()

    # By severity
    sev_query = (
        select(ErrorMonitorEntry.severity, func.count())
        .where(ErrorMonitorEntry.created_by_user_id == current_user.id)
        .group_by(ErrorMonitorEntry.severity)
    )
    sev_result = await db.execute(sev_query)
    by_severity = {row[0]: row[1] for row in sev_result.all()}

    # By status
    stat_query = (
        select(ErrorMonitorEntry.status, func.count())
        .where(ErrorMonitorEntry.created_by_user_id == current_user.id)
        .group_by(ErrorMonitorEntry.status)
    )
    stat_result = await db.execute(stat_query)
    by_status = {row[0]: row[1] for row in stat_result.all()}

    # By category
    cat_query = (
        select(ErrorMonitorEntry.category, func.count())
        .where(
            ErrorMonitorEntry.created_by_user_id == current_user.id,
            ErrorMonitorEntry.category.isnot(None),
        )
        .group_by(ErrorMonitorEntry.category)
    )
    cat_result = await db.execute(cat_query)
    by_category = {row[0]: row[1] for row in cat_result.all()}

    return ErrorMonitorSummary(
        total=total,
        by_severity=by_severity,
        by_status=by_status,
        by_category=by_category,
    )


@router.post(
    "", response_model=ErrorMonitorEntryResponse, status_code=status.HTTP_201_CREATED
)
async def create_error(
    data: ErrorMonitorEntryCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new error monitor entry."""
    entry = ErrorMonitorEntry(
        created_by_user_id=current_user.id,
        **data.model_dump(),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    logger.info("error_created", error_id=entry.id, error_type=entry.error_type)
    return ErrorMonitorEntryResponse.model_validate(entry)


@router.get("/{error_id}", response_model=ErrorMonitorEntryResponse)
async def get_error(
    error_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get an error entry by ID."""
    result = await db.execute(
        select(ErrorMonitorEntry).where(
            ErrorMonitorEntry.id == error_id,
            ErrorMonitorEntry.created_by_user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Error entry not found"
        )
    return ErrorMonitorEntryResponse.model_validate(entry)


@router.put("/{error_id}", response_model=ErrorMonitorEntryResponse)
async def update_error(
    error_id: UUID,
    data: ErrorMonitorEntryUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update an error entry (acknowledge, resolve, change severity)."""
    result = await db.execute(
        select(ErrorMonitorEntry).where(
            ErrorMonitorEntry.id == error_id,
            ErrorMonitorEntry.created_by_user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Error entry not found"
        )

    update_data = data.model_dump(exclude_unset=True)

    # Handle acknowledge
    if update_data.get("acknowledged") is True and not entry.acknowledged:
        from datetime import datetime

        update_data["acknowledged_at"] = datetime.now(UTC)

    # Handle resolve
    if update_data.get("status") == "resolved" and entry.status != "resolved":
        from datetime import datetime

        update_data["resolved_at"] = datetime.now(UTC)

    for key, value in update_data.items():
        setattr(entry, key, value)

    await db.commit()
    await db.refresh(entry)
    logger.info("error_updated", error_id=error_id, updates=list(update_data.keys()))
    return ErrorMonitorEntryResponse.model_validate(entry)


@router.post("/{error_id}/acknowledge", response_model=ErrorMonitorEntryResponse)
async def acknowledge_error(
    error_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Acknowledge an error entry."""
    result = await db.execute(
        select(ErrorMonitorEntry).where(
            ErrorMonitorEntry.id == error_id,
            ErrorMonitorEntry.created_by_user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Error entry not found"
        )

    from datetime import datetime

    entry.acknowledged = True
    entry.acknowledged_at = datetime.now(UTC)
    entry.status = "acknowledged"

    await db.commit()
    await db.refresh(entry)
    logger.info("error_acknowledged", error_id=error_id)
    return ErrorMonitorEntryResponse.model_validate(entry)


@router.post("/{error_id}/resolve", response_model=ErrorMonitorEntryResponse)
async def resolve_error(
    error_id: UUID,
    notes: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Resolve an error entry."""
    result = await db.execute(
        select(ErrorMonitorEntry).where(
            ErrorMonitorEntry.id == error_id,
            ErrorMonitorEntry.created_by_user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Error entry not found"
        )

    from datetime import datetime

    entry.status = "resolved"
    entry.resolved_at = datetime.now(UTC)
    if notes:
        entry.resolution_notes = notes

    await db.commit()
    await db.refresh(entry)
    logger.info("error_resolved", error_id=error_id)
    return ErrorMonitorEntryResponse.model_validate(entry)


@router.delete("/{error_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_error(
    error_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete an error entry."""
    result = await db.execute(
        select(ErrorMonitorEntry).where(
            ErrorMonitorEntry.id == error_id,
            ErrorMonitorEntry.created_by_user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Error entry not found"
        )
    await db.delete(entry)
    await db.commit()
    logger.info("error_deleted", error_id=error_id)
