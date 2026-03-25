"""
Repository dependency injection for FastAPI.

Provides cached repository instances using functools.lru_cache
for efficient singleton-like behavior within the application.
"""

from functools import lru_cache

from app.repositories.action_execution import ActionExecutionRepository
from app.repositories.admin_project import AdminProjectRepository
from app.repositories.admin_user import AdminUserRepository
from app.repositories.automation_session import AutomationSessionRepository
from app.repositories.download_analytics import DownloadAnalyticsRepository
from app.repositories.evaluation import EvaluationRepository
from app.repositories.execution_issue import ExecutionIssueRepository
from app.repositories.execution_run import ExecutionRunRepository
from app.repositories.execution_screenshot import ExecutionScreenshotRepository
from app.repositories.execution_tree_event import ExecutionTreeEventRepository
from app.repositories.feedback_score import FeedbackScoreRepository
from app.repositories.prompt_version import PromptVersionRepository
from app.repositories.test_run import CoverageRepository, TestRunRepository


@lru_cache
def get_test_run_repository() -> TestRunRepository:
    """
    Get the TestRunRepository singleton instance.

    Returns:
        TestRunRepository instance
    """
    return TestRunRepository()


@lru_cache
def get_coverage_repository() -> CoverageRepository:
    """
    Get the CoverageRepository singleton instance.

    Returns:
        CoverageRepository instance
    """
    return CoverageRepository()


@lru_cache
def get_automation_session_repository() -> AutomationSessionRepository:
    """
    Get the AutomationSessionRepository singleton instance.

    Returns:
        AutomationSessionRepository instance
    """
    return AutomationSessionRepository()


@lru_cache
def get_execution_run_repository() -> ExecutionRunRepository:
    """
    Get the ExecutionRunRepository singleton instance.

    Returns:
        ExecutionRunRepository instance
    """
    return ExecutionRunRepository()


@lru_cache
def get_action_execution_repository() -> ActionExecutionRepository:
    """
    Get the ActionExecutionRepository singleton instance.

    Returns:
        ActionExecutionRepository instance
    """
    return ActionExecutionRepository()


@lru_cache
def get_execution_screenshot_repository() -> ExecutionScreenshotRepository:
    """
    Get the ExecutionScreenshotRepository singleton instance.

    Returns:
        ExecutionScreenshotRepository instance
    """
    return ExecutionScreenshotRepository()


@lru_cache
def get_execution_issue_repository() -> ExecutionIssueRepository:
    """
    Get the ExecutionIssueRepository singleton instance.

    Returns:
        ExecutionIssueRepository instance
    """
    return ExecutionIssueRepository()


@lru_cache
def get_execution_tree_event_repository() -> ExecutionTreeEventRepository:
    """
    Get the ExecutionTreeEventRepository singleton instance.

    Returns:
        ExecutionTreeEventRepository instance
    """
    return ExecutionTreeEventRepository()


@lru_cache
def get_admin_user_repository() -> AdminUserRepository:
    """
    Get the AdminUserRepository singleton instance.

    Returns:
        AdminUserRepository instance
    """
    return AdminUserRepository()


@lru_cache
def get_admin_project_repository() -> AdminProjectRepository:
    """
    Get the AdminProjectRepository singleton instance.

    Returns:
        AdminProjectRepository instance
    """
    return AdminProjectRepository()


@lru_cache
def get_evaluation_repository() -> EvaluationRepository:
    """
    Get the EvaluationRepository singleton instance.

    Returns:
        EvaluationRepository instance
    """
    return EvaluationRepository()


@lru_cache
def get_feedback_score_repository() -> FeedbackScoreRepository:
    """
    Get the FeedbackScoreRepository singleton instance.

    Returns:
        FeedbackScoreRepository instance
    """
    return FeedbackScoreRepository()


@lru_cache
def get_download_analytics_repository() -> DownloadAnalyticsRepository:
    """
    Get the DownloadAnalyticsRepository singleton instance.

    Returns:
        DownloadAnalyticsRepository instance
    """
    return DownloadAnalyticsRepository()


@lru_cache
def get_prompt_version_repository() -> PromptVersionRepository:
    """
    Get the PromptVersionRepository singleton instance.

    Returns:
        PromptVersionRepository instance
    """
    return PromptVersionRepository()
