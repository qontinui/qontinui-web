"""
Service for Known Issue business logic.

Handles CRUD, filtering, resolution, and stats aggregation for known issues.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.known_issue import KnownIssue

logger = structlog.get_logger(__name__)


# =============================================================================
# Request/Response Schemas
# =============================================================================


class KnownIssueCreate(BaseModel):
    """Request to create a known issue."""

    title: str = Field(..., max_length=500)
    description: str
    category: str = Field(default="other", max_length=50)
    severity: str = Field(default="medium", max_length=20)
    status: str = Field(default="active", max_length=20)
    scope_type: str = Field(default="global", max_length=50)
    scope_value: str | None = None
    scope_tags: list[str] = Field(default_factory=list)
    detection_method: str = Field(default="ai_judgment", max_length=50)
    detection_config: dict[str, Any] = Field(default_factory=dict)
    pattern_template_id: str | None = None
    reproduction_context: str | None = None
    trigger_conditions: list[Any] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    provenance: str = Field(default="manual", max_length=50)
    source_finding_ids: list[str] = Field(default_factory=list)
    source_task_run_id: str | None = None
    verification_hint: str | None = None
    verification_step_template: dict[str, Any] | None = None
    times_detected: int = Field(default=1, ge=0)
    times_checked: int = Field(default=0, ge=0)
    last_detected_at: datetime | None = None
    last_checked_at: datetime | None = None


class KnownIssueUpdate(BaseModel):
    """Request to update a known issue. All fields optional."""

    title: str | None = Field(default=None, max_length=500)
    description: str | None = None
    category: str | None = Field(default=None, max_length=50)
    severity: str | None = Field(default=None, max_length=20)
    status: str | None = Field(default=None, max_length=20)
    scope_type: str | None = Field(default=None, max_length=50)
    scope_value: str | None = None
    scope_tags: list[str] | None = None
    detection_method: str | None = Field(default=None, max_length=50)
    detection_config: dict[str, Any] | None = None
    pattern_template_id: str | None = None
    reproduction_context: str | None = None
    trigger_conditions: list[Any] | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    provenance: str | None = Field(default=None, max_length=50)
    source_finding_ids: list[str] | None = None
    source_task_run_id: str | None = None
    verification_hint: str | None = None
    verification_step_template: dict[str, Any] | None = None
    times_detected: int | None = Field(default=None, ge=0)
    times_checked: int | None = Field(default=None, ge=0)
    last_detected_at: datetime | None = None
    last_checked_at: datetime | None = None


class KnownIssueResponse(BaseModel):
    """Response for a known issue."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    created_by_user_id: UUID
    title: str
    description: str
    category: str
    severity: str
    status: str
    scope_type: str
    scope_value: str | None
    scope_tags: list[str]
    detection_method: str
    detection_config: dict[str, Any]
    pattern_template_id: str | None
    reproduction_context: str | None
    trigger_conditions: list[Any]
    confidence: float
    provenance: str
    source_finding_ids: list[str]
    source_task_run_id: str | None
    verification_hint: str | None
    verification_step_template: dict[str, Any] | None
    times_detected: int
    times_checked: int
    last_detected_at: datetime | None
    last_checked_at: datetime | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class KnownIssueListQuery(BaseModel):
    """Query parameters for listing known issues."""

    status: str | None = None
    category: str | None = None
    severity: str | None = None
    scope_type: str | None = None
    scope_value: str | None = None
    provenance: str | None = None
    search: str | None = None
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=200)


class KnownIssueListResponse(BaseModel):
    """Paginated list of known issues."""

    items: list[KnownIssueResponse]
    pagination: dict


class KnownIssueStats(BaseModel):
    """Aggregated stats for known issues."""

    total: int
    by_status: dict[str, int]
    by_severity: dict[str, int]
    by_category: dict[str, int]


class ResolveRequest(BaseModel):
    """Request body for resolving an issue."""

    resolution_notes: str | None = None


# =============================================================================
# Service
# =============================================================================


