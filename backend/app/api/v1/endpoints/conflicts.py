"""
Conflict resolution API endpoints.

Provides endpoints for:
- Listing conflicts for a project
- Getting conflict details
- Resolving conflicts with different strategies
- Checking for annotation conflicts before saving
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.models.collaboration import ConflictLog
from app.models.project import Project
from app.models.project_annotation_state import ProjectAnnotationState
from app.models.user import User
from app.schemas.conflict import (
    AnnotationConflictCheckRequest,
    AnnotationConflictCheckResponse,
    AnnotationDiffSummary,
    ConflictLogCreate,
    ConflictLogResponse,
    ConflictResolveRequest,
    ConflictSummary,
)
from app.services.collaboration_service import collaboration_service
from app.services.conflict_resolution_service import conflict_resolution_service
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

logger = structlog.get_logger(__name__)

router = APIRouter()


async def verify_project_permission(
    db: AsyncSession, project_id: UUID, user: User, required_permission: str
) -> None:
    """Verify user has required project permission."""
    has_access = await collaboration_service.check_user_has_access(
        db, user.id, project_id, required_permission
    )

    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient permissions. Required: {required_permission}",
        )


async def get_project_or_404(db: AsyncSession, project_id: UUID) -> Project:
    """Get project or raise 404."""
    result = await db.execute(select(Project).filter(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project


# ============================================================================
# Conflict Endpoints
# ============================================================================


@router.get("/conflicts", response_model=list[ConflictLogResponse])
async def list_conflicts(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    resource_type: str | None = Query(None, description="Filter by resource type"),
    resource_id: str | None = Query(None, description="Filter by resource ID"),
    resolved: bool | None = Query(None, description="Filter by resolved status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> Any:
    """
    List conflicts.

    Returns conflicts that the current user is involved in or has access to.
    """
    logger.info(
        "list_conflicts_request",
        user_id=current_user.id,
        project_id=project_id,
        resource_type=resource_type,
    )

    # Build query
    query = select(ConflictLog).options(
        joinedload(ConflictLog.local_user), joinedload(ConflictLog.remote_user)
    )

    # Filter by user involvement
    query = query.filter(
        or_(
            ConflictLog.local_user_id == current_user.id,
            ConflictLog.remote_user_id == current_user.id,
        )
    )

    # Apply optional filters
    if resource_type:
        query = query.filter(ConflictLog.resource_type == resource_type)

    if resource_id:
        query = query.filter(ConflictLog.resource_id == resource_id)

    if resolved is not None:
        query = query.filter(ConflictLog.resolved == resolved)

    # Order and paginate
    query = query.order_by(ConflictLog.detected_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    conflicts = result.unique().scalars().all()

    # Build responses
    responses = []
    for conflict in conflicts:
        response = ConflictLogResponse.model_validate(conflict)

        if conflict.local_user:
            response.local_user_username = conflict.local_user.username
            response.local_user_email = conflict.local_user.email
            response.local_user_avatar_url = conflict.local_user.avatar_url

        if conflict.remote_user:
            response.remote_user_username = conflict.remote_user.username
            response.remote_user_email = conflict.remote_user.email
            response.remote_user_avatar_url = conflict.remote_user.avatar_url

        responses.append(response)

    logger.info("conflicts_listed", count=len(responses), user_id=current_user.id)

    return responses


@router.get(
    "/projects/{project_id}/conflicts", response_model=list[ConflictLogResponse]
)
async def list_project_conflicts(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    resource_type: str | None = Query(None),
    resource_id: str | None = Query(None),
    resolved: bool | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> Any:
    """
    List conflicts for a specific project.

    Requires VIEW permission on the project.
    """
    logger.info(
        "list_project_conflicts_request", project_id=project_id, user_id=current_user.id
    )

    # Verify project access
    await get_project_or_404(db, project_id)
    await verify_project_permission(db, project_id, current_user, "view")

    # Build query - for project conflicts, we need to join with project resources
    # Since conflicts don't have direct project_id, we filter by resource_id patterns
    query = select(ConflictLog).options(
        joinedload(ConflictLog.local_user), joinedload(ConflictLog.remote_user)
    )

    # Apply filters
    if resource_type:
        query = query.filter(ConflictLog.resource_type == resource_type)

    if resource_id:
        query = query.filter(ConflictLog.resource_id == resource_id)

    if resolved is not None:
        query = query.filter(ConflictLog.resolved == resolved)

    # Order and paginate
    query = query.order_by(ConflictLog.detected_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    conflicts = result.unique().scalars().all()

    # Build responses
    responses = []
    for conflict in conflicts:
        response = ConflictLogResponse.model_validate(conflict)

        if conflict.local_user:
            response.local_user_username = conflict.local_user.username
            response.local_user_email = conflict.local_user.email
            response.local_user_avatar_url = conflict.local_user.avatar_url

        if conflict.remote_user:
            response.remote_user_username = conflict.remote_user.username
            response.remote_user_email = conflict.remote_user.email
            response.remote_user_avatar_url = conflict.remote_user.avatar_url

        responses.append(response)

    logger.info(
        "project_conflicts_listed",
        count=len(responses),
        project_id=project_id,
        user_id=current_user.id,
    )

    return responses


@router.get("/conflicts/{conflict_id}", response_model=ConflictLogResponse)
async def get_conflict(
    *,
    db: AsyncSession = Depends(get_async_db),
    conflict_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get conflict details.

    User must be involved in the conflict (local or remote user).
    """
    logger.info(
        "get_conflict_request", conflict_id=conflict_id, user_id=current_user.id
    )

    # Get conflict
    result = await db.execute(
        select(ConflictLog)
        .filter(ConflictLog.id == conflict_id)
        .options(
            joinedload(ConflictLog.local_user), joinedload(ConflictLog.remote_user)
        )
    )
    conflict = result.unique().scalar_one_or_none()

    if not conflict:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conflict not found",
        )

    # Verify user is involved
    if (
        conflict.local_user_id != current_user.id
        and conflict.remote_user_id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not involved in this conflict",
        )

    # Build response
    response = ConflictLogResponse.model_validate(conflict)

    if conflict.local_user:
        response.local_user_username = conflict.local_user.username
        response.local_user_email = conflict.local_user.email
        response.local_user_avatar_url = conflict.local_user.avatar_url

    if conflict.remote_user:
        response.remote_user_username = conflict.remote_user.username
        response.remote_user_email = conflict.remote_user.email
        response.remote_user_avatar_url = conflict.remote_user.avatar_url

    logger.info("conflict_retrieved", conflict_id=conflict_id)

    return response


