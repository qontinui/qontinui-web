"""Background tasks package."""

# Import cleanup tasks from the cleanup_tasks submodule
from app.worker.tasks.cleanup_tasks import (
    cleanup_expired_device_sessions,
    cleanup_expired_sessions,
    cleanup_old_analytics_events,
    cleanup_token_blacklist,
)

# Import email tasks from the parent-level tasks.py module
# We need to access the sibling tasks.py file at app/worker/tasks.py
# Since this __init__.py creates a package that shadows it, we use sys.modules
import sys
import importlib.util
from pathlib import Path

# Load tasks.py from parent directory
_tasks_py_path = Path(__file__).parent.parent / "tasks.py"
_spec = importlib.util.spec_from_file_location("app.worker._tasks_module", _tasks_py_path)
_tasks_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_tasks_module)

# Import email task functions from the loaded module
send_email_task = _tasks_module.send_email_task
send_verification_email_task = _tasks_module.send_verification_email_task
send_password_reset_email_task = _tasks_module.send_password_reset_email_task
send_analytics_report_task = _tasks_module.send_analytics_report_task

__all__ = [
    # Email tasks
    "send_email_task",
    "send_verification_email_task",
    "send_password_reset_email_task",
    "send_analytics_report_task",
    # Cleanup tasks
    "cleanup_expired_sessions",
    "cleanup_expired_device_sessions",
    "cleanup_old_analytics_events",
    "cleanup_token_blacklist",
]
