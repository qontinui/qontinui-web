"""
Backward-compatible re-export shim for task_run package.

All logic has moved to app.services.task_run submodules.
Import from app.services.task_run directly for new code.
"""

from app.services.task_run import DeferredQuestionBatch  # noqa: F401