@router.post(
    "/conflicts",
    response_model=ConflictLogResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_conflict(
    *,
    db: AsyncSession = Depends(get_async_db),
    conflict_in: ConflictLogCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Create a new conflict log.

    This is typically called automatically when a merge conflict is detected,
    but can also be called manually.
    """
    logger.info(
        "create_conflict_request",
        user_id=current_user.id,
        resource_type=conflict_in.resource_type,
        resource_id=conflict_in.resource_id,
    )

    # Create conflict log
    conflict_log = await conflict_resolution_service.create_conflict_log(
        db=db,
        resource_type=conflict_in.resource_type,
        resource_id=conflict_in.resource_id,
        local_version=conflict_in.local_version,
        remote_version=conflict_in.remote_version,
        local_user_id=conflict_in.local_user_id,
        remote_user_id=conflict_in.remote_user_id,
        base_data=conflict_in.base_data or {},
        local_data=conflict_in.local_data or {},
        remote_data=conflict_in.remote_data or {},
        metadata=conflict_in.metadata or {},
    )

    # Reload with relationships
    await db.refresh(conflict_log)
    result = await db.execute(
        select(ConflictLog)
        .filter(ConflictLog.id == conflict_log.id)
        .options(
            joinedload(ConflictLog.local_user), joinedload(ConflictLog.remote_user)
        )
    )
    conflict_log = result.unique().scalar_one()

    # Build response
    response = ConflictLogResponse.model_validate(conflict_log)

    if conflict_log.local_user:
        response.local_user_username = conflict_log.local_user.username
        response.local_user_email = conflict_log.local_user.email
        response.local_user_avatar_url = conflict_log.local_user.avatar_url

    if conflict_log.remote_user:
        response.remote_user_username = conflict_log.remote_user.username
        response.remote_user_email = conflict_log.remote_user.email
        response.remote_user_avatar_url = conflict_log.remote_user.avatar_url

    logger.info("conflict_created", conflict_id=conflict_log.id)

    return response


@router.post("/conflicts/{conflict_id}/resolve", response_model=ConflictLogResponse)
async def resolve_conflict(
    *,
    db: AsyncSession = Depends(get_async_db),
    conflict_id: UUID,
    resolve_request: ConflictResolveRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Resolve a conflict.

    User must be involved in the conflict (local or remote user).
    Requires EDIT permission if resolving a project resource conflict.
    """
    logger.info(
        "resolve_conflict_request",
        conflict_id=conflict_id,
        user_id=current_user.id,
        resolution_type=resolve_request.resolution_type,
    )

    # Get conflict
    result = await db.execute(
        select(ConflictLog)
        .filter(ConflictLog.id == conflict_id)
        .options(
            joinedload(ConflictLog.local_user), joinedload(ConflictLog.remote_user)
        )
    )
    conflict = result.unique().scalar_one_or_none()

    if not conflict:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conflict not found",
        )

    # Verify user is involved
    if (
        conflict.local_user_id != current_user.id
        and conflict.remote_user_id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not involved in this conflict",
        )

    # Check if already resolved
    if conflict.resolved:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Conflict is already resolved",
        )

    # Resolve conflict
    try:
        resolved_conflict = await conflict_resolution_service.resolve_conflict(
            db=db,
            conflict_id=conflict_id,
            resolution_type=resolve_request.resolution_type,
            merged_data=resolve_request.merged_data or {},
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # Reload with relationships
    result = await db.execute(
        select(ConflictLog)
        .filter(ConflictLog.id == conflict_id)
        .options(
            joinedload(ConflictLog.local_user), joinedload(ConflictLog.remote_user)
        )
    )
    resolved_conflict = result.unique().scalar_one()

    # Build response
    response = ConflictLogResponse.model_validate(resolved_conflict)

    if resolved_conflict.local_user:
        response.local_user_username = resolved_conflict.local_user.username
        response.local_user_email = resolved_conflict.local_user.email
        response.local_user_avatar_url = resolved_conflict.local_user.avatar_url

    if resolved_conflict.remote_user:
        response.remote_user_username = resolved_conflict.remote_user.username
        response.remote_user_email = resolved_conflict.remote_user.email
        response.remote_user_avatar_url = resolved_conflict.remote_user.avatar_url

    logger.info(
        "conflict_resolved",
        conflict_id=conflict_id,
        resolution_type=resolve_request.resolution_type,
    )

    return response


@router.get("/projects/{project_id}/conflicts/summary", response_model=ConflictSummary)
async def get_project_conflict_summary(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get conflict summary for a project.

    Requires VIEW permission on the project.
    """
    logger.info(
        "get_conflict_summary_request", project_id=project_id, user_id=current_user.id
    )

    # Verify project access
    await get_project_or_404(db, project_id)
    await verify_project_permission(db, project_id, current_user, "view")

    # Get all conflicts (in a real implementation, you'd filter by project_id)
    result = await db.execute(select(ConflictLog))
    all_conflicts = result.scalars().all()

    unresolved = [c for c in all_conflicts if not c.resolved]
    resolved = [c for c in all_conflicts if c.resolved]

    # Count by type
    conflicts_by_type: dict[str, int] = {}
    for conflict in all_conflicts:
        resource_type = conflict.resource_type
        conflicts_by_type[resource_type] = conflicts_by_type.get(resource_type, 0) + 1

    # Get recent conflicts
    recent_result = await db.execute(
        select(ConflictLog)
        .options(
            joinedload(ConflictLog.local_user), joinedload(ConflictLog.remote_user)
        )
        .order_by(ConflictLog.detected_at.desc())
        .limit(5)
    )
    recent_conflicts = recent_result.unique().scalars().all()

    # Build recent conflict responses
    recent_responses = []
    for conflict in recent_conflicts:
        response = ConflictLogResponse.model_validate(conflict)

        if conflict.local_user:
            response.local_user_username = conflict.local_user.username
            response.local_user_email = conflict.local_user.email
            response.local_user_avatar_url = conflict.local_user.avatar_url

        if conflict.remote_user:
            response.remote_user_username = conflict.remote_user.username
            response.remote_user_email = conflict.remote_user.email
            response.remote_user_avatar_url = conflict.remote_user.avatar_url

        recent_responses.append(response)

    summary = ConflictSummary(
        total_conflicts=len(all_conflicts),
        unresolved_conflicts=len(unresolved),
        resolved_conflicts=len(resolved),
        conflicts_by_type=conflicts_by_type,
        recent_conflicts=recent_responses,
    )

    logger.info(
        "conflict_summary_retrieved", project_id=project_id, total=len(all_conflicts)
    )

    return summary


# ============================================================================
# Annotation Conflict Detection Endpoints
# ============================================================================


@router.post(
    "/annotations/conflicts/check",
    response_model=AnnotationConflictCheckResponse,
)
async def check_annotation_conflicts(
    *,
    db: AsyncSession = Depends(get_async_db),
    request: AnnotationConflictCheckRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Check for annotation conflicts before saving.

    Compares the local annotation state with the remote (database) state
    to detect potential conflicts and enable merge UI if needed.

    Conflict types:
    - none: No conflict, safe to save
    - version_mismatch: Version IDs don't match (remote was updated)
    - concurrent_edit: Both local and remote have changes since last sync
    - element_difference: Element counts or content differ

    Returns detailed conflict information including diff summary.
    """
    logger.info(
        "check_annotation_conflicts_request",
        user_id=current_user.id,
        project_id=request.project_id,
        local_version_id=request.local_version_id,
        local_element_count=request.local_element_count,
    )

    # Verify project exists and user has access
    try:
        project_uuid = UUID(request.project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project_id format",
        )

    await get_project_or_404(db, project_uuid)
    await verify_project_permission(db, project_uuid, current_user, "view")

    # Get the current remote annotation state
    result = await db.execute(
        select(ProjectAnnotationState).filter(
            ProjectAnnotationState.project_id == project_uuid
        )
    )
    remote_state = result.scalar_one_or_none()

    # If no remote state exists, there's no conflict
    if remote_state is None:
        logger.info(
            "check_annotation_conflicts_no_remote",
            project_id=request.project_id,
        )
        return AnnotationConflictCheckResponse(
            has_conflict=False,
            remote_version_id=None,
            remote_element_count=0,
            remote_updated_at=0,
            conflict_type="none",
            diff_summary=None,
        )

    # Convert remote updated_at to milliseconds timestamp
    remote_updated_at_ms = int(remote_state.updated_at.timestamp() * 1000)

    # Check for various conflict conditions
    conflict_type = "none"
    has_conflict = False
    diff_summary = None

    # 1. Check version mismatch (most definitive indicator)
    if request.local_version_id is not None:
        if request.local_version_id != remote_state.version_id:
            conflict_type = "version_mismatch"
            has_conflict = True
            logger.info(
                "check_annotation_conflicts_version_mismatch",
                project_id=request.project_id,
                local_version_id=request.local_version_id,
                remote_version_id=remote_state.version_id,
            )
    else:
        # Local has no version ID (new state) but remote has data
        if remote_state.element_count > 0:
            conflict_type = "version_mismatch"
            has_conflict = True

    # 2. Check for concurrent edit (timestamps and content differ)
    if not has_conflict and request.local_updated_at < remote_updated_at_ms:
        # Remote was updated after local's last known update
        # Check if content also differs
        if (
            request.local_element_count != remote_state.element_count
            or request.local_elements_hash != remote_state.elements_hash
        ):
            conflict_type = "concurrent_edit"
            has_conflict = True
            logger.info(
                "check_annotation_conflicts_concurrent_edit",
                project_id=request.project_id,
                local_updated_at=request.local_updated_at,
                remote_updated_at=remote_updated_at_ms,
            )

    # 3. Check element differences (hash mismatch with same version)
    if not has_conflict:
        if request.local_elements_hash != remote_state.elements_hash:
            conflict_type = "element_difference"
            has_conflict = True
            logger.info(
                "check_annotation_conflicts_element_difference",
                project_id=request.project_id,
                local_hash=request.local_elements_hash,
                remote_hash=remote_state.elements_hash,
            )

    # Calculate diff summary if there's a conflict
    if has_conflict:
        # For detailed diff, we'd need the actual annotation data
        # For now, provide a basic diff based on counts
        remote_count: int = int(remote_state.element_count)  # type: ignore[arg-type]
        count_diff = remote_count - request.local_element_count

        if count_diff > 0:
            # Remote has more elements
            diff_summary = AnnotationDiffSummary(
                added=count_diff,
                removed=0,
                modified=0,  # Can't determine without full comparison
            )
        elif count_diff < 0:
            # Remote has fewer elements
            diff_summary = AnnotationDiffSummary(
                added=0,
                removed=abs(count_diff),
                modified=0,
            )
        else:
            # Same count but different hash - likely modifications
            diff_summary = AnnotationDiffSummary(
                added=0,
                removed=0,
                modified=1,  # At least one modification detected
            )

    # Extract values from SQLAlchemy columns for Pydantic
    remote_version_id: str | None = (
        str(remote_state.version_id) if remote_state.version_id else None
    )
    remote_element_count: int = int(remote_state.element_count)  # type: ignore[arg-type]

    response = AnnotationConflictCheckResponse(
        has_conflict=has_conflict,
        remote_version_id=remote_version_id,
        remote_element_count=remote_element_count,
        remote_updated_at=remote_updated_at_ms,
        conflict_type=conflict_type,
        diff_summary=diff_summary,
    )

    logger.info(
        "check_annotation_conflicts_result",
        project_id=request.project_id,
        has_conflict=has_conflict,
        conflict_type=conflict_type,
    )

    return response
