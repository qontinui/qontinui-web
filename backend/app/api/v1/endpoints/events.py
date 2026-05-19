"""Workflow event ingestion and retrieval endpoints."""

from datetime import UTC, datetime
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

from app.api.deps import (
    DeviceTokenContext,
    get_async_db,
    get_authenticated_device,
    get_current_active_user_async,
)
from app.db.session import AsyncSessionLocal
from app.middleware.rate_limit import user_limiter
from app.models.device import Device
from app.models.phase_result import PhaseResult
from app.models.user import User
from app.models.workflow_event import WorkflowEvent, WorkflowEventType
from app.schemas.phase_result import PhaseResultIngestRequest, PhaseResultResponse
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
    device_ctx: DeviceTokenContext = Depends(get_authenticated_device),
) -> Any:
    """
    Ingest a workflow event from a device.

    Devices call this at key lifecycle points (run start, complete,
    fail, HITL, etc.). Authenticated with the coord-issued device-token
    JWT; the event is associated with the token's owning user.
    """
    # Validate event type
    valid_types = {e.value for e in WorkflowEventType}
    if event_in.event_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid event_type '{event_in.event_type}'. Must be one of: {', '.join(sorted(valid_types))}",
        )

    user_id = device_ctx.user_id

    logger.info(
        "workflow_event_ingested",
        user_id=user_id,
        event_type=event_in.event_type,
        device_id=event_in.device_id,
        runner_name=event_in.runner_name,
        run_id=event_in.run_id,
    )

    # Create event
    event = WorkflowEvent(
        user_id=user_id,
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


# Shared background dispatcher for push notifications. Defined at module scope
# so ``/phase-completed`` can reuse the same fan-out path as ``/workflow``.
async def _dispatch_push_for_event_id(event_id: PyUUID) -> None:
    async with AsyncSessionLocal() as bg_db:
        result = await bg_db.execute(
            select(WorkflowEvent).where(WorkflowEvent.id == event_id)
        )
        bg_event = result.scalar_one_or_none()
        if bg_event:
            await dispatch_push_for_event(bg_db, bg_event)


@router.post(
    "/phase-completed",
    response_model=PhaseResultResponse,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        202: {"description": "Phase result accepted and persisted"},
        401: {
            "description": "Missing or invalid runner token",
            "content": {
                "application/json": {"example": {"detail": "Invalid or expired token"}}
            },
        },
    },
)
async def ingest_phase_completed(
    *,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_async_db),
    payload: PhaseResultIngestRequest,
    device_ctx: DeviceTokenContext = Depends(get_authenticated_device),
) -> Any:
    """
    Ingest a phase-completion result from a server-mode runner.

    Authenticated with a runner bearer token (phase 3A auth). The handler:

    1. Resolves a ``runner_id`` for the row:
       * If ``payload.runner_id`` is set, the handler looks up that runner and
         verifies it is owned by the authenticated token's user (else 403).
         This is the Phase 3B path — the runner passes its own id after
         registration, avoiding cross-runner misattribution for users with
         multiple runners.
       * Otherwise, the handler falls back to the legacy "most-recently
         heartbeated runner owned by this user" heuristic so older runners
         still attribute correctly until they upgrade.
    2. Persists a ``PhaseResult`` row (runner_id may be NULL if the user has
       no registered runner yet).
    3. Also writes a companion ``WorkflowEvent`` row with
       ``event_type="phase_completed"``, keeping the existing SSE / push
       notification pipeline simple — each subscriber receives a slim event
       payload with the phase_result id and can fetch the full record via the
       read endpoints if needed.
    4. Fan-outs a push notification in the background.

    Returns ``202 Accepted`` with the created phase-result record. Duplicates
    are not deduplicated; repeated deliveries create additional rows.
    """
    # Resolve a device for this user.
    matched_device: Device | None = None
    if payload.runner_id is not None:
        # Explicit device_id path: verify the authenticated token's user
        # owns the referenced device; else 403.
        explicit_result = await db.execute(
            select(Device).where(Device.device_id == payload.runner_id)
        )
        matched_device = explicit_result.scalar_one_or_none()
        if matched_device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device not found",
            )
        if matched_device.user_id != device_ctx.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Device belongs to a different user",
            )
    else:
        # Fallback: most-recently-heartbeated device owned by this user.
        # Still nullable: if no device has registered yet, the row is
        # written with NULL device id.
        device_result = await db.execute(
            select(Device)
            .where(
                Device.user_id == device_ctx.user_id,
                Device.capability_user_paired.is_(True),
            )
            .order_by(
                Device.last_heartbeat.desc().nullslast(),
                Device.created_at.desc(),
            )
            .limit(1)
        )
        matched_device = device_result.scalar_one_or_none()
    runner_id = matched_device.device_id if matched_device is not None else None

    phase_result = PhaseResult(
        runner_id=runner_id,
        execution_id=payload.execution_id,
        phase=payload.phase,
        iteration=payload.iteration,
        stage_index=payload.stage_index,
        success=payload.success,
        all_passed=payload.all_passed,
        duration_ms=payload.duration_ms,
        failure_context=payload.failure_context,
        commit_hash=payload.commit_hash,
        step_results=[sr.model_dump(mode="json") for sr in payload.step_results],
        variables_set=payload.variables_set,
    )
    db.add(phase_result)
    await db.flush()  # materialize id before wrapping in WorkflowEvent

    runner_name = matched_device.name if matched_device is not None else "unknown"
    device_id = (
        str(matched_device.device_id) if matched_device is not None else "server-device"
    )
    summary = (
        f"Phase '{payload.phase}' "
        f"{'succeeded' if payload.success else 'failed'}"
        f" in {payload.duration_ms}ms"
    )

    event = WorkflowEvent(
        user_id=device_ctx.user_id,
        event_type=WorkflowEventType.PHASE_COMPLETED.value,
        device_id=device_id,
        runner_name=runner_name,
        run_id=payload.execution_id,
        summary=summary,
        payload={
            "phase_result_id": str(phase_result.id),
            "phase": payload.phase,
            "success": payload.success,
            "all_passed": payload.all_passed,
            "iteration": payload.iteration,
            "stage_index": payload.stage_index,
            "duration_ms": payload.duration_ms,
        },
        timestamp=datetime.now(UTC),
    )
    db.add(event)
    await db.commit()
    await db.refresh(phase_result)
    await db.refresh(event)

    logger.info(
        "phase_result_ingested",
        user_id=str(device_ctx.user_id),
        device_id=str(runner_id) if runner_id is not None else None,
        phase_result_id=str(phase_result.id),
        execution_id=payload.execution_id,
        phase=payload.phase,
        success=payload.success,
    )

    # Fan out the event in the background.
    background_tasks.add_task(_dispatch_push_for_event_id, PyUUID(str(event.id)))

    return PhaseResultResponse.model_validate(phase_result)


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
    if len(event_ids) > 500:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot mark more than 500 events at once",
        )

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
