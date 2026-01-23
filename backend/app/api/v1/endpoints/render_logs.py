"""
API endpoints for render logging (development debugging).

This module provides REST API endpoints for storing and retrieving DOM snapshots
captured by the frontend for AI-assisted debugging.

IMPORTANT: These endpoints are only enabled when RENDER_LOG_ENABLED=True.
In production, these endpoints return 404 to prevent information disclosure.
"""

from datetime import datetime, timedelta, UTC
from pathlib import Path
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user_optional, get_async_db
from app.core.config import settings
from app.models.render_log import RenderImage, RenderLog
from app.models.user import User
from app.schemas.render_log import (
    ClearRenderLogsRequest,
    ClearRenderLogsResponse,
    RenderImageResponse,
    RenderLogCreate,
    RenderLogList,
    RenderLogResponse,
    RenderLogSessionSummary,
    RenderLogStats,
    RenderLogSummary,
    RenderLogWithImages,
)

logger = structlog.get_logger(__name__)
router = APIRouter()


def check_render_log_enabled() -> None:
    """Check if render logging is enabled. Raises 404 if disabled."""
    if not settings.RENDER_LOG_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Render logging is not enabled",
        )


def get_image_storage_path() -> Path:
    """Get the image storage directory path."""
    base_path = Path(settings.RENDER_LOG_IMAGE_DIR)
    base_path.mkdir(parents=True, exist_ok=True)
    return base_path


@router.get(
    "/stats",
    response_model=RenderLogStats,
    summary="Get render logging statistics",
    description="Get statistics about render logs stored in the database.",
)
async def get_render_log_stats(
    db: AsyncSession = Depends(get_async_db),
) -> RenderLogStats:
    """Get render logging statistics."""
    check_render_log_enabled()

    # Get total snapshots
    total_result = await db.execute(select(func.count(RenderLog.id)))
    total_snapshots = total_result.scalar() or 0

    # Get unique sessions
    sessions_result = await db.execute(
        select(func.count(func.distinct(RenderLog.session_id)))
    )
    total_sessions = sessions_result.scalar() or 0

    # Get oldest and newest
    oldest_result = await db.execute(select(func.min(RenderLog.timestamp)))
    oldest_snapshot = oldest_result.scalar()

    newest_result = await db.execute(select(func.max(RenderLog.timestamp)))
    newest_snapshot = newest_result.scalar()

    # Get image count
    image_count_result = await db.execute(select(func.count(RenderImage.id)))
    image_count = image_count_result.scalar() or 0

    # Estimate storage (rough estimate based on average JSONB size)
    storage_estimate = total_snapshots * 50_000  # ~50KB per snapshot average

    return RenderLogStats(
        enabled=True,
        total_snapshots=total_snapshots,
        total_sessions=total_sessions,
        oldest_snapshot=oldest_snapshot,
        newest_snapshot=newest_snapshot,
        storage_used_bytes=storage_estimate,
        image_count=image_count,
    )


