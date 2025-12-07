"""API endpoints for web extraction."""

from typing import Any, cast
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.models.extraction import ExtractionAnnotation, ExtractionSession
from app.models.user import User
from app.schemas.extraction import (
    AnnotationUpdate,
    ExtractionAnnotationResponse,
    ExtractionSessionCreate,
    ExtractionSessionDetail,
    ExtractionSessionResponse,
    ExtractionSessionUpdate,
    ImportResult,
    StateImportRequest,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/projects/{project_id}/extractions",
    response_model=ExtractionSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_extraction_session(
    project_id: str,
    data: ExtractionSessionCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Create a new extraction session."""
    logger.info(
        "create_extraction_session",
        project_id=project_id,
        user_id=str(current_user.id),
    )

    try:
        project_uuid = UUID(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project ID format",
        )

    session = ExtractionSession(
        project_id=project_uuid,
        source_urls=data.source_urls,
        config=data.config.model_dump(),
        status="pending",
        created_by=current_user.id,
    )

    db.add(session)
    await db.commit()
    await db.refresh(session)

    return session


@router.get(
    "/projects/{project_id}/extractions",
    response_model=list[ExtractionSessionResponse],
)
async def list_extraction_sessions(
    project_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """List extraction sessions for a project."""
    try:
        project_uuid = UUID(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project ID format",
        )

    query = select(ExtractionSession).where(
        ExtractionSession.project_id == project_uuid
    )

    if status_filter:
        query = query.where(ExtractionSession.status == status_filter)

    query = query.order_by(ExtractionSession.created_at.desc())
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get(
    "/extractions/{extraction_id}",
    response_model=ExtractionSessionDetail,
)
async def get_extraction_session(
    extraction_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Get extraction session with annotations."""
    try:
        extraction_uuid = UUID(extraction_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid extraction ID format",
        )

    query = (
        select(ExtractionSession)
        .where(ExtractionSession.id == extraction_uuid)
        .options(selectinload(ExtractionSession.annotations))
    )

    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Extraction session not found",
        )

    return session


@router.patch(
    "/extractions/{extraction_id}",
    response_model=ExtractionSessionResponse,
)
async def update_extraction_session(
    extraction_id: str,
    data: ExtractionSessionUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Update extraction session status/stats."""
    try:
        extraction_uuid = UUID(extraction_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid extraction ID format",
        )

    query = select(ExtractionSession).where(ExtractionSession.id == extraction_uuid)

    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Extraction session not found",
        )

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(session, field, value)

    await db.commit()
    await db.refresh(session)

    return session


@router.delete(
    "/extractions/{extraction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_extraction_session(
    extraction_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> None:
    """Delete an extraction session."""
    try:
        extraction_uuid = UUID(extraction_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid extraction ID format",
        )

    query = select(ExtractionSession).where(ExtractionSession.id == extraction_uuid)

    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Extraction session not found",
        )

    await db.delete(session)
    await db.commit()


@router.put(
    "/extractions/{extraction_id}/annotations",
    response_model=ExtractionAnnotationResponse,
)
async def update_annotations(
    extraction_id: str,
    data: AnnotationUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Update annotations for a screenshot."""
    try:
        extraction_uuid = UUID(extraction_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid extraction ID format",
        )

    # Find or create annotation
    query = select(ExtractionAnnotation).where(
        ExtractionAnnotation.session_id == extraction_uuid,
        ExtractionAnnotation.screenshot_id == data.screenshot_id,
    )

    result = await db.execute(query)
    annotation = result.scalar_one_or_none()

    if annotation:
        annotation.elements = [e.model_dump() for e in data.elements]  # type: ignore[assignment]
        annotation.states = [s.model_dump() for s in data.states]  # type: ignore[assignment]
    else:
        annotation = ExtractionAnnotation(
            session_id=extraction_uuid,
            screenshot_id=data.screenshot_id,
            source_url="",  # Would need to be provided
            elements=[e.model_dump() for e in data.elements],
            states=[s.model_dump() for s in data.states],
        )
        db.add(annotation)

    await db.commit()
    await db.refresh(annotation)

    return annotation


@router.get(
    "/extractions/{extraction_id}/annotations",
    response_model=list[ExtractionAnnotationResponse],
)
async def get_annotations(
    extraction_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Get all annotations for an extraction."""
    try:
        extraction_uuid = UUID(extraction_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid extraction ID format",
        )

    query = (
        select(ExtractionAnnotation)
        .where(ExtractionAnnotation.session_id == extraction_uuid)
        .order_by(ExtractionAnnotation.screenshot_id)
    )

    result = await db.execute(query)
    return list(result.scalars().all())


def _collect_states_to_import(
    session: ExtractionSession,
    state_ids: list[str] | None,
) -> list[tuple[Any, dict[str, Any]]]:
    """Collect states from annotations, optionally filtered by state IDs."""
    states_to_import = []
    for annotation in session.annotations:
        for state_data in annotation.states:
            if state_ids and state_data.get("id") not in state_ids:
                continue
            states_to_import.append((annotation, state_data))
    return states_to_import


def _create_state_config(
    state_data: dict[str, Any],
    annotation: Any,
    extraction_id: str,
) -> dict[str, Any]:
    """Create a state configuration dict from extraction data."""
    bbox = state_data.get("bbox", {})
    return {
        "id": state_data.get("id"),
        "name": state_data.get("name", state_data.get("id")),
        "description": f"Imported from extraction {extraction_id[:8]}... - {annotation.source_url}",
        "identifyingImages": [],
        "position": {"x": float(bbox.get("x", 0)), "y": float(bbox.get("y", 0))},
        "isInitial": False,
        "isFinal": False,
    }


@router.post(
    "/extractions/{extraction_id}/import-states",
    response_model=ImportResult,
)
async def import_to_state_structure(
    extraction_id: str,
    data: StateImportRequest,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Import extracted states into a workflow's state structure."""
    try:
        extraction_uuid = UUID(extraction_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid extraction ID format",
        )

    # Get extraction session with annotations
    query = (
        select(ExtractionSession)
        .where(ExtractionSession.id == extraction_uuid)
        .options(selectinload(ExtractionSession.annotations))
    )
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Extraction session not found",
        )

    # Get project and check permissions
    from app.crud.project import get_project

    project = await get_project(db, project_id=cast(UUID, session.project_id))
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )

    # Collect and import states
    states_to_import = _collect_states_to_import(session, data.state_ids)
    if not states_to_import:
        logger.info(
            "no_states_to_import", extraction_id=extraction_id, state_ids=data.state_ids
        )
        return ImportResult(
            imported_states=0,
            imported_transitions=0,
            workflow_id=data.target_workflow_id,
        )

    # Get configuration as dict (project.configuration is the actual value, not a Column)
    config: dict[str, Any] = cast(dict[str, Any], project.configuration) if project.configuration else {}
    config.setdefault("states", [])
    states_list = config.get("states", [])
    if not isinstance(states_list, list):
        states_list = []
        config["states"] = states_list
    existing_state_ids = {state.get("id") for state in states_list if isinstance(state, dict)}
    imported_count = 0

    for annotation, state_data in states_to_import:
        state_id = state_data.get("id")
        if not state_id or state_id in existing_state_ids:
            continue
        config["states"].append(
            _create_state_config(state_data, annotation, extraction_id)
        )
        existing_state_ids.add(state_id)
        imported_count += 1

    # Update project configuration
    from app.crud.project import update_project
    from app.schemas.project import ProjectUpdate

    await update_project(db, project, ProjectUpdate(configuration=config))
    logger.info(
        "states_imported",
        extraction_id=extraction_id,
        imported_count=imported_count,
        workflow_id=data.target_workflow_id,
    )
    return ImportResult(
        imported_states=imported_count,
        imported_transitions=0,
        workflow_id=data.target_workflow_id,
    )
