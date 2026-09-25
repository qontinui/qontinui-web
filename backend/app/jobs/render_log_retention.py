"""Render-log retention and the image-file deletion both delete paths share.

Scheduled job ``render_log_retention`` (``app.core.scheduler``, hourly and at
boot) deletes render logs older than ``RENDER_LOG_RETENTION_DAYS`` together
with their image files. The superuser-only ``POST /api/v1/render-logs/cleanup``
route calls the same core, :func:`delete_render_logs_older_than_retention`.

Before this job existed, the only thing that ran retention in production was
coord's route-serving observer, which POSTed the then-anonymous ``/cleanup``
route every ~100 s. Once that route required a superuser, nothing would have
run it, so the schedule now lives here.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.render_log import RenderImage, RenderLog

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class RenderLogDeletion:
    """What one delete pass removed."""

    deleted_snapshots: int
    deleted_images: int
    deleted_files: int


def get_image_storage_path() -> Path:
    """Get the image storage directory path, creating it if needed."""
    base_path = Path(settings.RENDER_LOG_IMAGE_DIR)
    base_path.mkdir(parents=True, exist_ok=True)
    return base_path


def unlink_stored_images(storage_path: Path, file_paths: Iterable[str]) -> int:
    """Delete stored image files, only ever inside ``storage_path``.

    ``file_path`` is a column value. Rows written before the upload route built
    filenames from server-controlled parts only could carry a client-supplied
    ``../`` component (or an absolute path). A path that resolves outside the
    storage directory is logged and skipped, never unlinked.

    Returns the number of files actually deleted.
    """
    root = storage_path.resolve()
    deleted = 0
    for file_path in file_paths:
        full_path = (storage_path / file_path).resolve()
        if not full_path.is_relative_to(root):
            logger.warning(
                "render_image_path_outside_storage_skipped",
                file_path=file_path,
                storage_path=str(root),
            )
            continue
        if full_path.is_file():
            full_path.unlink()
            deleted += 1
    return deleted


async def delete_render_logs_older_than_retention(
    db: AsyncSession, *, now: datetime | None = None
) -> RenderLogDeletion:
    """Delete render logs past retention, across every user, plus their files.

    Does not commit: the caller owns the transaction (the route commits its
    request session, the scheduled job commits through ``_run_committed``).
    """
    cutoff = (now or datetime.now(UTC)) - timedelta(
        days=settings.RENDER_LOG_RETENTION_DAYS
    )

    image_result = await db.execute(
        select(RenderImage.file_path)
        .join(RenderLog, RenderImage.render_log_id == RenderLog.id)
        .where(RenderLog.timestamp < cutoff)
    )
    image_paths = list(image_result.scalars().all())

    deleted_files = unlink_stored_images(get_image_storage_path(), image_paths)

    # Images go with their logs through the FK's ON DELETE CASCADE.
    result = await db.execute(delete(RenderLog).where(RenderLog.timestamp < cutoff))
    deleted_snapshots = int(result.rowcount)  # type: ignore[attr-defined]

    outcome = RenderLogDeletion(
        deleted_snapshots=deleted_snapshots,
        deleted_images=len(image_paths),
        deleted_files=deleted_files,
    )
    logger.info(
        "Cleaned up old render logs",
        deleted_snapshots=outcome.deleted_snapshots,
        deleted_images=outcome.deleted_images,
        deleted_files=outcome.deleted_files,
        cutoff=cutoff.isoformat(),
        retention_days=settings.RENDER_LOG_RETENTION_DAYS,
    )
    return outcome


async def run_render_log_retention(db: AsyncSession) -> dict[str, Any]:
    """Scheduler core: one retention pass. ``_run_committed`` commits it."""
    outcome = await delete_render_logs_older_than_retention(db)
    return {
        "deleted_snapshots": outcome.deleted_snapshots,
        "deleted_images": outcome.deleted_images,
        "deleted_files": outcome.deleted_files,
    }
