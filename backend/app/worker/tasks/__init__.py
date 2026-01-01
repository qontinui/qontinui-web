"""Background tasks package."""

import importlib.util

# Import email tasks from the parent-level tasks.py module
# We need to access the sibling tasks.py file at app/worker/tasks.py
# Since this __init__.py creates a package that shadows it, we use importlib
from pathlib import Path

# Import cleanup tasks from dedicated modules
from app.worker.tasks.automation_cleanup import (
    cleanup_old_automation_data,
    cleanup_orphaned_sessions,
)
from app.worker.tasks.database_cleanup import (
    cleanup_expired_device_sessions,
    cleanup_expired_sessions,
    cleanup_token_blacklist,
)
from app.worker.tasks.metrics_cleanup import (
    archive_old_analytics_to_s3,
    cleanup_old_analytics_events,
)
from app.worker.tasks.storage_cleanup import cleanup_old_screenshots

# Load tasks.py from parent directory
_tasks_py_path = Path(__file__).parent.parent / "tasks.py"
_spec = importlib.util.spec_from_file_location(
    "app.worker._tasks_module", _tasks_py_path
)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Could not load module from {_tasks_py_path}")
_tasks_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_tasks_module)

# Import email task functions from the loaded module
send_email_task = _tasks_module.send_email_task
send_verification_email_task = _tasks_module.send_verification_email_task
send_password_reset_email_task = _tasks_module.send_password_reset_email_task
send_analytics_report_task = _tasks_module.send_analytics_report_task
process_uploaded_image = _tasks_module.process_uploaded_image

__all__ = [
    # Email tasks
    "send_email_task",
    "send_verification_email_task",
    "send_password_reset_email_task",
    "send_analytics_report_task",
    # Image processing tasks
    "process_uploaded_image",
    # Database cleanup tasks
    "cleanup_expired_sessions",
    "cleanup_expired_device_sessions",
    "cleanup_token_blacklist",
    # Storage cleanup tasks
    "cleanup_old_screenshots",
    # Metrics cleanup tasks
    "cleanup_old_analytics_events",
    "archive_old_analytics_to_s3",
    # Automation cleanup tasks
    "cleanup_orphaned_sessions",
    "cleanup_old_automation_data",
]
