"""
Repository layer for async SQLAlchemy operations.

This package provides the repository pattern implementation for database access,
offering a clean abstraction over SQLAlchemy async sessions with common CRUD
operations and type-safe generics.

Example usage:
    from app.repositories import BaseRepository
    from app.models import Project
    from app.schemas.project import ProjectCreate

    class ProjectRepository(BaseRepository[Project, ProjectCreate]):
        def __init__(self):
            super().__init__(Project)
"""

from app.repositories.action_execution import ActionExecutionRepository
from app.repositories.automation_session import (
    AutomationSessionRepository,
    automation_session_repository,
)
from app.repositories.base import BaseRepository
from app.repositories.evaluation import EvaluationRepository
from app.repositories.execution_issue import ExecutionIssueRepository
from app.repositories.execution_run import ExecutionRunRepository
from app.repositories.execution_screenshot import ExecutionScreenshotRepository
from app.repositories.execution_tree_event import ExecutionTreeEventRepository
from app.repositories.feedback_score import FeedbackScoreRepository
from app.repositories.prompt_version import PromptVersionRepository
from app.repositories.test_run import CoverageRepository, TestRunRepository
from app.repositories.training_dataset import (
    TrainingDatasetRepository,
    training_dataset_repository,
)

__all__ = [
    "ActionExecutionRepository",
    "AutomationSessionRepository",
    "automation_session_repository",
    "BaseRepository",
    "EvaluationRepository",
    "CoverageRepository",
    "ExecutionIssueRepository",
    "ExecutionRunRepository",
    "ExecutionScreenshotRepository",
    "FeedbackScoreRepository",
    "ExecutionTreeEventRepository",
    "TestRunRepository",
    "PromptVersionRepository",
    "TrainingDatasetRepository",
    "training_dataset_repository",
]