class KnownIssueService:
    """Service for known issue business logic."""

    async def create_known_issue(
        self,
        db: AsyncSession,
        organization_id: UUID,
        user_id: UUID,
        data: KnownIssueCreate,
    ) -> KnownIssueResponse:
        """Create a new known issue."""
        issue = KnownIssue(
            organization_id=organization_id,
            created_by_user_id=user_id,
            **data.model_dump(),
        )
        db.add(issue)
        await db.commit()
        await db.refresh(issue)

        logger.info(
            "known_issue_created",
            issue_id=str(issue.id),
            title=data.title,
            category=data.category,
            severity=data.severity,
            user_id=str(user_id),
        )

        return KnownIssueResponse.model_validate(issue)

    async def get_known_issue(
        self,
        db: AsyncSession,
        organization_id: UUID,
        issue_id: UUID,
    ) -> KnownIssueResponse:
        """Get a single known issue by ID."""
        result = await db.execute(
            select(KnownIssue).where(
                KnownIssue.id == issue_id,
                KnownIssue.organization_id == organization_id,
            )
        )
        issue = result.scalar_one_or_none()
        if not issue:
            raise HTTPException(status_code=404, detail="Known issue not found")
        return KnownIssueResponse.model_validate(issue)

    async def list_known_issues(
        self,
        db: AsyncSession,
        organization_id: UUID,
        query: KnownIssueListQuery,
    ) -> KnownIssueListResponse:
        """List known issues with optional filters."""
        base = select(KnownIssue).where(KnownIssue.organization_id == organization_id)

        if query.status:
            base = base.where(KnownIssue.status == query.status)
        if query.category:
            base = base.where(KnownIssue.category == query.category)
        if query.severity:
            base = base.where(KnownIssue.severity == query.severity)
        if query.scope_type:
            base = base.where(KnownIssue.scope_type == query.scope_type)
        if query.scope_value:
            base = base.where(KnownIssue.scope_value == query.scope_value)
        if query.provenance:
            base = base.where(KnownIssue.provenance == query.provenance)
        if query.search:
            search_term = f"%{query.search}%"
            base = base.where(
                KnownIssue.title.ilike(search_term)
                | KnownIssue.description.ilike(search_term)
            )

        # Count total
        count_query = select(func.count()).select_from(base.subquery())
        total = (await db.execute(count_query)).scalar_one()

        # Fetch page
        items_query = (
            base.order_by(KnownIssue.created_at.desc())
            .offset(query.offset)
            .limit(query.limit)
        )
        result = await db.execute(items_query)
        items = list(result.scalars().all())

        return KnownIssueListResponse(
            items=[KnownIssueResponse.model_validate(i) for i in items],
            pagination={
                "total": total,
                "limit": query.limit,
                "offset": query.offset,
                "has_more": (query.offset + query.limit) < total,
            },
        )

    async def update_known_issue(
        self,
        db: AsyncSession,
        organization_id: UUID,
        issue_id: UUID,
        data: KnownIssueUpdate,
    ) -> KnownIssueResponse:
        """Update an existing known issue."""
        result = await db.execute(
            select(KnownIssue).where(
                KnownIssue.id == issue_id,
                KnownIssue.organization_id == organization_id,
            )
        )
        issue = result.scalar_one_or_none()
        if not issue:
            raise HTTPException(status_code=404, detail="Known issue not found")

        update_fields = data.model_dump(exclude_unset=True)
        for field, value in update_fields.items():
            setattr(issue, field, value)

        await db.commit()
        await db.refresh(issue)

        logger.info(
            "known_issue_updated",
            issue_id=str(issue_id),
            updated_fields=list(update_fields.keys()),
        )

        return KnownIssueResponse.model_validate(issue)

    async def delete_known_issue(
        self,
        db: AsyncSession,
        organization_id: UUID,
        issue_id: UUID,
    ) -> None:
        """Delete a known issue."""
        result = await db.execute(
            select(KnownIssue).where(
                KnownIssue.id == issue_id,
                KnownIssue.organization_id == organization_id,
            )
        )
        issue = result.scalar_one_or_none()
        if not issue:
            raise HTTPException(status_code=404, detail="Known issue not found")

        await db.delete(issue)
        await db.commit()

        logger.info("known_issue_deleted", issue_id=str(issue_id))

    async def resolve_known_issue(
        self,
        db: AsyncSession,
        organization_id: UUID,
        issue_id: UUID,
        data: ResolveRequest,
    ) -> KnownIssueResponse:
        """Resolve a known issue."""
        result = await db.execute(
            select(KnownIssue).where(
                KnownIssue.id == issue_id,
                KnownIssue.organization_id == organization_id,
            )
        )
        issue = result.scalar_one_or_none()
        if not issue:
            raise HTTPException(status_code=404, detail="Known issue not found")

        issue.status = "resolved"
        issue.resolved_at = datetime.now(UTC)

        await db.commit()
        await db.refresh(issue)

        logger.info("known_issue_resolved", issue_id=str(issue_id))

        return KnownIssueResponse.model_validate(issue)

    async def get_issue_stats(
        self,
        db: AsyncSession,
        organization_id: UUID,
    ) -> KnownIssueStats:
        """Get aggregated stats for known issues."""
        base = select(KnownIssue).where(KnownIssue.organization_id == organization_id)

        # Total
        total = (
            await db.execute(select(func.count()).select_from(base.subquery()))
        ).scalar_one()

        # By status
        status_query = (
            select(KnownIssue.status, func.count())
            .where(KnownIssue.organization_id == organization_id)
            .group_by(KnownIssue.status)
        )
        status_result = await db.execute(status_query)
        by_status = {row[0]: row[1] for row in status_result.all()}

        # By severity
        severity_query = (
            select(KnownIssue.severity, func.count())
            .where(KnownIssue.organization_id == organization_id)
            .group_by(KnownIssue.severity)
        )
        severity_result = await db.execute(severity_query)
        by_severity = {row[0]: row[1] for row in severity_result.all()}

        # By category
        category_query = (
            select(KnownIssue.category, func.count())
            .where(KnownIssue.organization_id == organization_id)
            .group_by(KnownIssue.category)
        )
        category_result = await db.execute(category_query)
        by_category = {row[0]: row[1] for row in category_result.all()}

        return KnownIssueStats(
            total=total,
            by_status=by_status,
            by_severity=by_severity,
            by_category=by_category,
        )
