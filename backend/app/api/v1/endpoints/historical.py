"""
Historical Data API Endpoints for Config Testing.

This module provides REST API endpoints for:
- Integration Testing: Random historical result selection for mock mode
- Unit Testing: Frame retrieval for screenshot-based testing
- Playback: Sequential frames for visual test playback

These endpoints support the Config Testing feature in qontinui-web,
allowing the qontinui library to fetch historical execution data
for mock-based testing.
"""

import random
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.models.snapshot import SnapshotAction, SnapshotRun
from app.models.video_capture import HistoricalResult

logger = structlog.get_logger(__name__)
router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class RandomResultRequest(BaseModel):
    """Request for random historical result."""

    pattern_id: str | None = Field(None, description="Filter by pattern ID")
    action_type: str | None = Field(
        None, description="Filter by action type (FIND, CLICK, etc.)"
    )
    active_states: list[str] | None = Field(
        None, description="Filter by active states (any match)"
    )
    success_only: bool = Field(True, description="Only return successful results")
    workflow_id: int | None = Field(None, description="Filter by workflow ID")
    project_id: UUID | None = Field(None, description="Filter by project ID")


class HistoricalResultResponse(BaseModel):
    """Response for historical result."""

    id: int
    pattern_id: str | None
    pattern_name: str | None
    action_type: str
    active_states: list[str] | None
    success: bool
    match_count: int | None
    best_match_score: float | None
    match_x: int | None
    match_y: int | None
    match_width: int | None
    match_height: int | None
    frame_timestamp_ms: int | None
    has_frame: bool = False

    class Config:
        from_attributes = True


class FrameResponse(BaseModel):
    """Response with frame data."""

    historical_result_id: int
    action_type: str
    pattern_id: str | None
    pattern_name: str | None
    success: bool
    match_x: int | None
    match_y: int | None
    match_width: int | None
    match_height: int | None
    timestamp_ms: int | None
    frame_base64: str | None = Field(None, description="Base64 encoded JPEG")
    has_frame: bool


class IntegrationTestPlaybackRequest(BaseModel):
    """Request for integration test playback frames."""

    historical_result_ids: list[int]


class IndexHistoricalResultsRequest(BaseModel):
    """Request to index historical results from a snapshot run."""

    snapshot_run_id: int
    video_capture_session_id: int | None = None


class IndexHistoricalResultsResponse(BaseModel):
    """Response for indexing historical results."""

    indexed: int
    snapshot_run_id: int


class ActionDataCreate(BaseModel):
    """Action data submitted by runner for historical indexing."""

    action_id: str
    pattern_id: str | None = None
    pattern_name: str | None = None
    action_type: str
    active_states: list[str] = Field(default_factory=list)
    success: bool
    match_count: int | None = None
    best_match_score: float | None = None
    match_x: int | None = None
    match_y: int | None = None
    match_width: int | None = None
    match_height: int | None = None
    duration_ms: int | None = None
    sequence_number: int | None = Field(None, description="Order within the test run")
    result_data: dict[str, Any] = Field(default_factory=dict)


class ActionDataBatch(BaseModel):
    """Batch of action data from runner."""

    run_id: UUID = Field(..., description="Test run or execution ID")
    project_id: UUID
    workflow_id: int | None = None
    test_run_id: UUID | None = Field(
        None, description="Optional link to SoftwareTestRun"
    )
    actions: list[ActionDataCreate]


class ActionDataBatchResponse(BaseModel):
    """Response for batch action data submission."""

    indexed: int
    run_id: UUID


# ============================================================================
# Historical Data Endpoints (for Config Testing / Mock Mode)
# ============================================================================


@router.post("/random", response_model=HistoricalResultResponse | None)
async def get_random_historical_result(
    *,
    db: AsyncSession = Depends(get_async_db),
    request: RandomResultRequest,
) -> Any:
    """
    Get a random historical result matching criteria.

    This is the key endpoint for integration testing - it returns
    a random result from historical data, making each test run different.

    **No Authentication Required**: This endpoint is called by the qontinui
    library during mock mode execution.

    **Example Request:**
    ```json
    {
      "pattern_id": "login_button",
      "action_type": "FIND",
      "active_states": ["login_page"],
      "success_only": true,
      "project_id": "project-uuid-123"
    }
    ```

    **Returns:** Random matching historical result or null if none found
    """
    logger.info(
        "get_random_historical_result_requested",
        pattern_id=request.pattern_id,
        action_type=request.action_type,
        active_states=request.active_states,
    )

    # Build query
    query = select(HistoricalResult)

    if request.pattern_id:
        query = query.filter(HistoricalResult.pattern_id == request.pattern_id)

    if request.action_type:
        query = query.filter(HistoricalResult.action_type == request.action_type)

    if request.success_only:
        query = query.filter(HistoricalResult.success == True)  # noqa: E712

    if request.workflow_id:
        query = query.filter(HistoricalResult.workflow_id == request.workflow_id)

    if request.project_id:
        query = query.filter(HistoricalResult.project_id == request.project_id)

    if request.active_states:
        # Match any of the active states using array overlap
        query = query.filter(
            HistoricalResult.active_states.overlap(request.active_states)
        )

    # Get count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    if total == 0:
        logger.debug("no_historical_results_found", criteria=request.model_dump())
        return None

    # Random offset for selection
    offset = random.randint(0, total - 1)
    query = query.offset(offset).limit(1)

    result = await db.execute(query)
    historical_result = result.scalar_one_or_none()

    if not historical_result:
        return None

    logger.debug(
        "historical_result_found",
        id=historical_result.id,
        pattern_id=historical_result.pattern_id,
        action_type=historical_result.action_type,
    )

    return HistoricalResultResponse(
        id=historical_result.id,
        pattern_id=historical_result.pattern_id,
        pattern_name=historical_result.pattern_name,
        action_type=historical_result.action_type,
        active_states=historical_result.active_states,
        success=historical_result.success,
        match_count=historical_result.match_count,
        best_match_score=(
            float(historical_result.best_match_score)
            if historical_result.best_match_score
            else None
        ),
        match_x=historical_result.match_x,
        match_y=historical_result.match_y,
        match_width=historical_result.match_width,
        match_height=historical_result.match_height,
        frame_timestamp_ms=historical_result.frame_timestamp_ms,
        has_frame=historical_result.video_capture_session_id is not None,
    )


@router.get("/pattern/{pattern_id}", response_model=list[HistoricalResultResponse])
async def get_historical_results_for_pattern(
    *,
    db: AsyncSession = Depends(get_async_db),
    pattern_id: str,
    action_type: str = Query(..., description="Action type (FIND, CLICK, etc.)"),
    active_states: str | None = Query(
        None, description="Comma-separated active states"
    ),
    limit: int = Query(10, le=100, description="Maximum results to return"),
) -> Any:
    """
    Get historical results for a specific pattern.

    Returns all historical results matching the pattern ID and action type,
    useful for analyzing pattern reliability and variations.

    **No Authentication Required**: Called by qontinui library.

    **Returns:** List of matching historical results
    """
    logger.info(
        "get_historical_results_for_pattern",
        pattern_id=pattern_id,
        action_type=action_type,
    )

    state_list = active_states.split(",") if active_states else None

    query = select(HistoricalResult).filter(
        HistoricalResult.pattern_id == pattern_id,
        HistoricalResult.action_type == action_type,
    )

    if state_list:
        query = query.filter(HistoricalResult.active_states.overlap(state_list))

    query = query.order_by(HistoricalResult.recorded_at.desc()).limit(limit)

    result = await db.execute(query)
    results = result.scalars().all()

    return [
        HistoricalResultResponse(
            id=r.id,
            pattern_id=r.pattern_id,
            pattern_name=r.pattern_name,
            action_type=r.action_type,
            active_states=r.active_states,
            success=r.success,
            match_count=r.match_count,
            best_match_score=float(r.best_match_score) if r.best_match_score else None,
            match_x=r.match_x,
            match_y=r.match_y,
            match_width=r.match_width,
            match_height=r.match_height,
            frame_timestamp_ms=r.frame_timestamp_ms,
            has_frame=r.video_capture_session_id is not None,
        )
        for r in results
    ]


@router.get("/frames/{historical_result_id}")
async def get_frame_for_result(
    *,
    db: AsyncSession = Depends(get_async_db),
    historical_result_id: int,
    frame_type: str = Query(
        "action", description="Frame type: before, action, after, result"
    ),
) -> Any:
    """
    Get the frame image for a historical result.

    Returns the screenshot/frame captured during the historical action.
    Used for unit testing with real screenshots.

    **No Authentication Required**: Called by qontinui library.

    **Returns:** JPEG image data
    """

    logger.info(
        "get_frame_for_result",
        historical_result_id=historical_result_id,
        frame_type=frame_type,
    )

    # Get the historical result
    result = await db.execute(
        select(HistoricalResult).filter(HistoricalResult.id == historical_result_id)
    )
    historical_result = result.scalar_one_or_none()

    if not historical_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Historical result not found",
        )

    if not historical_result.video_capture_session_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No video capture session associated with this result",
        )

    # For now, return 404 if no frame available
    # TODO: Implement actual frame extraction from video capture session
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Frame extraction not yet implemented. Use screenshot-based approach.",
    )


