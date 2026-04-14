"""
Repository for execution issue database operations.

Handles query logic for execution issues, encapsulating database access
and providing reusable methods for listing, filtering, and aggregation.
"""

from typing import Any
from uuid import UUID

import structlog
from app.models.execution_issue import (ExecutionIssue, ExecutionIssueSeverity,
                                        ExecutionIssueSource,
                                        ExecutionIssueStatus,
                                        ExecutionIssueType)
from app.models.execution_run import ExecutionRun
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ExecutionIssueRepository:
    """Repository for execution issue database operations."""

    @staticmethod
    async def list_for_run(
        db: AsyncSession,
        run_id: UUID,
        severity: ExecutionIssueSeverity | None = None,
        issue_type: ExecutionIssueType | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[ExecutionIssue], int]:
        """
        List issues for a run with optional filtering.

        Args:
            db: Database session
            run_id: ID of the execution run
            severity: Optional filter by severity
            issue_type: Optional filter by issue type
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            Tuple of (list of ExecutionIssue, total count)
        """
        query = select(ExecutionIssue).where(ExecutionIssue.run_id == run_id)

        if severity:
            query = query.where(ExecutionIssue.severity == severity)
        if issue_type:
            query = query.where(ExecutionIssue.issue_type == issue_type)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply ordering and pagination
        query = (
            query.order_by(ExecutionIssue.created_at.desc()).offset(offset).limit(limit)
        )

        result = await db.execute(query)
        issues = list(result.scalars().all())

        logger.debug(
            "list_for_run_executed",
            run_id=str(run_id),
            total=total,
            returned=len(issues),
        )

        return issues, total

    @staticmethod
    async def list_all(
        db: AsyncSession,
        project_id: UUID | None = None,
        run_id: UUID | None = None,
        severity: ExecutionIssueSeverity | None = None,
        status: ExecutionIssueStatus | None = None,
        issue_type: ExecutionIssueType | None = None,
        source: ExecutionIssueSource | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[ExecutionIssue], int]:
        """
        List all issues with optional filtering across runs.

        Args:
            db: Database session
            project_id: Optional filter by project ID
            run_id: Optional filter by run ID
            severity: Optional filter by severity
            status: Optional filter by status
            issue_type: Optional filter by issue type
            source: Optional filter by detection source
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            Tuple of (list of ExecutionIssue, total count)
        """
        query = select(ExecutionIssue).join(ExecutionRun)

        if project_id:
            query = query.where(ExecutionRun.project_id == project_id)
        if run_id:
            query = query.where(ExecutionIssue.run_id == run_id)
        if severity:
            query = query.where(ExecutionIssue.severity == severity)
        if status:
            query = query.where(ExecutionIssue.status == status)
        if issue_type:
            query = query.where(ExecutionIssue.issue_type == issue_type)
        if source:
            query = query.where(ExecutionIssue.source == source)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply ordering and pagination
        query = (
            query.order_by(ExecutionIssue.created_at.desc()).offset(offset).limit(limit)
        )

        result = await db.execute(query)
        issues = list(result.scalars().all())

        logger.debug(
            "list_all_executed",
            total=total,
            returned=len(issues),
        )

        return issues, total

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        issue_id: UUID,
    ) -> ExecutionIssue | None:
        """
        Get issue by ID.

        Args:
            db: Database session
            issue_id: ID of the issue

        Returns:
            ExecutionIssue or None if not found
        """
        query = select(ExecutionIssue).where(ExecutionIssue.id == issue_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_all_for_run(
        db: AsyncSession,
        run_id: UUID,
    ) -> list[ExecutionIssue]:
        """
        Get all issues for a run (for summary calculation).

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            List of all ExecutionIssue for the run
        """
        query = select(ExecutionIssue).where(ExecutionIssue.run_id == run_id)
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    def calculate_summary(issues: list[ExecutionIssue]) -> dict[str, Any]:
        """
        Calculate issue summary statistics.

        Args:
            issues: List of issues to summarize

        Returns:
            Dictionary with by_severity, by_status, by_type counts
        """
        summary: dict[str, Any] = {"by_severity": {}, "by_status": {}, "by_type": {}}

        for sev in ExecutionIssueSeverity:
            summary["by_severity"][sev.value] = sum(
                1 for i in issues if i.severity == sev
            )
        for stat in ExecutionIssueStatus:
            summary["by_status"][stat.value] = sum(
                1 for i in issues if i.status == stat
            )
        for typ in ExecutionIssueType:
            summary["by_type"][typ.value] = sum(
                1 for i in issues if i.issue_type == typ
            )

        return summary

    @staticmethod
    async def create(
        db: AsyncSession,
        issue: ExecutionIssue,
    ) -> ExecutionIssue:
        """
        Create a new issue record.

        Args:
            db: Database session
            issue: ExecutionIssue instance to create

        Returns:
            Created ExecutionIssue with populated ID
        """
        db.add(issue)
        await db.flush()

        logger.info(
            "issue_created",
            issue_id=str(issue.id),
            run_id=str(issue.run_id),
        )

        return issue

    @staticmethod
    async def update(
        db: AsyncSession,
        issue: ExecutionIssue,
    ) -> ExecutionIssue:
        """
        Update an existing issue.

        Args:
            db: Database session
            issue: ExecutionIssue instance with updates

        Returns:
            Updated ExecutionIssue
        """
        await db.commit()
        await db.refresh(issue)

        logger.info(
            "issue_updated",
            issue_id=str(issue.id),
        )

        return issue
