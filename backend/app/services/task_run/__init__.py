"""
Task Run service package.

Provides task run management split into focused sub-services:
- TaskRunService: Core CRUD for task runs
- TaskRunSessionService: Session management
- TaskRunFindingService: Finding sync and management
- TaskRunAutomationService: Automation tracking and step progress

All schemas, mappers, and service classes are re-exported here
for convenient imports.
"""

from app.services.task_run.automation_service import TaskRunAutomationService
from app.services.task_run.finding_service import TaskRunFindingService
from app.services.task_run.mappers import (
    _get_enum_value,
    model_to_automation_response,
    model_to_finding_response,
    model_to_session_response,
    model_to_task_run_response,
)
from app.services.task_run.schemas import (
    Pagination,
    StepProgressResponse,
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
    TaskRunSessionCreate,
    TaskRunSessionResponse,
    TaskRunSessionUpdate,
    TaskRunUpdate,
)
from app.services.task_run.session_service import TaskRunSessionService
from app.services.task_run.task_run_service import TaskRunService

__all__ = [
    # Services
    "TaskRunService",
    "TaskRunSessionService",
    "TaskRunFindingService",
    "TaskRunAutomationService",
    # Request schemas
    "TaskRunCreate",
    "TaskRunUpdate",
    "TaskRunSessionCreate",
    "TaskRunSessionUpdate",
    "TaskRunFindingCreate",
    "TaskRunFindingUpdate",
    "TaskRunFindingsBatch",
    "TaskRunAutomationCreate",
    "TaskRunAutomationUpdate",
    # Response schemas
    "Pagination",
    "StepProgressResponse",
    "TaskRunResponse",
    "TaskRunSessionResponse",
    "TaskRunFindingResponse",
    "TaskRunAutomationResponse",
    "TaskRunDetail",
    "TaskRunListResponse",
    "TaskRunFindingsListResponse",
    # Mappers
    "_get_enum_value",
    "model_to_task_run_response",
    "model_to_session_response",
    "model_to_finding_response",
    "model_to_automation_response",
]