@router.get(
    "/sessions",
    response_model=list[RenderLogSessionSummary],
    summary="List render log sessions",
    description="Get a list of unique sessions with summary information.",
)
async def list_sessions(
    limit: int = Query(50, ge=1, le=200, description="Maximum sessions to return"),
    db: AsyncSession = Depends(get_async_db),
) -> list[RenderLogSessionSummary]:
    """List render log sessions with summaries."""
    check_render_log_enabled()

    # Query for session summaries
    # Count mutations using case expression
    from sqlalchemy import case

    query = (
        select(
            RenderLog.session_id,
            func.min(RenderLog.timestamp).label("first_timestamp"),
            func.max(RenderLog.timestamp).label("last_timestamp"),
            func.count(RenderLog.id).label("snapshot_count"),
            func.count(func.distinct(RenderLog.page_url)).label("unique_pages"),
            func.sum(case((RenderLog.trigger == "mutation", 1), else_=0)).label(
                "total_mutations"
            ),
        )
        .group_by(RenderLog.session_id)
        .order_by(func.max(RenderLog.timestamp).desc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()

    return [
        RenderLogSessionSummary(
            session_id=row.session_id,
            first_timestamp=row.first_timestamp,
            last_timestamp=row.last_timestamp,
            snapshot_count=row.snapshot_count,
            unique_pages=row.unique_pages,
            total_mutations=row.total_mutations or 0,
        )
        for row in rows
    ]


@router.get(
    "",
    response_model=RenderLogList,
    summary="List render logs",
    description="List render logs with pagination and filtering.",
)
async def list_render_logs(
    session_id: str | None = Query(None, description="Filter by session ID"),
    page_url: str | None = Query(
        None, description="Filter by page URL (partial match)"
    ),
    trigger: str | None = Query(None, description="Filter by trigger type"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=200, description="Page size"),
    db: AsyncSession = Depends(get_async_db),
) -> RenderLogList:
    """List render logs with pagination."""
    check_render_log_enabled()

    # Build query
    query = select(RenderLog)

    if session_id:
        query = query.filter(RenderLog.session_id == session_id)
    if page_url:
        query = query.filter(RenderLog.page_url.ilike(f"%{page_url}%"))
    if trigger:
        query = query.filter(RenderLog.trigger == trigger)

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    offset = (page - 1) * page_size
    query = query.order_by(RenderLog.timestamp.desc()).offset(offset).limit(page_size)

    result = await db.execute(query)
    logs = result.scalars().all()

    return RenderLogList(
        items=[RenderLogSummary.model_validate(log) for log in logs],
        total=total,
        page=page,
        page_size=page_size,
        has_more=(offset + len(logs)) < total,
    )


@router.get(
    "/{render_log_id}",
    response_model=RenderLogWithImages,
    summary="Get render log",
    description="Get a single render log with full snapshot data and images.",
)
async def get_render_log(
    render_log_id: int,
    db: AsyncSession = Depends(get_async_db),
) -> RenderLogWithImages:
    """Get a render log by ID with full data."""
    check_render_log_enabled()

    result = await db.execute(select(RenderLog).filter(RenderLog.id == render_log_id))
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Render log not found",
        )

    # Get associated images
    images_result = await db.execute(
        select(RenderImage).filter(RenderImage.render_log_id == render_log_id)
    )
    images = images_result.scalars().all()

    return RenderLogWithImages(
        **RenderLogResponse.model_validate(log).model_dump(),
        images=[RenderImageResponse.model_validate(img) for img in images],
    )


@router.post(
    "",
    response_model=RenderLogResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create render log",
    description="Store a new render log snapshot. Called by the frontend capture engine.",
)
async def create_render_log(
    log_data: RenderLogCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User | None = Depends(current_active_user_optional),
) -> RenderLogResponse:
    """Create a new render log entry."""
    check_render_log_enabled()

    # Create the render log
    render_log = RenderLog(
        session_id=log_data.session_id,
        page_url=log_data.page_url,
        page_title=log_data.page_title,
        trigger=log_data.trigger,
        mutation_type=log_data.mutation_type,
        target_selector=log_data.target_selector,
        snapshot=log_data.snapshot,
        viewport_width=log_data.viewport_width,
        viewport_height=log_data.viewport_height,
        scroll_x=log_data.scroll_x,
        scroll_y=log_data.scroll_y,
        capture_duration_ms=log_data.capture_duration_ms,
        element_count=log_data.element_count,
        user_id=current_user.id if current_user else None,
    )

    db.add(render_log)
    await db.commit()
    await db.refresh(render_log)

    logger.debug(
        "Created render log",
        render_log_id=render_log.id,
        session_id=log_data.session_id,
        page_url=log_data.page_url,
        trigger=log_data.trigger,
        element_count=log_data.element_count,
    )

    return RenderLogResponse.model_validate(render_log)


@router.post(
    "/{render_log_id}/images",
    response_model=RenderImageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload render image",
    description="Upload an image associated with a render log.",
)
async def upload_render_image(
    render_log_id: int,
    image_type: str = Query(..., description="Image type: screenshot, element, canvas"),
    element_selector: str | None = Query(None, description="Element CSS selector"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
) -> RenderImageResponse:
    """Upload an image for a render log."""
    check_render_log_enabled()

    # Verify render log exists
    result = await db.execute(select(RenderLog).filter(RenderLog.id == render_log_id))
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Render log not found",
        )

    # Generate unique filename
    ext = Path(file.filename or "image.png").suffix or ".png"
    filename = f"{log.session_id}_{render_log_id}_{uuid4().hex[:8]}{ext}"
    storage_path = get_image_storage_path()
    file_path = storage_path / filename

    # Save file
    content = await file.read()
    file_path.write_bytes(content)

    # Create database record
    render_image = RenderImage(
        render_log_id=render_log_id,
        image_type=image_type,
        element_selector=element_selector,
        file_path=filename,  # Store relative path
        file_size_bytes=len(content),
        mime_type=file.content_type,
    )

    db.add(render_image)
    await db.commit()
    await db.refresh(render_image)

    logger.debug(
        "Uploaded render image",
        render_image_id=render_image.id,
        render_log_id=render_log_id,
        image_type=image_type,
        file_size=len(content),
    )

    return RenderImageResponse.model_validate(render_image)


@router.delete(
    "",
    response_model=ClearRenderLogsResponse,
    summary="Clear render logs",
    description="Clear render logs with optional filtering by session or time.",
)
async def clear_render_logs(
    request: ClearRenderLogsRequest,
    db: AsyncSession = Depends(get_async_db),
) -> ClearRenderLogsResponse:
    """Clear render logs."""
    check_render_log_enabled()

    if not request.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must set confirm=true to clear logs",
        )

    # Build delete query for images first
    image_query = select(RenderImage.id, RenderImage.file_path)
    if request.session_id:
        image_query = image_query.join(RenderLog).filter(
            RenderLog.session_id == request.session_id
        )
    if request.before:
        image_query = image_query.join(RenderLog).filter(
            RenderLog.timestamp < request.before
        )

    # Get images to delete
    image_result = await db.execute(image_query)
    images_to_delete = image_result.all()

    # Delete image files
    storage_path = get_image_storage_path()
    deleted_files = 0
    for _, file_path in images_to_delete:
        full_path = storage_path / file_path
        if full_path.exists():
            full_path.unlink()
            deleted_files += 1

    # Build delete query for logs
    log_query = delete(RenderLog)
    if request.session_id:
        log_query = log_query.filter(RenderLog.session_id == request.session_id)
    if request.before:
        log_query = log_query.filter(RenderLog.timestamp < request.before)

    # Execute delete (cascades to images)
    result = await db.execute(log_query)
    deleted_snapshots = result.rowcount
    await db.commit()

    logger.info(
        "Cleared render logs",
        deleted_snapshots=deleted_snapshots,
        deleted_images=len(images_to_delete),
        deleted_files=deleted_files,
        session_id=request.session_id,
        before=request.before.isoformat() if request.before else None,
    )

    return ClearRenderLogsResponse(
        deleted_snapshots=deleted_snapshots,
        deleted_images=len(images_to_delete),
        deleted_files=deleted_files,
    )


