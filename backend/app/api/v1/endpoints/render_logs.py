"""
API endpoints for render logging.

This module provides REST API endpoints for storing and retrieving DOM snapshots
captured by the frontend for UI Bridge state discovery.

Access model (coord finding 966c92eb; the router used to be fully anonymous):

- Every route requires an authenticated, active user. No caller sends a render
  log anonymously: the only producer is the frontend capture engine, which posts
  through ``httpClient`` and therefore carries the user's bearer.
- ``RenderLog`` carries a ``user_id`` and nothing coarser (no organization or
  project column), so ownership is per user. A normal user reads only rows whose
  ``user_id`` is their own; a superuser reads every row. Rows with a NULL
  ``user_id`` (written anonymously before this change, or orphaned by a user
  deletion) are therefore visible to superusers only.
- Images attach only to a render log the caller owns.
- The destructive routes (``DELETE ""`` and ``POST /cleanup``) are
  superuser-only. Retention runs server-side as the scheduled job
  ``render_log_retention`` (``app.jobs.render_log_retention``); ``/cleanup``
  calls the same core on demand.
- Deleting image files never leaves ``RENDER_LOG_IMAGE_DIR``, whatever a
  stored ``file_path`` says.
"""

from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import Select, case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_async_db,
    get_current_active_user_async,
    get_current_superuser_async,
)
from app.jobs.render_log_retention import (
    delete_render_logs_older_than_retention,
    get_image_storage_path,
    unlink_stored_images,
)
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


# The only image types a render log stores. The extension comes from the
# client-supplied filename and the stored MIME type is derived from it here; the
# client's Content-Type is never stored. Anything else is refused (422) rather
# than coerced to ``.png``: coercion would label arbitrary bytes (an ``.html``
# page, say) as an image, and no caller uploads anything but these types.
_IMAGE_MIME_BY_EXT: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Upload cap. The app has no shared upload-size constant (each upload module
# defines its own); 10 MB matches ``images.py`` and ``project_image_service``.
MAX_RENDER_IMAGE_BYTES = 10 * 1024 * 1024


def _scope_to_caller[S: Select[Any]](query: S, user: User) -> S:
    """Restrict a query over ``RenderLog`` to the rows ``user`` may read.

    Superusers read every row. Everyone else reads only rows they own, which
    excludes rows with a NULL ``user_id``.
    """
    if user.is_superuser:
        return query
    return query.where(RenderLog.user_id == user.id)


def _not_found() -> HTTPException:
    # A row the caller may not read answers exactly like a missing row, so the
    # response does not reveal which ids exist.
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Render log not found",
    )


