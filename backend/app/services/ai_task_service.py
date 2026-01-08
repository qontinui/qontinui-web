"""
Service for AI Task business logic - DEPRECATED.

This module is deprecated. Use app.services.task_run_service instead.

All classes and functions are re-exported from task_run_service.py
for backward compatibility.
"""

# Re-export everything from task_run_service for backward compatibility
from app.services.task_run_service import (  # Response schemas; Mapping functions
    Pagination,
    TaskRunAutomationCreate,
    TaskRunAutomationResponse,
    TaskRunAutomationUpdate,
    TaskRunCreate,
    TaskRunDetail,
    TaskRunFindingCreate,
    TaskRunFindingResponse,
    TaskRunFindingsBatch,
    TaskRunFindingsListResponse,
    TaskRunFindingUpdate,
    TaskRunListResponse,
    TaskRunResponse,
    TaskRunService,
    TaskRunSessionCreate,
    TaskRunSessionResponse,
    TaskRunSessionUpdate,
    TaskRunUpdate,
    model_to_automation_response,
    model_to_finding_response,
    model_to_session_response,
    model_to_task_run_response,
)

# Alias for backward compatibility
model_to_task_response = model_to_task_run_response

# Backward compatibility aliases for schema classes
AITaskCreate = TaskRunCreate
AITaskUpdate = TaskRunUpdate
AITaskSessionCreate = TaskRunSessionCreate
AITaskSessionUpdate = TaskRunSessionUpdate
AITaskFindingCreate = TaskRunFindingCreate
AITaskFindingUpdate = TaskRunFindingUpdate
AITaskFindingsBatch = TaskRunFindingsBatch
AITaskResponse = TaskRunResponse
AITaskSessionResponse = TaskRunSessionResponse
AITaskFindingResponse = TaskRunFindingResponse
AITaskDetail = TaskRunDetail
AITaskListResponse = TaskRunListResponse
AITaskFindingsListResponse = TaskRunFindingsListResponse
AITaskService = TaskRunService

__all__ = [
    # New unified names (recommended)
    "TaskRunService",
    "TaskRunCreate",
    "TaskRunUpdate",
    "TaskRunSessionCreate",
    "TaskRunSessionUpdate",
    "TaskRunFindingCreate",
    "TaskRunFindingUpdate",
    "TaskRunFindingsBatch",
    "TaskRunAutomationCreate",
    "TaskRunAutomationUpdate",
    "Pagination",
    "TaskRunResponse",
    "TaskRunSessionResponse",
    "TaskRunFindingResponse",
    "TaskRunAutomationResponse",
    "TaskRunDetail",
    "TaskRunListResponse",
    "TaskRunFindingsListResponse",
    # Mapping functions
    "model_to_task_run_response",
    "model_to_task_response",  # Backward compatibility alias
    "model_to_session_response",
    "model_to_finding_response",
    "model_to_automation_response",
    # Backward compatibility aliases (deprecated)
    "AITaskService",
    "AITaskCreate",
    "AITaskUpdate",
    "AITaskSessionCreate",
    "AITaskSessionUpdate",
    "AITaskFindingCreate",
    "AITaskFindingUpdate",
    "AITaskFindingsBatch",
    "AITaskResponse",
    "AITaskSessionResponse",
    "AITaskFindingResponse",
    "AITaskDetail",
    "AITaskListResponse",
    "AITaskFindingsListResponse",
]