@router.post(
    "/cleanup",
    response_model=ClearRenderLogsResponse,
    summary="Cleanup old render logs",
    description="Delete render logs older than the configured retention period.",
)
async def cleanup_old_render_logs(
    db: AsyncSession = Depends(get_async_db),
) -> ClearRenderLogsResponse:
    """Cleanup old render logs based on retention settings."""
    check_render_log_enabled()

    cutoff = datetime.now(UTC) - timedelta(days=settings.RENDER_LOG_RETENTION_DAYS)

    # Get images to delete
    image_query = (
        select(RenderImage.id, RenderImage.file_path)
        .join(RenderLog)
        .filter(RenderLog.timestamp < cutoff)
    )
    image_result = await db.execute(image_query)
    images_to_delete = image_result.all()

    # Delete image files
    storage_path = get_image_storage_path()
    deleted_files = 0
    for _, file_path in images_to_delete:
        full_path = storage_path / file_path
        if full_path.exists():
            full_path.unlink()
            deleted_files += 1

    # Delete old logs (cascades to images)
    result = await db.execute(delete(RenderLog).filter(RenderLog.timestamp < cutoff))
    deleted_snapshots = result.rowcount
    await db.commit()

    logger.info(
        "Cleaned up old render logs",
        deleted_snapshots=deleted_snapshots,
        deleted_images=len(images_to_delete),
        deleted_files=deleted_files,
        cutoff=cutoff.isoformat(),
        retention_days=settings.RENDER_LOG_RETENTION_DAYS,
    )

    return ClearRenderLogsResponse(
        deleted_snapshots=deleted_snapshots,
        deleted_images=len(images_to_delete),
        deleted_files=deleted_files,
    )
