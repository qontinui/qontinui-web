"""
Service for deficiency management operations.

Handles deficiency listing, updates, comments, and related operations.
Separates business logic from HTTP handling.
"""

from typing import Any
from uuid import UUID, uuid4

import structlog
from app.models.software_test_run import SoftwareTestRun
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    TestDeficiency,
)
from app.models.user import User
from app.schemas.testing import DeficiencyCommentCreate, DeficiencyUpdate
from qontinui_schemas.common import utc_now
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class DeficiencyNotFoundError(Exception):
    """Raised when a deficiency is not found."""


# Status string to enum mappings
DEFICIENCY_STATUS_MAP = {
    "open": DeficiencyStatus.NEW,
    "new": DeficiencyStatus.NEW,
    "in_progress": DeficiencyStatus.IN_PROGRESS,
    "resolved": DeficiencyStatus.RESOLVED,
    "closed": DeficiencyStatus.CLOSED,
    "wont_fix": DeficiencyStatus.WONT_FIX,
}

DEFICIENCY_SEVERITY_MAP = {
    "critical": DeficiencySeverity.CRITICAL,
    "high": DeficiencySeverity.HIGH,
    "medium": DeficiencySeverity.MEDIUM,
    "low": DeficiencySeverity.LOW,
    "informational": DeficiencySeverity.INFO,
}