@router.post("/playback", response_model=list[FrameResponse])
async def get_playback_frames(
    *,
    db: AsyncSession = Depends(get_async_db),
    request: IntegrationTestPlaybackRequest,
) -> Any:
    """
    Get frames for integration test playback.

    Returns frame data and metadata for a sequence of historical results,
    suitable for visual playback of an integration test.

    **No Authentication Required**: Called by qontinui library.

    **Returns:** List of frames with metadata
    """
    logger.info(
        "get_playback_frames",
        result_count=len(request.historical_result_ids),
    )

    frames = []

    for result_id in request.historical_result_ids:
        result = await db.execute(
            select(HistoricalResult).filter(HistoricalResult.id == result_id)
        )
        historical_result = result.scalar_one_or_none()

        if not historical_result:
            continue

        # TODO: Extract actual frame data from video capture session
        frames.append(
            FrameResponse(
                historical_result_id=result_id,
                action_type=historical_result.action_type,
                pattern_id=historical_result.pattern_id,
                pattern_name=historical_result.pattern_name,
                success=historical_result.success,
                match_x=historical_result.match_x,
                match_y=historical_result.match_y,
                match_width=historical_result.match_width,
                match_height=historical_result.match_height,
                timestamp_ms=historical_result.frame_timestamp_ms,
                frame_base64=None,  # Frame extraction not implemented
                has_frame=historical_result.video_capture_session_id is not None,
            )
        )

    return frames


@router.post("/index/{snapshot_run_id}", response_model=IndexHistoricalResultsResponse)
async def index_historical_results(
    *,
    db: AsyncSession = Depends(get_async_db),
    snapshot_run_id: int,
    video_capture_session_id: int | None = Query(
        None, description="Associated video session"
    ),
) -> Any:
    """
    Index historical results from a snapshot run.

    Creates HistoricalResult entries from SnapshotAction records,
    enabling efficient random selection during mock mode.

    Called after a workflow execution completes to make the execution
    data available for integration testing.

    **Returns:** Number of results indexed
    """
    logger.info(
        "index_historical_results",
        snapshot_run_id=snapshot_run_id,
        video_capture_session_id=video_capture_session_id,
    )

    # Get snapshot run
    run_result = await db.execute(
        select(SnapshotRun).filter(SnapshotRun.id == snapshot_run_id)
    )
    snapshot_run = run_result.scalar_one_or_none()

    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot run not found: {snapshot_run_id}",
        )

    # Get all actions for this run
    actions_result = await db.execute(
        select(SnapshotAction).filter(SnapshotAction.snapshot_run_id == snapshot_run_id)
    )
    actions = actions_result.scalars().all()

    count = 0
    for action in actions:
        # Extract data from action_data_json
        action_data: dict[str, Any] = action.action_data_json or {}

        # Get best match info if available
        matches = action_data.get("matches", [])
        best_match = matches[0] if matches else {}

        historical = HistoricalResult(
            snapshot_run_id=snapshot_run_id,
            snapshot_action_id=action.id,
            video_capture_session_id=video_capture_session_id,
            pattern_id=action.pattern_id,
            pattern_name=action.pattern_name,
            action_type=action.action_type,
            active_states=action.active_states,
            success=action.success,
            match_count=action.match_count,
            best_match_score=best_match.get("score"),
            duration_ms=action.duration_ms,
            match_x=best_match.get("x"),
            match_y=best_match.get("y"),
            match_width=best_match.get("width"),
            match_height=best_match.get("height"),
            frame_timestamp_ms=None,  # Set from video session if available
            result_data_json=action_data,
            workflow_id=snapshot_run.workflow_id,
            project_id=snapshot_run.project_id,
            recorded_at=action.timestamp,
        )
        db.add(historical)
        count += 1

    await db.commit()

    logger.info(
        "historical_results_indexed",
        snapshot_run_id=snapshot_run_id,
        count=count,
    )

    return IndexHistoricalResultsResponse(
        indexed=count,
        snapshot_run_id=snapshot_run_id,
    )


# ============================================================================
# Runner Action Data Submission (Direct Historical Indexing)
# ============================================================================


