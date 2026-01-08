"""
AI Task models - DEPRECATED.

This module is deprecated. Use app.models.task_run instead.

All classes are re-exported from task_run.py for backward compatibility.
"""

# Re-export everything from task_run for backward compatibility
from app.models.task_run import (  # New unified names (recommended); Backward compatibility aliases (deprecated)
    AITask,
    AITaskFinding,
    AITaskFindingActionType,
    AITaskFindingCategory,
    AITaskFindingSeverity,
    AITaskFindingStatus,
    AITaskSession,
    AITaskStatus,
    FindingActionType,
    FindingCategory,
    FindingSeverity,
    FindingStatus,
    TaskRun,
    TaskRunAutomation,
    TaskRunFinding,
    TaskRunSession,
    TaskRunStatus,
    TaskType,
)

__all__ = [
    # New unified names
    "TaskRun",
    "TaskRunStatus",
    "TaskRunSession",
    "TaskRunFinding",
    "TaskRunAutomation",
    "TaskType",
    "FindingCategory",
    "FindingSeverity",
    "FindingStatus",
    "FindingActionType",
    # Backward compatibility aliases (deprecated)
    "AITask",
    "AITaskStatus",
    "AITaskSession",
    "AITaskFinding",
    "AITaskFindingCategory",
    "AITaskFindingSeverity",
    "AITaskFindingStatus",
    "AITaskFindingActionType",
]
