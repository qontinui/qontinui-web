"""Workflow event ingestion and retrieval endpoints."""

from typing import Any
from uuid import UUID as PyUUID

import structlog
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.db.session import AsyncSessionLocal
from app.middleware.rate_limit import user_limiter
from app.models.runner_device import RunnerDevice
from app.models.user import User
from app.models.workflow_event import WorkflowEvent, WorkflowEventType
from app.schemas.workflow_event import WorkflowEventCreate, WorkflowEventResponse
from app.services.push_notifications import dispatch_push_for_event

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/workflow",
    response_model=WorkflowEventResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {"description": "Event ingested successfully"},
        400: {
            "description": "Invalid event type",
            "content": {
                "application/json": {"example": {"detail": "Invalid event_type"}}
            },
        },
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
        403: {
            "description": "Device not registered to user",
            "content": {
                "application/json": {
                    "example": {"detail": "Device not registered to this user"}
                }
            },
        },
    },
)
@user_limiter.limit("120 per minute")
async def ingest_workflow_event(
    *,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_async_db),
    event_in: WorkflowEventCreate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Ingest a workflow event from a runner.

    Runners call this at key lifecycle points (run start, complete, fail, HITL, etc.).
    The event is stored and will trigger push notifications to the user's mobile devices.
    """
    # Validate event type
    valid_types = {e.value for e in WorkflowEventType}
    if event_in.event_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid event_type '{event_in.event_type}'. Must be one of: {', '.join(sorted(valid_types))}",
        )

    # Verify device belongs to this user
    result = await db.execute(
        select(RunnerDevice).where(
            RunnerDevice.device_id == event_in.device_id,
            RunnerDevice.user_id == current_user.id,
            RunnerDevice.is_active == True,  # noqa: E712
        )
    )
    device = result.scalar_one_or_none()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Device not registered to this user or inactive",
        )

    logger.info(
        "workflow_event_ingested",
        user_id=current_user.id,
        event_type=event_in.event_type,
        device_id=event_in.device_id,
        runner_name=event_in.runner_name,
        run_id=event_in.run_id,
    )

    # Create event
    event = WorkflowEvent(
        user_id=current_user.id,
        event_type=event_in.event_type,
        device_id=event_in.device_id,
        runner_name=event_in.runner_name,
        run_id=event_in.run_id,
        summary=event_in.summary,
        payload=event_in.payload,
        timestamp=event_in.timestamp,
    )

    db.add(event)
    await db.commit()
    await db.refresh(event)

    # Dispatch push notifications in the background (fire-and-forget)
    async def _dispatch_push(event_id):
        async with AsyncSessionLocal() as bg_db:
            from sqlalchemy import select as bg_select

            result = await bg_db.execute(
                bg_select(WorkflowEvent).where(WorkflowEvent.id == event_id)
            )
            bg_event = result.scalar_one_or_none()
            if bg_event:
                await dispatch_push_for_event(bg_db, bg_event)

    background_tasks.add_task(_dispatch_push, event.id)

    return WorkflowEventResponse.model_validate(event)


@router.get(
    "",
    response_model=list[WorkflowEventResponse],
    responses={
        200: {"description": "List of workflow events"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("60 per minute")
async def list_workflow_events(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    event_type: str | None = Query(None, description="Filter by event type"),
    device_id: str | None = Query(None, description="Filter by runner device ID"),
    run_id: str | None = Query(None, description="Filter by run ID"),
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> Any:
    """
    List workflow events for the authenticated user.

    Returns events in reverse chronological order. Supports filtering by
    event type, device, and run ID.
    """
    query = select(WorkflowEvent).where(WorkflowEvent.user_id == current_user.id)

    if event_type:
        query = query.where(WorkflowEvent.event_type == event_type)
    if device_id:
        query = query.where(WorkflowEvent.device_id == device_id)
    if run_id:
        query = query.where(WorkflowEvent.run_id == run_id)

    query = query.order_by(WorkflowEvent.timestamp.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    events = result.scalars().all()

    logger.info(
        "workflow_events_listed",
        user_id=current_user.id,
        count=len(events),
        event_type_filter=event_type,
    )

    return [WorkflowEventResponse.model_validate(e) for e in events]


@router.get(
    "/unseen",
    response_model=list[WorkflowEventResponse],
    responses={
        200: {"description": "List of unseen workflow events"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("60 per minute")
async def list_unseen_events(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    limit: int = Query(50, ge=1, le=200, description="Max events to return"),
) -> Any:
    """
    List unseen workflow events for the authenticated user.

    Used by mobile as a polling fallback when push notifications are unavailable.
    """
    query = (
        select(WorkflowEvent)
        .where(
            WorkflowEvent.user_id == current_user.id,
            WorkflowEvent.seen == False,  # noqa: E712
        )
        .order_by(WorkflowEvent.timestamp.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    events = result.scalars().all()

    return [WorkflowEventResponse.model_validate(e) for e in events]


@router.post(
    "/mark-seen",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Events marked as seen"},
        401: {
            "description": "Not authenticated",
            "content": {
                "application/json": {"example": {"detail": "Not authenticated"}}
            },
        },
    },
)
@user_limiter.limit("60 per minute")
async def mark_events_seen(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    event_ids: list[str],
) -> Any:
    """
    Mark workflow events as seen.

    Mobile calls this after displaying events to the user.
    """
    try:
        uuids = [PyUUID(eid) for eid in event_ids]
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more event IDs are not valid UUIDs",
        )

    await db.execute(
        update(WorkflowEvent)
        .where(
            WorkflowEvent.user_id == current_user.id,
            WorkflowEvent.id.in_(uuids),
        )
        .values(seen=True)
    )
    await db.commit()

    logger.info(
        "workflow_events_marked_seen",
        user_id=current_user.id,
        count=len(event_ids),
    )

    return {"message": f"{len(event_ids)} events marked as seen"}
