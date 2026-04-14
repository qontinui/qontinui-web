"""
CRUD operations for detected issues.

Provides database operations for issues detected during AI-assisted automation.
"""

from datetime import UTC, datetime
from uuid import UUID

from app.models.detected_issue import DetectedIssue
from app.schemas.detected_issue import (
    DetectedIssueCreate,
    DetectedIssueUpdate,
    IssueStats,
    IssueSyncItem,
)
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def create_detected_issue(
    db: AsyncSession,
    user_id: UUID,
    issue_data: DetectedIssueCreate,
) -> DetectedIssue:
    """Create a new detected issue."""
    issue = DetectedIssue(
        session_id=issue_data.session_id,
        project_id=issue_data.project_id,
        user_id=user_id,
        type=issue_data.type,
        severity=issue_data.severity,
        title=issue_data.title,
        description=issue_data.description,
        file=issue_data.file,
        line=issue_data.line,
        source=issue_data.source.model_dump(),
        status="detected",
        detected_at=issue_data.detected_at,
    )
    db.add(issue)
    await db.commit()
    await db.refresh(issue)
    return issue


async def get_detected_issue(
    db: AsyncSession,
    issue_id: UUID,
) -> DetectedIssue | None:
    """Get a detected issue by ID."""
    result = await db.execute(
        select(DetectedIssue).filter(DetectedIssue.id == issue_id)
    )
    return result.scalar_one_or_none()


async def get_detected_issue_by_user(
    db: AsyncSession,
    issue_id: UUID,
    user_id: UUID,
) -> DetectedIssue | None:
    """Get a detected issue by ID, ensuring it belongs to the user."""
    result = await db.execute(
        select(DetectedIssue).filter(
            DetectedIssue.id == issue_id,
            DetectedIssue.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def list_detected_issues(
    db: AsyncSession,
    user_id: UUID,
    skip: int = 0,
    limit: int = 50,
    project_id: UUID | None = None,
    session_id: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    issue_type: str | None = None,
) -> tuple[list[DetectedIssue], int]:
    """
    List detected issues with filtering.

    Returns:
        tuple of (issues, total_count)
    """
    query = select(DetectedIssue).filter(DetectedIssue.user_id == user_id)

    if project_id:
        query = query.filter(DetectedIssue.project_id == project_id)

    if session_id:
        query = query.filter(DetectedIssue.session_id == session_id)

    if status:
        query = query.filter(DetectedIssue.status == status)

    if severity:
        query = query.filter(DetectedIssue.severity == severity)

    if issue_type:
        query = query.filter(DetectedIssue.type == issue_type)

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by detected_at descending (most recent first)
    query = query.order_by(desc(DetectedIssue.detected_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    issues = list(result.scalars().all())

    return issues, total


async def update_detected_issue(
    db: AsyncSession,
    issue_id: UUID,
    user_id: UUID,
    update_data: DetectedIssueUpdate,
) -> DetectedIssue | None:
    """Update a detected issue."""
    issue = await get_detected_issue_by_user(db, issue_id, user_id)
    if not issue:
        return None

    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        if value is not None:
            setattr(issue, key, value)

    # Set resolved_at if status changed to resolved
    if update_data.status == "resolved" and issue.resolved_at is None:
        issue.resolved_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(issue)
    return issue


async def delete_detected_issue(
    db: AsyncSession,
    issue_id: UUID,
    user_id: UUID,
) -> bool:
    """Delete a detected issue."""
    issue = await get_detected_issue_by_user(db, issue_id, user_id)
    if not issue:
        return False

    await db.delete(issue)
    await db.commit()
    return True


async def sync_issues(
    db: AsyncSession,
    user_id: UUID,
    project_id: UUID | None,
    issues: list[IssueSyncItem],
) -> tuple[int, int, list[str]]:
    """
    Sync issues from runner.

    Returns:
        tuple of (synced_count, updated_count, errors)
    """
    synced = 0
    updated = 0
    errors: list[str] = []

    for issue_data in issues:
        try:
            # Check if issue already exists by session_id and client ID
            # We use the client ID in the title as a marker for deduplication
            existing = await db.execute(
                select(DetectedIssue).filter(
                    DetectedIssue.user_id == user_id,
                    DetectedIssue.session_id == issue_data.session_id,
                    DetectedIssue.title == issue_data.title,
                    DetectedIssue.detected_at == issue_data.detected_at,
                )
            )
            existing_issue = existing.scalar_one_or_none()

            if existing_issue:
                # Update existing issue
                existing_issue.status = issue_data.status
                if issue_data.resolution:
                    existing_issue.resolution = issue_data.resolution
                if issue_data.resolved_at:
                    existing_issue.resolved_at = issue_data.resolved_at
                updated += 1
            else:
                # Create new issue
                new_issue = DetectedIssue(
                    session_id=issue_data.session_id,
                    project_id=project_id,
                    user_id=user_id,
                    type=issue_data.type,
                    severity=issue_data.severity,
                    title=issue_data.title,
                    description=issue_data.description,
                    file=issue_data.file,
                    line=issue_data.line,
                    source=issue_data.source.model_dump(),
                    status=issue_data.status,
                    resolution=issue_data.resolution,
                    detected_at=issue_data.detected_at,
                    resolved_at=issue_data.resolved_at,
                )
                db.add(new_issue)
                synced += 1

        except Exception as e:
            errors.append(f"Error syncing issue '{issue_data.title}': {str(e)}")

    await db.commit()
    return synced, updated, errors


async def get_issue_stats(
    db: AsyncSession,
    user_id: UUID,
    project_id: UUID | None = None,
) -> IssueStats:
    """Get aggregated issue statistics."""
    query = select(DetectedIssue).filter(DetectedIssue.user_id == user_id)

    if project_id:
        query = query.filter(DetectedIssue.project_id == project_id)

    result = await db.execute(query)
    issues = list(result.scalars().all())

    # Calculate stats
    by_status: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}

    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    resolved_today = 0
    detected_today = 0

    for issue in issues:
        # Count by status
        by_status[issue.status] = by_status.get(issue.status, 0) + 1

        # Count by severity
        by_severity[issue.severity] = by_severity.get(issue.severity, 0) + 1

        # Count by type
        by_type[issue.type] = by_type.get(issue.type, 0) + 1

        # Count today's activity
        if issue.detected_at and issue.detected_at >= today:
            detected_today += 1

        if issue.resolved_at and issue.resolved_at >= today:
            resolved_today += 1

    return IssueStats(
        total=len(issues),
        by_status=by_status,
        by_severity=by_severity,
        by_type=by_type,
        resolved_today=resolved_today,
        detected_today=detected_today,
    )
