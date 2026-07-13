"""
Celery application for background task processing.

This module sets up Celery for handling long-running tasks like:
- Image processing
- Email sending
- Report generation
- Long automation runs
"""

import os
from typing import Any

from celery import Celery  # type: ignore[import-not-found]
from celery.schedules import crontab  # type: ignore[import-untyped]

from app.core.config import settings

# Get Redis URL from settings with fallback
REDIS_URL = getattr(settings, "REDIS_URL", None) or os.getenv(
    "REDIS_URL", "redis://localhost:6379/0"
)

celery_app = Celery(
    "qontinui",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.tasks",
        # Phase 3D — scheduled workflow dispatch task registered for redbeat.
        "app.tasks.scheduled_dispatch",
        # Tenant agentic memory (plan 2026-07-10, Phases 4+5) — lifecycle
        # sweeps (decay / consolidation / reindex) + the MEMORY.md bridge.
        "app.tasks.memory_lifecycle",
        "app.tasks.memory_bridge",
    ],
)

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes
    task_soft_time_limit=25 * 60,  # 25 minutes
    worker_prefetch_multiplier=4,
    worker_max_tasks_per_child=1000,
)

# ---------------------------------------------------------------------------
# Phase 3D — celery-beat scheduler (redbeat).
#
# Redbeat stores schedule entries in Redis (same instance as the broker), so
# entries survive a backend restart but are lost if Redis itself is flushed.
# The backend startup hook in ``app.main`` re-syncs DB rows to redbeat to
# cover that case.
#
# Key-prefix convention: ``qontinui:redbeat:`` for redbeat's own internal
# state, ``qontinui:schedule:{scheduled_run.id}`` for individual entries
# (handled by redbeat_manager).
# ---------------------------------------------------------------------------
celery_app.conf.beat_scheduler = "redbeat.RedBeatScheduler"
celery_app.conf.redbeat_redis_url = REDIS_URL
celery_app.conf.redbeat_lock_key = "qontinui:redbeat:lock"
celery_app.conf.redbeat_key_prefix = "qontinui:redbeat:"

# ---------------------------------------------------------------------------
# Static beat schedule — tenant agentic-memory lifecycle + MEMORY.md bridge
# (plan 2026-07-10-tenant-agentic-memory-web-backend, Phases 4+5).
#
# RedBeatScheduler loads these static ``beat_schedule`` entries alongside the
# dynamic ``qontinui:schedule:*`` entries redbeat_manager maintains. Daily
# sweeps run at low-traffic UTC hours; consolidation runs weekly on Sunday;
# the bridge diff is cheap (key-set compare before any embedding) so it runs
# every 15 minutes.
# ---------------------------------------------------------------------------
celery_app.conf.beat_schedule = {
    "memory-lifecycle-decay-daily": {
        "task": "app.tasks.memory_lifecycle.decay",
        "schedule": crontab(minute=10, hour=3),
    },
    "memory-lifecycle-reindex-daily": {
        "task": "app.tasks.memory_lifecycle.reindex",
        "schedule": crontab(minute=40, hour=3),
    },
    "memory-lifecycle-consolidate-weekly": {
        "task": "app.tasks.memory_lifecycle.consolidate",
        # Sunday (day_of_week=0), 04:20 UTC.
        "schedule": crontab(minute=20, hour=4, day_of_week=0),
    },
    "memory-bridge-sync": {
        "task": "app.tasks.memory_bridge.sync",
        "schedule": crontab(minute="*/15"),
    },
}

# Task routing
celery_app.conf.task_routes = {
    "app.tasks.image.*": {"queue": "image-processing"},
    "app.tasks.email.*": {"queue": "email"},
    "app.tasks.scheduled_dispatch.*": {"queue": "default"},
    "app.tasks.*": {"queue": "default"},
}


# Example task (move to app/tasks/ directory in production)
@celery_app.task(bind=True, name="app.tasks.example_task")
def example_task(self, value: str):
    """
    Example Celery task.

    Args:
        value: Example parameter

    Returns:
        Result dictionary
    """
    return {"status": "completed", "value": value}


@celery_app.task(bind=True, name="app.tasks.process_image")
def process_image_task(
    self,
    image_path: str,
    max_width: int = 1920,
    max_height: int = 1080,
    quality: int = 85,
    create_thumbnail: bool = True,
    thumbnail_size: tuple[int, int] = (200, 200),
):
    """
    Process uploaded image (resize, optimize, etc.).

    Args:
        image_path: Path to image file
        max_width: Maximum width for resized image
        max_height: Maximum height for resized image
        quality: JPEG quality (1-100)
        create_thumbnail: Whether to create a thumbnail
        thumbnail_size: Thumbnail dimensions

    Returns:
        Processing result with paths to processed images
    """
    from pathlib import Path

    from PIL import Image

    result: dict[str, Any] = {
        "status": "processing",
        "original_path": image_path,
        "processed_path": None,
        "thumbnail_path": None,
        "original_size": None,
        "processed_size": None,
        "error": None,
    }

    try:
        # Load image
        img: Any = Image.open(image_path)
        result["original_size"] = img.size

        # Get output paths
        path = Path(image_path)
        processed_path = path.parent / f"{path.stem}_processed{path.suffix}"
        thumbnail_path = path.parent / f"{path.stem}_thumb{path.suffix}"

        # Resize if needed (maintain aspect ratio)
        width, height = img.size
        if width > max_width or height > max_height:
            ratio = min(max_width / width, max_height / height)
            new_size = (int(width * ratio), int(height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        result["processed_size"] = img.size

        # Convert to RGB if necessary (for JPEG)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Save processed image
        img.save(str(processed_path), "JPEG", quality=quality, optimize=True)
        result["processed_path"] = str(processed_path)

        # Create thumbnail if requested
        if create_thumbnail:
            thumb = img.copy()
            thumb.thumbnail(thumbnail_size, Image.Resampling.LANCZOS)
            thumb.save(str(thumbnail_path), "JPEG", quality=quality, optimize=True)
            result["thumbnail_path"] = str(thumbnail_path)

        result["status"] = "completed"

    except FileNotFoundError:
        result["status"] = "failed"
        result["error"] = f"Image file not found: {image_path}"
    except Exception as e:
        result["status"] = "failed"
        result["error"] = str(e)

    return result