@router.post("/actions", response_model=ActionDataBatchResponse)
async def submit_action_data(
    *,
    db: AsyncSession = Depends(get_async_db),
    batch_in: ActionDataBatch,
) -> Any:
    """
    Submit action execution data from the runner for historical indexing.

    This endpoint allows the runner to directly submit action data that
    will be indexed into HistoricalResult for Config Testing queries.

    **No Authentication Required**: Called by qontinui-runner during
    workflow execution.

    **Example Request:**
    ```json
    {
      "run_id": "uuid-of-test-run",
      "project_id": "uuid-of-project",
      "workflow_id": 123,
      "actions": [
        {
          "action_id": "action-uuid-1",
          "pattern_id": "login_button",
          "pattern_name": "Login Button",
          "action_type": "FIND",
          "active_states": ["login_page"],
          "success": true,
          "match_count": 1,
          "best_match_score": 0.95,
          "match_x": 100,
          "match_y": 200,
          "match_width": 80,
          "match_height": 40,
          "duration_ms": 150,
          "result_data": {"confidence": 0.95}
        }
      ]
    }
    ```

    **Returns:** Number of actions indexed
    """
    from datetime import UTC, datetime

    logger.info(
        "submit_action_data",
        run_id=str(batch_in.run_id),
        project_id=str(batch_in.project_id),
        action_count=len(batch_in.actions),
    )

    count = 0
    now = datetime.now(UTC)

    for action in batch_in.actions:
        historical = HistoricalResult(
            # No snapshot_run_id or snapshot_action_id - direct submission
            snapshot_run_id=None,
            snapshot_action_id=None,
            video_capture_session_id=None,
            # Link to live test run (for integration testing / workflow visualization)
            test_run_id=batch_in.test_run_id,
            sequence_number=action.sequence_number,
            # Action data
            pattern_id=action.pattern_id,
            pattern_name=action.pattern_name,
            action_type=action.action_type,
            active_states=action.active_states,
            success=action.success,
            match_count=action.match_count,
            best_match_score=action.best_match_score,
            duration_ms=action.duration_ms,
            match_x=action.match_x,
            match_y=action.match_y,
            match_width=action.match_width,
            match_height=action.match_height,
            frame_timestamp_ms=None,
            result_data_json=action.result_data,
            # Context
            workflow_id=batch_in.workflow_id,
            project_id=batch_in.project_id,
            recorded_at=now,
        )
        db.add(historical)
        count += 1

    await db.commit()

    logger.info(
        "action_data_indexed",
        run_id=str(batch_in.run_id),
        count=count,
    )

    return ActionDataBatchResponse(
        indexed=count,
        run_id=batch_in.run_id,
    )


# ============================================================================
# Test Run Playback Endpoints (for Workflow Visualization)
# ============================================================================


class TestRunResultResponse(BaseModel):
    """Historical result for test run playback."""

    id: int
    sequence_number: int | None
    pattern_id: str | None
    pattern_name: str | None
    action_type: str
    active_states: list[str] | None
    success: bool
    match_count: int | None
    best_match_score: float | None
    match_x: int | None
    match_y: int | None
    match_width: int | None
    match_height: int | None
    duration_ms: float | None
    recorded_at: str
    result_data: dict[str, Any] | None = None

    class Config:
        from_attributes = True


class TestRunPlaybackResponse(BaseModel):
    """Response for test run playback data."""

    test_run_id: UUID
    total_results: int
    results: list[TestRunResultResponse]


@router.get("/test-run/{test_run_id}", response_model=TestRunPlaybackResponse)
async def get_test_run_results(
    *,
    db: AsyncSession = Depends(get_async_db),
    test_run_id: UUID,
    include_result_data: bool = Query(
        False, description="Include full result_data_json"
    ),
) -> Any:
    """
    Get all historical results for a test run, ordered by sequence.

    This endpoint supports workflow visualization playback by returning
    all image recognition results from a test run in execution order.

    **No Authentication Required**: Called by qontinui-web frontend.

    **Returns:** Ordered list of historical results for the test run
    """
    logger.info(
        "get_test_run_results",
        test_run_id=str(test_run_id),
    )

    query = (
        select(HistoricalResult)
        .filter(HistoricalResult.test_run_id == test_run_id)
        .order_by(
            HistoricalResult.sequence_number.asc().nulls_last(),
            HistoricalResult.recorded_at.asc(),
        )
    )

    result = await db.execute(query)
    results = result.scalars().all()

    response_results = [
        TestRunResultResponse(
            id=r.id,
            sequence_number=r.sequence_number,
            pattern_id=r.pattern_id,
            pattern_name=r.pattern_name,
            action_type=r.action_type,
            active_states=r.active_states,
            success=r.success,
            match_count=r.match_count,
            best_match_score=float(r.best_match_score) if r.best_match_score else None,
            match_x=r.match_x,
            match_y=r.match_y,
            match_width=r.match_width,
            match_height=r.match_height,
            duration_ms=float(r.duration_ms) if r.duration_ms else None,
            recorded_at=r.recorded_at.isoformat(),
            result_data=r.result_data_json if include_result_data else None,
        )
        for r in results
    ]

    logger.info(
        "test_run_results_found",
        test_run_id=str(test_run_id),
        count=len(response_results),
    )

    return TestRunPlaybackResponse(
        test_run_id=test_run_id,
        total_results=len(response_results),
        results=response_results,
    )
