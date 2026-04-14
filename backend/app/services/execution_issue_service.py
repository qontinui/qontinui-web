"""
Service for execution issue business logic.

Handles issue creation, updates, and response mapping.
Separates business logic from HTTP handling.
"""

from typing import Any
from uuid import UUID

import structlog
from app.models.execution_issue import (ExecutionIssue, ExecutionIssueSeverity,
                                        ExecutionIssueSource,
                                        ExecutionIssueStatus,
                                        ExecutionIssueType)
from app.repositories.action_execution import ActionExecutionRepository
from app.repositories.execution_issue import ExecutionIssueRepository
from app.repositories.execution_screenshot import ExecutionScreenshotRepository
from app.services.execution_screenshot_service import \
    model_to_screenshot_response
# Import schemas from qontinui-schemas
from qontinui_schemas.api.execution import (ExecutionIssueBatch,
                                            ExecutionIssueBatchResponse,
                                            ExecutionIssueDetail,
                                            ExecutionIssueListResponse,
                                            ExecutionIssueResponse,
                                            ExecutionIssueUpdate,
                                            IssueSeverity, IssueSource,
                                            IssueStatus, IssueType, Pagination)
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


def _map_issue_type_to_model(issue_type: IssueType) -> ExecutionIssueType:
    """Map schema IssueType to model ExecutionIssueType."""
    mapping = {
        IssueType.VISUAL: ExecutionIssueType.VISUAL_REGRESSION,
        IssueType.ELEMENT_NOT_FOUND: ExecutionIssueType.ELEMENT_NOT_FOUND,
        IssueType.STATE_MISMATCH: ExecutionIssueType.STATE_MISMATCH,
        IssueType.TIMEOUT: ExecutionIssueType.TIMEOUT,
        IssueType.ASSERTION: ExecutionIssueType.ASSERTION_FAILED,
        IssueType.CRASH: ExecutionIssueType.SCRIPT_ERROR,
        IssueType.PERFORMANCE: ExecutionIssueType.PERFORMANCE,
        IssueType.OTHER: ExecutionIssueType.OTHER,
    }
    return mapping.get(issue_type, ExecutionIssueType.OTHER)


def _map_issue_severity_to_model(severity: IssueSeverity) -> ExecutionIssueSeverity:
    """Map schema IssueSeverity to model ExecutionIssueSeverity."""
    mapping = {
        IssueSeverity.CRITICAL: ExecutionIssueSeverity.CRITICAL,
        IssueSeverity.HIGH: ExecutionIssueSeverity.HIGH,
        IssueSeverity.MEDIUM: ExecutionIssueSeverity.MEDIUM,
        IssueSeverity.LOW: ExecutionIssueSeverity.LOW,
        IssueSeverity.INFO: ExecutionIssueSeverity.INFO,
    }
    return mapping.get(severity, ExecutionIssueSeverity.MEDIUM)


def _map_issue_source_to_model(source: IssueSource) -> ExecutionIssueSource:
    """Map schema IssueSource to model ExecutionIssueSource."""
    mapping = {
        IssueSource.AUTOMATION: ExecutionIssueSource.AUTOMATION,
        IssueSource.AI_ANALYSIS: ExecutionIssueSource.AI_ANALYSIS,
        IssueSource.VISUAL_REGRESSION: ExecutionIssueSource.VISUAL_REGRESSION,
        IssueSource.USER_REPORTED: ExecutionIssueSource.USER_REPORTED,
    }
    return mapping.get(source, ExecutionIssueSource.AUTOMATION)


def _map_issue_status_to_model(status: IssueStatus) -> ExecutionIssueStatus:
    """Map schema IssueStatus to model ExecutionIssueStatus."""
    mapping = {
        IssueStatus.NEW: ExecutionIssueStatus.OPEN,
        IssueStatus.OPEN: ExecutionIssueStatus.OPEN,
        IssueStatus.IN_PROGRESS: ExecutionIssueStatus.IN_PROGRESS,
        IssueStatus.RESOLVED: ExecutionIssueStatus.RESOLVED,
        IssueStatus.CLOSED: ExecutionIssueStatus.RESOLVED,
        IssueStatus.WONT_FIX: ExecutionIssueStatus.WONT_FIX,
    }
    return mapping.get(status, ExecutionIssueStatus.OPEN)


