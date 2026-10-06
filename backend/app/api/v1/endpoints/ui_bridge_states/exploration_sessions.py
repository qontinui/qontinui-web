"""Exploration session routes: CRUD plus appending render logs."""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import ui_bridge_exploration_session as session_crud
from app.models.user import User
from app.schemas.ui_bridge_state import (
    ExplorationSessionAppendRenders,
    ExplorationSessionCreate,
    ExplorationSessionListResponse,
    ExplorationSessionResponse,
    ExplorationSessionUpdate,
    ExplorationSessionWithRenders,
)

from ._deps import get_exploration_session_or_404, get_project_or_404

logger = structlog.get_logger(__name__)

router = APIRouter()


# =============================================================================
# Exploration Session Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/exploration-sessions",
    response_model=ExplorationSessionListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_exploration_sessions(
    project_id: UUID,
    include_completed: bool = Query(True, description="Include completed sessions"),
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List exploration sessions for a project."""
    await get_project_or_404(project_id, current_user.id, db)

    sessions = await session_crud.list_sessions(
        db, project_id, include_completed=include_completed, limit=limit
    )

    return ExplorationSessionListResponse(
        items=[ExplorationSessionResponse.model_validate(s) for s in sessions],
        total=len(sessions),
    )


@router.post(
    "/projects/{project_id}/exploration-sessions",
    response_model=ExplorationSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_exploration_session(
    project_id: UUID,
    request: ExplorationSessionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    session = await session_crud.create_session(db, project_id, request)

    logger.info(
        "Created exploration session",
        session_id=str(session.id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return ExplorationSessionResponse.model_validate(session)


@router.get(
    "/projects/{project_id}/exploration-sessions/{session_id}",
    response_model=ExplorationSessionWithRenders,
    status_code=status.HTTP_200_OK,
)
async def get_exploration_session(
    project_id: UUID,
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get an exploration session with render logs."""
    await get_project_or_404(project_id, current_user.id, db)

    session = await get_exploration_session_or_404(session_id, project_id, db)

    return ExplorationSessionWithRenders.model_validate(session)


@router.patch(
    "/projects/{project_id}/exploration-sessions/{session_id}",
    response_model=ExplorationSessionResponse,
    status_code=status.HTTP_200_OK,
)
async def update_exploration_session(
    project_id: UUID,
    session_id: UUID,
    request: ExplorationSessionUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update an exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    session = await get_exploration_session_or_404(session_id, project_id, db)

    # render_logs, when present, are appended rather than replaced.
    session = await session_crud.update_session(db, session, request)

    return ExplorationSessionResponse.model_validate(session)


@router.post(
    "/projects/{project_id}/exploration-sessions/{session_id}/renders",
    response_model=ExplorationSessionResponse,
    status_code=status.HTTP_200_OK,
)
async def append_renders_to_session(
    project_id: UUID,
    session_id: UUID,
    request: ExplorationSessionAppendRenders,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Append render logs to an exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    session = await get_exploration_session_or_404(session_id, project_id, db)

    session = await session_crud.append_renders(db, session, request)

    logger.debug(
        "Appended renders to exploration session",
        session_id=str(session_id),
        new_renders=len(request.render_logs),
        total_renders=session.render_count,
    )

    return ExplorationSessionResponse.model_validate(session)


@router.delete(
    "/projects/{project_id}/exploration-sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_exploration_session(
    project_id: UUID,
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete an exploration session."""
    await get_project_or_404(project_id, current_user.id, db)

    session = await get_exploration_session_or_404(session_id, project_id, db)

    await session_crud.delete_session(db, session)

    logger.info(
        "Deleted exploration session",
        session_id=str(session_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )
