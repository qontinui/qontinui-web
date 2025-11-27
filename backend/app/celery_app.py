"""
Celery application for background task processing.

This module sets up Celery for handling long-running tasks like:
- Image processing
- Email sending
- Report generation
- Long automation runs
"""

from celery import Celery  # type: ignore[import-not-found]

# TODO: Import settings
# from app.config.settings import settings

# Temporary hardcoded values - replace with settings
REDIS_URL = "redis://localhost:6379/0"

celery_app = Celery(
    "qontinui", broker=REDIS_URL, backend=REDIS_URL, include=["app.tasks"]
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

# Task routing
celery_app.conf.task_routes = {
    "app.tasks.image.*": {"queue": "image-processing"},
    "app.tasks.email.*": {"queue": "email"},
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
def process_image_task(self, image_path: str):
    """
    Process uploaded image (resize, optimize, etc.).

    Args:
        image_path: Path to image file

    Returns:
        Processing result
    """
    # TODO: Implement image processing with Pillow
    # 1. Load image
    # 2. Resize/optimize
    # 3. Save processed image
    # 4. Return result

    return {"status": "processed", "path": image_path}