def model_to_issue_response(issue: ExecutionIssue) -> ExecutionIssueResponse:
    """Convert ExecutionIssue model to ExecutionIssueResponse schema."""
    screenshot_ids = (
        issue.screenshot_ids if isinstance(issue.screenshot_ids, list) else []
    )
    return ExecutionIssueResponse(
        id=issue.id,
        run_id=issue.run_id,
        issue_type=IssueType(
            issue.issue_type.value
            if hasattr(issue.issue_type, "value")
            else issue.issue_type
        ),
        severity=IssueSeverity(
            issue.severity.value if hasattr(issue.severity, "value") else issue.severity
        ),
        status=IssueStatus(
            issue.status.value if hasattr(issue.status, "value") else issue.status
        ),
        source=IssueSource(
            issue.source.value if hasattr(issue.source, "value") else issue.source
        ),
        title=issue.title,
        description=issue.description,
        state_name=issue.state_name,
        screenshot_count=len(screenshot_ids),
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


class ExecutionIssueService:
    """Service for execution issue operations."""

    def __init__(
        self,
        issue_repo: ExecutionIssueRepository,
        action_repo: ActionExecutionRepository,
        screenshot_repo: ExecutionScreenshotRepository,
    ) -> None:
        """Initialize with repositories."""
        self.issue_repo = issue_repo
        self.action_repo = action_repo
        self.screenshot_repo = screenshot_repo

    async def report_issues(
        self,
        db: AsyncSession,
        run_id: UUID,
        batch: ExecutionIssueBatch,
    ) -> ExecutionIssueBatchResponse:
        """
        Report a batch of issues for a run.

        Args:
            db: Database session
            run_id: ID of the execution run
            batch: Batch of issues to report

        Returns:
            ExecutionIssueBatchResponse with created issue IDs
        """
        issue_ids: list[UUID] = []

        for issue_data in batch.issues:
            # Get associated action if specified
            action_execution_id = None
            if issue_data.action_sequence_number is not None:
                action = await self.action_repo.get_by_run_and_sequence(
                    db, run_id, issue_data.action_sequence_number
                )
                if action:
                    action_execution_id = action.id

            issue = ExecutionIssue(
                run_id=run_id,
                action_execution_id=action_execution_id,
                issue_type=_map_issue_type_to_model(issue_data.issue_type),
                severity=_map_issue_severity_to_model(issue_data.severity),
                status=ExecutionIssueStatus.OPEN,
                source=_map_issue_source_to_model(issue_data.source),
                title=issue_data.title,
                description=issue_data.description,
                state_name=issue_data.state_name,
                screenshot_ids=[str(sid) for sid in (issue_data.screenshot_ids or [])],
                reproduction_steps=issue_data.reproduction_steps or [],
                error_details=issue_data.error_details or {},
                extra_metadata=issue_data.metadata or {},
            )
            created = await self.issue_repo.create(db, issue)
            issue_ids.append(created.id)

        await db.commit()

        logger.info(
            "issues_reported",
            run_id=str(run_id),
            count=len(issue_ids),
        )

        return ExecutionIssueBatchResponse(
            run_id=run_id,
            issues_recorded=len(batch.issues),
            issue_ids=issue_ids,
        )

    async def list_for_run(
        self,
        db: AsyncSession,
        run_id: UUID,
        severity: IssueSeverity | None = None,
        issue_type: IssueType | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> ExecutionIssueListResponse:
        """
        List issues for a run with optional filtering.

        Args:
            db: Database session
            run_id: ID of the execution run
            severity: Optional filter by severity
            issue_type: Optional filter by type
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            ExecutionIssueListResponse with issues and summary
        """
        model_severity = _map_issue_severity_to_model(severity) if severity else None
        model_type = _map_issue_type_to_model(issue_type) if issue_type else None

        issues, total = await self.issue_repo.list_for_run(
            db,
            run_id,
            severity=model_severity,
            issue_type=model_type,
            offset=offset,
            limit=limit,
        )

        # Get all issues for summary calculation
        all_issues = await self.issue_repo.get_all_for_run(db, run_id)
        summary = self.issue_repo.calculate_summary(all_issues)

        return ExecutionIssueListResponse(
            issues=[model_to_issue_response(i) for i in issues],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=offset + limit < total,
            ),
            summary=summary,
        )

    async def list_all(
        self,
        db: AsyncSession,
        project_id: UUID | None = None,
        run_id: UUID | None = None,
        severity: IssueSeverity | None = None,
        status_filter: IssueStatus | None = None,
        issue_type: IssueType | None = None,
        source: IssueSource | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> ExecutionIssueListResponse:
        """
        List all issues across runs with optional filtering.

        Args:
            db: Database session
            project_id: Optional filter by project ID
            run_id: Optional filter by run ID
            severity: Optional filter by severity
            status_filter: Optional filter by status
            issue_type: Optional filter by type
            source: Optional filter by source
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            ExecutionIssueListResponse with issues and summary
        """
        model_severity = _map_issue_severity_to_model(severity) if severity else None
        model_status = (
            _map_issue_status_to_model(status_filter) if status_filter else None
        )
        model_type = _map_issue_type_to_model(issue_type) if issue_type else None
        model_source = _map_issue_source_to_model(source) if source else None

        issues, total = await self.issue_repo.list_all(
            db,
            project_id=project_id,
            run_id=run_id,
            severity=model_severity,
            status=model_status,
            issue_type=model_type,
            source=model_source,
            offset=offset,
            limit=limit,
        )

        # Calculate summary from returned issues
        summary: dict[str, Any] = {"by_severity": {}, "by_status": {}, "by_type": {}}
        for sev in ExecutionIssueSeverity:
            summary["by_severity"][sev.value] = 0
        for stat in ExecutionIssueStatus:
            summary["by_status"][stat.value] = 0
        for typ in ExecutionIssueType:
            summary["by_type"][typ.value] = 0

        for issue in issues:
            if hasattr(issue.severity, "value"):
                summary["by_severity"][issue.severity.value] = (
                    summary["by_severity"].get(issue.severity.value, 0) + 1
                )
            if hasattr(issue.status, "value"):
                summary["by_status"][issue.status.value] = (
                    summary["by_status"].get(issue.status.value, 0) + 1
                )
            if hasattr(issue.issue_type, "value"):
                summary["by_type"][issue.issue_type.value] = (
                    summary["by_type"].get(issue.issue_type.value, 0) + 1
                )

        return ExecutionIssueListResponse(
            issues=[model_to_issue_response(i) for i in issues],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=offset + limit < total,
            ),
            summary=summary,
        )

    async def get_detail(
        self,
        db: AsyncSession,
        issue_id: UUID,
    ) -> ExecutionIssueDetail | None:
        """
        Get detailed information about an issue.

        Args:
            db: Database session
            issue_id: ID of the issue

        Returns:
            ExecutionIssueDetail or None if not found
        """
        issue = await self.issue_repo.get_by_id(db, issue_id)
        if not issue:
            return None

        # Get associated screenshots
        screenshot_ids = (
            issue.screenshot_ids if isinstance(issue.screenshot_ids, list) else []
        )
        screenshot_uuids = []
        for sid in screenshot_ids:
            try:
                screenshot_uuids.append(UUID(str(sid)))
            except (ValueError, TypeError):
                pass

        screenshots = []
        if screenshot_uuids:
            screenshot_models = await self.screenshot_repo.get_by_ids(
                db, screenshot_uuids
            )
            screenshots = [model_to_screenshot_response(s) for s in screenshot_models]

        return ExecutionIssueDetail(
            id=issue.id,
            run_id=issue.run_id,
            issue_type=IssueType(
                issue.issue_type.value
                if hasattr(issue.issue_type, "value")
                else issue.issue_type
            ),
            severity=IssueSeverity(
                issue.severity.value
                if hasattr(issue.severity, "value")
                else issue.severity
            ),
            status=IssueStatus(
                issue.status.value if hasattr(issue.status, "value") else issue.status
            ),
            source=IssueSource(
                issue.source.value if hasattr(issue.source, "value") else issue.source
            ),
            title=issue.title,
            description=issue.description,
            state_name=issue.state_name,
            screenshot_count=len(screenshots),
            created_at=issue.created_at,
            updated_at=issue.updated_at,
            action_sequence_number=None,  # Would need to query action
            reproduction_steps=(
                issue.reproduction_steps
                if isinstance(issue.reproduction_steps, list)
                else []
            ),
            screenshots=screenshots,
            error_details=(
                issue.error_details if isinstance(issue.error_details, dict) else {}
            ),
            metadata=(
                issue.extra_metadata if isinstance(issue.extra_metadata, dict) else {}
            ),
            assigned_to=None,  # Would need to query user
            resolution_notes=issue.resolution_notes,
        )

    async def update_issue(
        self,
        db: AsyncSession,
        issue_id: UUID,
        update_data: ExecutionIssueUpdate,
    ) -> ExecutionIssueResponse | None:
        """
        Update an issue.

        Args:
            db: Database session
            issue_id: ID of the issue to update
            update_data: Update data

        Returns:
            Updated ExecutionIssueResponse or None if not found
        """
        issue = await self.issue_repo.get_by_id(db, issue_id)
        if not issue:
            return None

        # Apply updates
        if update_data.status is not None:
            issue.status = _map_issue_status_to_model(update_data.status)
        if update_data.severity is not None:
            issue.severity = _map_issue_severity_to_model(update_data.severity)
        if update_data.assigned_to_user_id is not None:
            issue.assigned_to_user_id = update_data.assigned_to_user_id
        if update_data.resolution_notes is not None:
            issue.resolution_notes = update_data.resolution_notes

        issue.updated_at = utc_now()

        await self.issue_repo.update(db, issue)

        logger.info(
            "issue_updated",
            issue_id=str(issue_id),
            status=(
                issue.status.value if hasattr(issue.status, "value") else issue.status
            ),
        )

        return model_to_issue_response(issue)