@router.get(
    "/stats",
    response_model=RenderLogStats,
    summary="Get render logging statistics",
    description="Get statistics about render logs stored in the database.",
)
async def get_render_log_stats(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> RenderLogStats:
    """Get render logging statistics over the rows the caller may read."""
    log_stats = await db.execute(
        _scope_to_caller(
            select(
                func.count(RenderLog.id),
                func.count(func.distinct(RenderLog.session_id)),
                func.min(RenderLog.timestamp),
                func.max(RenderLog.timestamp),
            ),
            current_user,
        )
    )
    total_snapshots, total_sessions, oldest_snapshot, newest_snapshot = log_stats.one()
    total_snapshots = total_snapshots or 0
    total_sessions = total_sessions or 0

    image_count_result = await db.execute(
        _scope_to_caller(
            select(func.count(RenderImage.id)).join(
                RenderLog, RenderImage.render_log_id == RenderLog.id
            ),
            current_user,
        )
    )
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
    current_user: User = Depends(get_current_active_user_async),
) -> list[RenderLogSessionSummary]:
    """List the caller's render log sessions with summaries."""
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
    query = _scope_to_caller(query, current_user)

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
    current_user: User = Depends(get_current_active_user_async),
) -> RenderLogList:
    """List the render logs the caller may read, with pagination."""
    query = _scope_to_caller(select(RenderLog), current_user)

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
    current_user: User = Depends(get_current_active_user_async),
) -> RenderLogWithImages:
    """Get a render log the caller may read, by ID, with full data."""
    result = await db.execute(
        _scope_to_caller(
            select(RenderLog).where(RenderLog.id == render_log_id), current_user
        )
    )
    log = result.scalar_one_or_none()

    if not log:
        raise _not_found()

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
    current_user: User = Depends(get_current_active_user_async),
) -> RenderLogResponse:
    """Create a new render log entry."""
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
        user_id=current_user.id,
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
    current_user: User = Depends(get_current_active_user_async),
) -> RenderImageResponse:
    """Upload an image for a render log the caller owns."""
    # Ownership, not visibility: a superuser may READ every log, but an image
    # is attached only to the caller's own log.
    result = await db.execute(
        select(RenderLog).where(
            RenderLog.id == render_log_id, RenderLog.user_id == current_user.id
        )
    )
    log = result.scalar_one_or_none()

    if not log:
        raise _not_found()

    ext = Path(file.filename or "").suffix.lower()
    mime_type = _IMAGE_MIME_BY_EXT.get(ext)
    if mime_type is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Unsupported image type; allowed extensions: "
                + ", ".join(sorted(_IMAGE_MIME_BY_EXT))
            ),
        )

    # Read one byte past the cap, so an oversized upload is detected without
    # buffering all of it.
    content = await file.read(MAX_RENDER_IMAGE_BYTES + 1)
    if len(content) > MAX_RENDER_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Image too large; maximum is {MAX_RENDER_IMAGE_BYTES} bytes",
        )

    # The filename is built only from server-controlled parts. It used to embed
    # the client-supplied ``session_id``, which let a caller write outside the
    # storage directory with a ``../`` session id.
    filename = f"{render_log_id}_{uuid4().hex}{ext}"
    (get_image_storage_path() / filename).write_bytes(content)

    # Create database record
    render_image = RenderImage(
        render_log_id=render_log_id,
        image_type=image_type,
        element_selector=element_selector,
        file_path=filename,  # Store relative path
        file_size_bytes=len(content),
        mime_type=mime_type,
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
    _superuser: User = Depends(get_current_superuser_async),
) -> ClearRenderLogsResponse:
    """Clear render logs across every user. Superuser only."""
    if not request.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must set confirm=true to clear logs",
        )

    # Build delete query for images first
    # Join once: joining per filter emitted a duplicate JOIN (and an SQL error)
    # when both ``session_id`` and ``before`` were given.
    image_query = select(RenderImage.id, RenderImage.file_path).join(
        RenderLog, RenderImage.render_log_id == RenderLog.id
    )
    if request.session_id:
        image_query = image_query.where(RenderLog.session_id == request.session_id)
    if request.before:
        image_query = image_query.where(RenderLog.timestamp < request.before)

    # Get images to delete
    image_result = await db.execute(image_query)
    images_to_delete = image_result.all()

    deleted_files = unlink_stored_images(
        get_image_storage_path(), (file_path for _, file_path in images_to_delete)
    )

    # Build delete query for logs
    log_query = delete(RenderLog)
    if request.session_id:
        log_query = log_query.filter(RenderLog.session_id == request.session_id)
    if request.before:
        log_query = log_query.filter(RenderLog.timestamp < request.before)

    # Execute delete (cascades to images)
    result = await db.execute(log_query)
    deleted_snapshots = result.rowcount  # type: ignore[attr-defined]
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
    _superuser: User = Depends(get_current_superuser_async),
) -> ClearRenderLogsResponse:
    """Run render-log retention now, across every user. Superuser only.

    The scheduled job ``render_log_retention`` runs the same core hourly; this
    route is the on-demand trigger.
    """
    outcome = await delete_render_logs_older_than_retention(db)
    await db.commit()
    return ClearRenderLogsResponse(
        deleted_snapshots=outcome.deleted_snapshots,
        deleted_images=outcome.deleted_images,
        deleted_files=outcome.deleted_files,
    )
