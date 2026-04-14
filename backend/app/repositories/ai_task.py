"""
Repository for AI Task database operations - DEPRECATED.

This module is deprecated. Use app.repositories.task_run instead.

All classes are re-exported from task_run.py for backward compatibility.
"""

# Re-export everything from task_run repository for backward compatibility
from app.repositories.task_run import (  # New unified names (recommended)
    TaskRunAutomationRepository, TaskRunFindingRepository, TaskRunRepository,
    TaskRunSessionRepository)

# Backward compatibility aliases
AITaskRepository = TaskRunRepository
AITaskSessionRepository = TaskRunSessionRepository
AITaskFindingRepository = TaskRunFindingRepository

__all__ = [
    # New unified names
    "TaskRunRepository",
    "TaskRunSessionRepository",
    "TaskRunFindingRepository",
    "TaskRunAutomationRepository",
    # Backward compatibility aliases (deprecated)
    "AITaskRepository",
    "AITaskSessionRepository",
    "AITaskFindingRepository",
]
