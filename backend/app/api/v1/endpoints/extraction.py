"""API endpoints for web extraction."""

import copy
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

import structlog
from app.api import deps
from app.models.extraction import ExtractionAnnotation, ExtractionSession
from app.models.sync_lock import SyncLock
from app.models.user import User
from app.schemas.extraction import (
    AnnotationUpdate,
    ExtractionAnnotationResponse,
    ExtractionSessionCreate,
    ExtractionSessionDetail,
    ExtractionSessionResponse,
    ExtractionSessionUpdate,
    ImportMode,
    ImportResult,
    StateImportRequest,
    StateMachineUpdate,
)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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

    # Convert vision_results to dict if present
    vision_results_dict = (
        data.vision_results.model_dump() if data.vision_results else None
    )

    if annotation:
        annotation.elements = [e.model_dump() for e in data.elements]  # type: ignore[assignment]
        annotation.states = [s.model_dump() for s in data.states]  # type: ignore[assignment]
        annotation.source_url = data.source_url or annotation.source_url  # type: ignore[assignment]
        annotation.viewport_width = data.viewport_width  # type: ignore[assignment]
        annotation.viewport_height = data.viewport_height  # type: ignore[assignment]
        if vision_results_dict:
            annotation.vision_results = vision_results_dict  # type: ignore[assignment]
    else:
        annotation = ExtractionAnnotation(
            session_id=extraction_uuid,
            screenshot_id=data.screenshot_id,
            source_url=data.source_url,
            viewport_width=data.viewport_width,
            viewport_height=data.viewport_height,
            elements=[e.model_dump() for e in data.elements],
            states=[s.model_dump() for s in data.states],
            vision_results=vision_results_dict,
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


@router.put(
    "/extractions/{extraction_id}/state-machine",
    response_model=ExtractionSessionResponse,
)
async def update_state_machine(
    extraction_id: str,
    data: StateMachineUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Upload a pre-built state machine from the runner.

    The runner builds the state machine using qontinui's build_state_machine_from_extraction()
    after extraction completes. This endpoint stores it so the web backend doesn't need
    the qontinui library dependency.
    """
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

    # Store the pre-built state machine
    session.state_machine = {  # type: ignore[assignment]
        "states": data.states,
        "transitions": data.transitions,
    }

    await db.commit()
    await db.refresh(session)

    logger.info(
        "state_machine_uploaded",
        extraction_id=extraction_id,
        states_count=len(data.states),
        transitions_count=len(data.transitions),
    )

    return session


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
    """Create a state configuration dict from extraction data.

    The state format must match the frontend State interface from automation-context/types.ts:
    - id: string (required)
    - name: string (required)
    - description: string (required)
    - stateImages: StateImage[] (required array)
    - regions: StateRegion[] (required array)
    - locations: StateLocation[] (required array)
    - strings: StateString[] (required array)
    - position: { x: number; y: number } (required)
    - initial?: boolean (optional)
    - isFinal?: boolean (optional)
    """
    bbox = state_data.get("bbox", {})
    return {
        "id": state_data.get("id"),
        "name": state_data.get("name", state_data.get("id")),
        "description": f"Imported from extraction {extraction_id[:8]}... - {annotation.source_url}",
        "stateImages": [],  # Empty array, user can add identifying images later
        "regions": [],  # Empty array, user can add regions later
        "locations": [],  # Empty array, user can add locations later
        "strings": [],  # Empty array, user can add strings later
        "position": {"x": float(bbox.get("x", 0)), "y": float(bbox.get("y", 0))},
        "initial": False,
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
    """Import extracted states into a workflow's state structure.

    Supports two import modes:
    - state_machine (default): Uses co-occurrence clustering to build a proper state machine.
      States are defined by which images appear together across screens.
      Transitions are derived from navigation actions.
    - legacy: Imports raw states from annotations as-is (old behavior).
    """
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

    # Import sync broadcast for lock notifications
    from app.services.sync_broadcast import sync_broadcast

    import_mode = data.import_mode or ImportMode.STATE_MACHINE

    logger.info(
        "import_states_request",
        extraction_id=extraction_id,
        import_mode=import_mode.value,
        requested_state_ids=data.state_ids,
        annotation_count=len(session.annotations) if session.annotations else 0,
    )

    # Acquire sync lock to prevent frontend saves during import
    project_id = cast(UUID, session.project_id)
    now = datetime.now(UTC)
    lock = SyncLock(
        project_id=project_id,
        user_id=current_user.id,
        operation="import_states",
        acquired_at=now,
        expires_at=now + timedelta(seconds=60),  # 60 second TTL
    )
    db.add(lock)
    await db.commit()
    await db.refresh(lock)

    logger.info(
        "sync_lock_acquired_for_import",
        project_id=str(project_id),
        lock_id=str(lock.id),
        extraction_id=extraction_id,
    )

    # Broadcast lock acquired to connected clients
    await sync_broadcast.broadcast_lock_acquired(
        project_id=project_id,
        lock_id=str(lock.id),
        operation="import_states",
        user_id=str(current_user.id),
    )

    imported_count = 0
    imported_transitions = 0

    try:
        # Get configuration as dict
        # IMPORTANT: We must make a DEEP COPY, otherwise SQLAlchemy won't detect changes
        config: dict[str, Any] = (
            copy.deepcopy(cast(dict[str, Any], project.configuration))
            if project.configuration
            else {}
        )
        config.setdefault("states", [])
        config.setdefault("transitions", [])

        if import_mode == ImportMode.STATE_MACHINE:
            # New state machine builder mode
            imported_count, imported_transitions = await _import_state_machine(
                session, config, extraction_id, data.state_ids
            )
        else:
            # Legacy mode: import raw states
            imported_count = await _import_legacy_states(
                session, config, extraction_id, data.state_ids
            )

        # Update project configuration
        from app.crud.project import update_project
        from app.schemas.project import ProjectUpdate

        await update_project(db, project, ProjectUpdate(configuration=config))

        # Verify after save
        await db.refresh(project)
        saved_states = (
            project.configuration.get("states", []) if project.configuration else []
        )
        logger.info(
            "states_imported",
            extraction_id=extraction_id,
            import_mode=import_mode.value,
            imported_states=imported_count,
            imported_transitions=imported_transitions,
            workflow_id=data.target_workflow_id,
            final_states_count=len(saved_states),
        )

    finally:
        # Release sync lock
        lock.released_at = datetime.now(UTC)  # type: ignore[assignment]
        await db.commit()
        await db.refresh(lock)

        # Refresh project to get new version
        await db.refresh(project)
        new_version: int = cast(int, project.version)

        logger.info(
            "sync_lock_released_after_import",
            project_id=str(project_id),
            lock_id=str(lock.id),
            new_version=new_version,
        )

        # Broadcast lock released to connected clients
        await sync_broadcast.broadcast_lock_released(
            project_id=project_id,
            lock_id=str(lock.id),
            new_version=new_version,
        )

    return ImportResult(
        imported_states=imported_count,
        imported_transitions=imported_transitions,
        workflow_id=data.target_workflow_id,
        import_mode=import_mode.value,
    )


async def _import_state_machine(
    session: ExtractionSession,
    config: dict[str, Any],
    extraction_id: str,
    state_ids: list[str] | None,
) -> tuple[int, int]:
    """
    Import using the pre-built state machine from the runner.

    The runner builds the state machine using qontinui's build_state_machine_from_extraction()
    after extraction completes and uploads it via PUT /extractions/{id}/state-machine.
    This function just reads the stored result.

    Returns:
        Tuple of (imported_states_count, imported_transitions_count)
    """
    # Get the pre-built state machine from the session
    state_machine = session.state_machine
    if not state_machine or not isinstance(state_machine, dict):
        logger.warning(
            "no_state_machine_available",
            extraction_id=extraction_id,
            hint="Runner may not have uploaded state machine yet. Ensure runner is updated.",
        )
        return 0, 0

    states_config = state_machine.get("states", [])
    transitions_config = state_machine.get("transitions", [])

    if not states_config:
        logger.info("state_machine_empty", extraction_id=extraction_id)
        return 0, 0

    # Get existing state IDs to avoid duplicates
    states_list = config.get("states", [])
    existing_state_ids = {
        state.get("id") for state in states_list if isinstance(state, dict)
    }
    existing_transition_ids = {
        t.get("id") for t in config.get("transitions", []) if isinstance(t, dict)
    }

    # Add new states
    imported_states = 0
    for state in states_config:
        if state.get("id") not in existing_state_ids:
            config["states"].append(state)
            existing_state_ids.add(state.get("id"))
            imported_states += 1

    # Add new transitions
    imported_transitions = 0
    for transition in transitions_config:
        if transition.get("id") not in existing_transition_ids:
            config["transitions"].append(transition)
            existing_transition_ids.add(transition.get("id"))
            imported_transitions += 1

    logger.info(
        "state_machine_import_complete",
        extraction_id=extraction_id,
        imported_states=imported_states,
        imported_transitions=imported_transitions,
        total_states=len(config["states"]),
        total_transitions=len(config["transitions"]),
    )

    return imported_states, imported_transitions


async def _import_legacy_states(
    session: ExtractionSession,
    config: dict[str, Any],
    extraction_id: str,
    state_ids: list[str] | None,
) -> int:
    """
    Import using legacy mode (raw state import from annotations).

    This is the old behavior where states are imported as-is from annotations
    with empty stateImages, regions, locations, and strings arrays.

    Returns:
        Number of imported states
    """
    states_to_import = _collect_states_to_import(session, state_ids)

    if not states_to_import:
        logger.info(
            "legacy_import_no_states",
            extraction_id=extraction_id,
            state_ids=state_ids,
        )
        return 0

    states_list = config.get("states", [])
    existing_state_ids = {
        state.get("id") for state in states_list if isinstance(state, dict)
    }

    imported_count = 0
    skipped_ids = []

    for annotation, state_data in states_to_import:
        state_id = state_data.get("id")
        if not state_id:
            skipped_ids.append(("no_id", state_data.get("name")))
            continue
        if state_id in existing_state_ids:
            skipped_ids.append(("duplicate", state_id))
            continue
        config["states"].append(
            _create_state_config(state_data, annotation, extraction_id)
        )
        existing_state_ids.add(state_id)
        imported_count += 1

    logger.info(
        "legacy_import_complete",
        extraction_id=extraction_id,
        imported_count=imported_count,
        skipped=skipped_ids,
        total_states=len(config["states"]),
    )

    return imported_count