class DeficiencyManagementService:
    """Service for deficiency management operations."""

    async def get_deficiency_with_access(
        self,
        db: AsyncSession,
        deficiency_id: UUID,
        verify_access_callback: Any,
    ) -> TestDeficiency:
        """
        Get deficiency and verify user has access via callback.

        Args:
            db: Database session
            deficiency_id: Deficiency ID
            verify_access_callback: Async callback to verify project access

        Returns:
            TestDeficiency if found and accessible

        Raises:
            DeficiencyNotFoundError: Deficiency not found
        """
        result = await db.execute(
            select(TestDeficiency).filter(TestDeficiency.id == deficiency_id)
        )
        deficiency = result.scalar_one_or_none()

        if not deficiency:
            raise DeficiencyNotFoundError(f"Deficiency {deficiency_id} not found")

        # Verify access through the test run
        await verify_access_callback(db, deficiency.test_run_id)

        return deficiency

    async def list_deficiencies(
        self,
        db: AsyncSession,
        project_id: UUID,
        deficiency_status: str | None = None,
        severity: str | None = None,
        deficiency_type: str | None = None,
        run_id: UUID | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> tuple[list[TestDeficiency], int, dict[str, Any]]:
        """
        List deficiencies with filtering and pagination.

        Args:
            db: Database session
            project_id: Project ID to filter by
            deficiency_status: Optional status filter
            severity: Optional severity filter
            deficiency_type: Optional type filter
            run_id: Optional test run filter
            search: Optional text search
            limit: Page size
            offset: Pagination offset
            sort_by: Sort field
            sort_order: Sort direction

        Returns:
            Tuple of (deficiencies, total_count, summary_stats)
        """
        from app.models.test_deficiency import DeficiencyType

        logger.info(
            "listing_deficiencies",
            project_id=str(project_id),
            status=deficiency_status,
            severity=severity,
        )

        # Build subquery for test runs in this project
        project_runs = select(SoftwareTestRun.id).filter(
            SoftwareTestRun.project_id == project_id
        )

        # Build query
        query = select(TestDeficiency).filter(
            TestDeficiency.test_run_id.in_(project_runs)
        )

        # Apply filters
        if deficiency_status and deficiency_status in DEFICIENCY_STATUS_MAP:
            query = query.filter(
                TestDeficiency.status == DEFICIENCY_STATUS_MAP[deficiency_status]
            )

        if severity and severity in DEFICIENCY_SEVERITY_MAP:
            query = query.filter(
                TestDeficiency.severity == DEFICIENCY_SEVERITY_MAP[severity]
            )

        if deficiency_type:
            type_map = {
                "functional_bug": DeficiencyType.FUNCTIONAL,
                "ui_issue": DeficiencyType.VISUAL,
                "performance": DeficiencyType.PERFORMANCE,
                "crash": DeficiencyType.CRASH,
                "security": DeficiencyType.SECURITY,
                "accessibility": DeficiencyType.ACCESSIBILITY,
            }
            if deficiency_type in type_map:
                query = query.filter(
                    TestDeficiency.deficiency_type == type_map[deficiency_type]
                )

        if run_id:
            query = query.filter(TestDeficiency.test_run_id == run_id)

        if search:
            query = query.filter(
                or_(
                    TestDeficiency.title.ilike(f"%{search}%"),
                    TestDeficiency.description.ilike(f"%{search}%"),
                )
            )

        # Get total count
        count_query = select(func.count(TestDeficiency.id)).filter(
            TestDeficiency.test_run_id.in_(project_runs)
        )
        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # Apply sorting
        sort_column = getattr(TestDeficiency, sort_by, TestDeficiency.created_at)
        if sort_order == "desc":
            query = query.order_by(sort_column.desc())
        else:
            query = query.order_by(sort_column.asc())

        # Apply pagination
        query = query.limit(limit).offset(offset)
        result = await db.execute(query)
        deficiencies = list(result.scalars().all())

        # Calculate summary statistics
        summary = await self._calculate_summary_stats(db, project_runs)

        return deficiencies, total, summary

    async def _calculate_summary_stats(
        self, db: AsyncSession, project_runs: Any
    ) -> dict[str, Any]:
        """Calculate summary statistics for deficiencies."""
        summary_result = await db.execute(
            select(
                TestDeficiency.status,
                TestDeficiency.severity,
                func.count(TestDeficiency.id),
            )
            .filter(TestDeficiency.test_run_id.in_(project_runs))
            .group_by(TestDeficiency.status, TestDeficiency.severity)
        )
        summary_rows = summary_result.all()

        by_status: dict[str, int] = {}
        by_severity: dict[str, int] = {}
        total_count = 0

        for row in summary_rows:
            status_val = str(row[0]) if row[0] else "unknown"
            severity_val = str(row[1]) if row[1] else "unknown"
            count = row[2]
            total_count += count
            by_status[status_val] = by_status.get(status_val, 0) + count
            by_severity[severity_val] = by_severity.get(severity_val, 0) + count

        return {
            "total_deficiencies": total_count,
            "by_status": by_status,
            "by_severity": by_severity,
        }

    async def get_deficiency_detail(
        self,
        db: AsyncSession,
        deficiency: TestDeficiency,
    ) -> dict[str, Any]:
        """
        Get detailed deficiency information.

        Args:
            db: Database session
            deficiency: The deficiency model

        Returns:
            Dictionary with detailed deficiency data
        """
        # Get assigned user info if assigned
        assigned_to_info = None
        if deficiency.assigned_to_user_id:
            user_result = await db.execute(
                select(User).filter(User.id == deficiency.assigned_to_user_id)  # type: ignore[arg-type]
            )
            assigned_user = user_result.scalar_one_or_none()
            if assigned_user:
                assigned_to_info = {
                    "user_id": str(assigned_user.id),
                    "email": assigned_user.email,
                }

        return {
            "deficiency_id": deficiency.id,
            "run_id": deficiency.test_run_id,
            "title": deficiency.title,
            "description": deficiency.description,
            "severity": deficiency.severity,
            "status": deficiency.status,
            "deficiency_type": deficiency.deficiency_type,
            "state": None,
            "transition_sequence_number": None,
            "screenshot_count": (
                len(deficiency.screenshot_urls) if deficiency.screenshot_urls else 0
            ),
            "created_at": deficiency.created_at,
            "updated_at": deficiency.updated_at,
            "reproduction_steps": deficiency.reproduction_steps,
            "screenshots": deficiency.screenshot_urls,
            "metadata": deficiency.custom_fields,
            "assigned_to": assigned_to_info,
            "resolution_notes": deficiency.resolution,
            "run_info": None,
            "comments": [],
        }

    async def update_deficiency(
        self,
        db: AsyncSession,
        deficiency: TestDeficiency,
        update_in: DeficiencyUpdate,
    ) -> TestDeficiency:
        """
        Update a deficiency.

        Args:
            db: Database session
            deficiency: The deficiency to update
            update_in: Update data

        Returns:
            Updated TestDeficiency
        """
        logger.info(
            "updating_deficiency",
            deficiency_id=str(deficiency.id),
            updates=update_in.model_dump(exclude_unset=True),
        )

        # Apply updates
        if update_in.status is not None and update_in.status in DEFICIENCY_STATUS_MAP:
            deficiency.status = DEFICIENCY_STATUS_MAP[update_in.status]
            if update_in.status == "resolved":
                deficiency.resolved_at = utc_now()

        if (
            update_in.severity is not None
            and update_in.severity in DEFICIENCY_SEVERITY_MAP
        ):
            deficiency.severity = DEFICIENCY_SEVERITY_MAP[update_in.severity]

        if update_in.assigned_to_user_id is not None:
            deficiency.assigned_to_user_id = update_in.assigned_to_user_id
            deficiency.assigned_at = utc_now()

        if update_in.resolution_notes is not None:
            deficiency.resolution = update_in.resolution_notes

        deficiency.updated_at = utc_now()

        await db.commit()
        await db.refresh(deficiency)

        return deficiency

    async def add_comment(
        self,
        db: AsyncSession,
        deficiency: TestDeficiency,
        comment_in: DeficiencyCommentCreate,
        user: User,
    ) -> tuple[UUID, dict[str, Any]]:
        """
        Add a comment to a deficiency.

        Args:
            db: Database session
            deficiency: The deficiency to comment on
            comment_in: Comment data
            user: User adding the comment

        Returns:
            Tuple of (comment_id, comment_data)
        """
        logger.info(
            "adding_deficiency_comment",
            user_id=str(user.id),
            deficiency_id=str(deficiency.id),
        )

        # Generate unique comment ID
        comment_id = uuid4()

        # Create comment structure
        new_comment = {
            "id": str(comment_id),
            "user_id": str(user.id),
            "user_email": user.email,
            "user_full_name": getattr(user, "full_name", None),
            "comment": comment_in.comment,
            "metadata": comment_in.metadata,
            "created_at": utc_now().isoformat(),
        }

        # Store comments in custom_fields under "comments" key
        custom_fields = (
            dict(deficiency.custom_fields) if deficiency.custom_fields else {}
        )
        comments = custom_fields.get("comments", [])
        comments.append(new_comment)
        custom_fields["comments"] = comments

        # Update the deficiency
        deficiency.custom_fields = custom_fields
        deficiency.updated_at = utc_now()
        await db.commit()
        await db.refresh(deficiency)

        logger.info(
            "deficiency_comment_added",
            user_id=str(user.id),
            deficiency_id=str(deficiency.id),
            comment_id=str(comment_id),
        )

        return comment_id, new_comment


# Singleton instance
deficiency_management_service = DeficiencyManagementService()
