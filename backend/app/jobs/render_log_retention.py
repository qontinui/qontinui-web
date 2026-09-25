"""Render-log retention and the image-file deletion both delete paths share.

Scheduled job ``render_log_retention`` (``app.core.scheduler``, hourly and at
boot) deletes render logs older than ``RENDER_LOG_RETENTION_DAYS`` together
with their image files. The superuser-only ``POST /api/v1/render-logs/cleanup``
route calls the same core, :func:`delete_render_logs_older_than_retention`.

Before this job existed, the only thing that ran retention in production was
coord's route-serving observer, which POSTed the then-anonymous ``/cleanup``
route on each of its probe cycles (12,063 times in 14 days, coord finding
966c92eb). Once that route required a superuser, nothing would have run it, so
the schedule now lives here.
"""

from __future__ import annotations

import asyncio
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

# Rows per retention chunk. Each chunk is committed on its own, so a pass that
# times out keeps the chunks it finished and the next pass resumes from there
# rather than repeating one huge delete.
RETENTION_CHUNK_ROWS = 1000


@dataclass(frozen=True)
class RenderLogDeletion:
    """What one delete pass removed."""

    deleted_snapshots: int
    deleted_images: int
    deleted_files: int


def _ensure_image_storage_path() -> Path:
    base_path = Path(settings.RENDER_LOG_IMAGE_DIR)
    base_path.mkdir(parents=True, exist_ok=True)
    return base_path


async def get_image_storage_path() -> Path:
    """Get the image storage directory path, creating it if needed.

    The ``mkdir`` runs in a worker thread, off the event loop.
    """
    return await asyncio.to_thread(_ensure_image_storage_path)


def unlink_stored_images(storage_path: Path, file_paths: Iterable[str]) -> int:
    """Delete stored image files, only ever inside ``storage_path``.

    Synchronous filesystem work; async callers go through
    :func:`unlink_stored_images_async`.

    Each file is handled on its own, and no failure propagates, because the
    caller deletes the rows next and one bad file must not abort that:

    - a ``file_path`` that resolves outside the storage directory (a stored
      ``../`` component, or an absolute path) is logged and skipped. Rows
      written before the upload route built filenames from server-controlled
      parts only could carry one;
    - a path whose resolution fails (a symlink loop) is logged and skipped;
    - an unlink that fails (permissions, a racing delete) is logged and the
      loop continues. A file already gone is not a failure.

    Returns the number of files actually deleted.
    """
    root = storage_path.resolve()
    deleted = 0
    for file_path in file_paths:
        try:
            full_path = (storage_path / file_path).resolve()
        except (OSError, RuntimeError) as exc:
            # RuntimeError: a symlink loop on Python < 3.13; OSError from 3.13.
            logger.warning(
                "render_image_path_unresolvable_skipped",
                file_path=file_path,
                error=str(exc),
            )
            continue
        if not full_path.is_relative_to(root):
            logger.warning(
                "render_image_path_outside_storage_skipped",
                file_path=file_path,
                storage_path=str(root),
            )
            continue
        try:
            if not full_path.is_file():
                continue
            full_path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning(
                "render_image_unlink_failed",
                file_path=file_path,
                error=str(exc),
            )
            continue
        deleted += 1
    return deleted


async def unlink_stored_images_async(file_paths: Iterable[str]) -> int:
    """:func:`unlink_stored_images` in a worker thread, off the event loop."""
    paths = list(file_paths)
    if not paths:
        return 0
    storage_path = await get_image_storage_path()
    return await asyncio.to_thread(unlink_stored_images, storage_path, paths)


async def delete_render_logs_older_than_retention(
    db: AsyncSession, *, now: datetime | None = None
) -> RenderLogDeletion:
    """Delete render logs past retention, across every user, plus their files.

    Works in id-ordered chunks of ``RETENTION_CHUNK_ROWS`` and COMMITS each
    chunk, so an interrupted pass keeps its progress. Within a chunk the files
    are unlinked before the rows are deleted: a crash in between leaves rows
    whose files are gone, which the next pass deletes, never files that no row
    names.
    """
    cutoff = (now or datetime.now(UTC)) - timedelta(
        days=settings.RENDER_LOG_RETENTION_DAYS
    )
    deleted_snapshots = deleted_images = deleted_files = 0

    while True:
        id_result = await db.execute(
            select(RenderLog.id)
            .where(RenderLog.timestamp < cutoff)
            .order_by(RenderLog.id)
            .limit(RETENTION_CHUNK_ROWS)
        )
        ids = list(id_result.scalars().all())
        if not ids:
            break

        image_result = await db.execute(
            select(RenderImage.file_path).where(RenderImage.render_log_id.in_(ids))
        )
        image_paths = list(image_result.scalars().all())
        deleted_files += await unlink_stored_images_async(image_paths)

        # Images go with their logs through the FK's ON DELETE CASCADE.
        result = await db.execute(delete(RenderLog).where(RenderLog.id.in_(ids)))
        await db.commit()
        deleted_snapshots += int(result.rowcount)  # type: ignore[attr-defined]
        deleted_images += len(image_paths)

    outcome = RenderLogDeletion(
        deleted_snapshots=deleted_snapshots,
        deleted_images=deleted_images,
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
    """Scheduler core: one retention pass (it commits per chunk)."""
    outcome = await delete_render_logs_older_than_retention(db)
    return {
        "deleted_snapshots": outcome.deleted_snapshots,
        "deleted_images": outcome.deleted_images,
        "deleted_files": outcome.deleted_files,
    }
