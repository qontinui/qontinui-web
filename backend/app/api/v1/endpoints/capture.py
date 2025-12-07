"""
API endpoints for capture session management.

Handles creating, managing, and analyzing screenshot capture sessions
for the workflow learning pipeline.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.schemas.capture import (
    BatchActionCreate,
    CaptureActionCreate,
    CaptureActionResponse,
    CaptureScreenshotResponse,
    CaptureSessionCreate,
    CaptureSessionResponse,
    CaptureSessionUpdate,
    LearnedWorkflowResponse,
    ScreenshotStateMatchResponse,
)
from app.services.capture_session_service import CaptureSessionService

router = APIRouter()


# ============================================================================
# Capture Session Endpoints
# ============================================================================


@router.post(
    "/projects/{project_id}/capture-sessions",
    response_model=CaptureSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_capture_session(
    project_id: UUID,
    session_data: CaptureSessionCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Create a new capture session for a project.

    Args:
        project_id: ID of the project
        session_data: Session creation data
        current_user: Authenticated user
        db: Database session

    Returns:
        The created capture session
    """
    session = await CaptureSessionService.create_session(
        db=db,
        project_id=project_id,
        user_id=current_user.id,
        session_data=session_data,
    )

    return CaptureSessionResponse(
        id=session.id,
        project_id=session.project_id,
        user_id=session.user_id,
        name=session.name,
        description=session.description,
        status=session.status,
        extra_metadata=session.extra_metadata,
        created_at=session.created_at,
        completed_at=session.completed_at,
        screenshot_count=0,  # Just created
    )


@router.get(
    "/capture-sessions/{session_id}",
    response_model=CaptureSessionResponse,
)
async def get_capture_session(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get a capture session by ID.

    Args:
        session_id: ID of the session
        current_user: Authenticated user
        db: Database session

    Returns:
        The capture session
    """
    session = await CaptureSessionService.get_session(
        db=db, session_id=session_id, user_id=current_user.id
    )

    return CaptureSessionResponse(
        id=session.id,
        project_id=session.project_id,
        user_id=session.user_id,
        name=session.name,
        description=session.description,
        status=session.status,
        extra_metadata=session.extra_metadata,
        created_at=session.created_at,
        completed_at=session.completed_at,
        screenshot_count=len(session.screenshots) if session.screenshots else 0,
    )


@router.get(
    "/capture-sessions",
    response_model=dict,
)
async def list_capture_sessions(
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    status_filter: str | None = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100, description="Maximum results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
):
    """
    List capture sessions for the current user.

    Args:
        current_user: Authenticated user
        db: Database session
        project_id: Optional project filter
        status_filter: Optional status filter
        limit: Maximum results
        offset: Pagination offset

    Returns:
        Paginated list of capture sessions
    """
    sessions, total = await CaptureSessionService.list_sessions(
        db=db,
        user_id=current_user.id,
        project_id=project_id,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )

    return {
        "items": [
            CaptureSessionResponse(
                id=session.id,
                project_id=session.project_id,
                user_id=session.user_id,
                name=session.name,
                description=session.description,
                status=session.status,
                extra_metadata=session.extra_metadata,
                created_at=session.created_at,
                completed_at=session.completed_at,
                screenshot_count=0,  # Not loaded in list view for performance
            )
            for session in sessions
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.patch(
    "/capture-sessions/{session_id}",
    response_model=CaptureSessionResponse,
)
async def update_capture_session(
    session_id: UUID,
    update_data: CaptureSessionUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Update a capture session.

    Args:
        session_id: ID of the session
        update_data: Update data
        current_user: Authenticated user
        db: Database session

    Returns:
        The updated capture session
    """
    session = await CaptureSessionService.update_session(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        update_data=update_data,
    )

    return CaptureSessionResponse(
        id=session.id,
        project_id=session.project_id,
        user_id=session.user_id,
        name=session.name,
        description=session.description,
        status=session.status,
        extra_metadata=session.extra_metadata,
        created_at=session.created_at,
        completed_at=session.completed_at,
        screenshot_count=len(session.screenshots) if session.screenshots else 0,
    )


@router.delete(
    "/capture-sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_capture_session(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Delete a capture session and all related data.

    Args:
        session_id: ID of the session
        current_user: Authenticated user
        db: Database session
    """
    await CaptureSessionService.delete_session(
        db=db, session_id=session_id, user_id=current_user.id
    )


# ============================================================================
# Screenshot Upload Endpoints
# ============================================================================


@router.post(
    "/capture-sessions/{session_id}/screenshots",
    response_model=CaptureScreenshotResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_screenshot(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    sequence_number: int = Form(..., ge=0, description="Order within session"),
    file: UploadFile = File(..., description="Screenshot image file"),
    extra_metadata: str | None = Form(
        None, description="JSON string of metadata (optional)"
    ),
):
    """
    Upload a screenshot to a capture session.

    Args:
        session_id: ID of the session
        sequence_number: Order within session
        file: Screenshot image file
        extra_metadata: Optional JSON metadata string
        current_user: Authenticated user
        db: Database session

    Returns:
        The created screenshot record
    """
    # Parse metadata if provided
    import json

    metadata = None
    if extra_metadata:
        try:
            metadata = json.loads(extra_metadata)
        except json.JSONDecodeError:
            pass

    screenshot = await CaptureSessionService.upload_screenshot(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        sequence_number=sequence_number,
        file=file,
        subscription_tier=current_user.subscription_tier,
        extra_metadata=metadata,
    )

    return CaptureScreenshotResponse(
        id=screenshot.id,
        session_id=screenshot.session_id,
        sequence_number=screenshot.sequence_number,
        image_url=screenshot.image_url,
        thumbnail_url=screenshot.thumbnail_url,
        width=screenshot.width,
        height=screenshot.height,
        timestamp=screenshot.timestamp,
        extra_metadata=screenshot.extra_metadata,
        analysis_status=screenshot.analysis_status,
        action_count=0,  # Just created
        detected_element_count=0,
    )


@router.get(
    "/capture-sessions/{session_id}/screenshots",
    response_model=list[CaptureScreenshotResponse],
)
async def list_session_screenshots(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get all screenshots for a capture session.

    Args:
        session_id: ID of the session
        current_user: Authenticated user
        db: Database session

    Returns:
        List of screenshots, ordered by sequence number
    """
    screenshots = await CaptureSessionService.get_session_screenshots(
        db=db, session_id=session_id, user_id=current_user.id
    )

    return [
        CaptureScreenshotResponse(
            id=screenshot.id,
            session_id=screenshot.session_id,
            sequence_number=screenshot.sequence_number,
            image_url=screenshot.image_url,
            thumbnail_url=screenshot.thumbnail_url,
            width=screenshot.width,
            height=screenshot.height,
            timestamp=screenshot.timestamp,
            extra_metadata=screenshot.extra_metadata,
            analysis_status=screenshot.analysis_status,
            action_count=len(screenshot.actions) if screenshot.actions else 0,
            detected_element_count=(
                len(screenshot.detected_elements) if screenshot.detected_elements else 0
            ),
        )
        for screenshot in screenshots
    ]


# ============================================================================
# Action Endpoints
# ============================================================================


@router.post(
    "/screenshots/{screenshot_id}/actions",
    response_model=CaptureActionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_action(
    screenshot_id: UUID,
    action_data: CaptureActionCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Create a user action within a screenshot.

    Args:
        screenshot_id: ID of the screenshot
        action_data: Action creation data
        current_user: Authenticated user
        db: Database session

    Returns:
        The created action
    """
    # Ensure screenshot_id matches
    action_data.screenshot_id = screenshot_id

    action = await CaptureSessionService.create_action(
        db=db, user_id=current_user.id, action_data=action_data
    )

    return CaptureActionResponse(
        id=action.id,
        screenshot_id=action.screenshot_id,
        sequence_number=action.sequence_number,
        action_type=action.action_type,
        x=action.x,
        y=action.y,
        text=action.text,
        key=action.key,
        button=action.button,
        scroll_delta=action.scroll_delta,
        timestamp=action.timestamp,
        extra_metadata=action.extra_metadata,
    )


@router.post(
    "/actions/batch",
    response_model=list[CaptureActionResponse],
    status_code=status.HTTP_201_CREATED,
)
async def batch_create_actions(
    batch_data: BatchActionCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Batch create multiple actions.

    Args:
        batch_data: Batch of actions to create
        current_user: Authenticated user
        db: Database session

    Returns:
        List of created actions
    """
    actions = await CaptureSessionService.batch_create_actions(
        db=db, user_id=current_user.id, actions_data=batch_data.actions
    )

    return [
        CaptureActionResponse(
            id=action.id,
            screenshot_id=action.screenshot_id,
            sequence_number=action.sequence_number,
            action_type=action.action_type,
            x=action.x,
            y=action.y,
            text=action.text,
            key=action.key,
            button=action.button,
            scroll_delta=action.scroll_delta,
            timestamp=action.timestamp,
            extra_metadata=action.extra_metadata,
        )
        for action in actions
    ]


@router.get(
    "/screenshots/{screenshot_id}/actions",
    response_model=list[CaptureActionResponse],
)
async def list_screenshot_actions(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get all actions for a screenshot.

    Args:
        screenshot_id: ID of the screenshot
        current_user: Authenticated user
        db: Database session

    Returns:
        List of actions, ordered by sequence number
    """
    actions = await CaptureSessionService.get_screenshot_actions(
        db=db, screenshot_id=screenshot_id, user_id=current_user.id
    )

    return [
        CaptureActionResponse(
            id=action.id,
            screenshot_id=action.screenshot_id,
            sequence_number=action.sequence_number,
            action_type=action.action_type,
            x=action.x,
            y=action.y,
            text=action.text,
            key=action.key,
            button=action.button,
            scroll_delta=action.scroll_delta,
            timestamp=action.timestamp,
            extra_metadata=action.extra_metadata,
        )
        for action in actions
    ]


# ============================================================================
# State Matching Endpoints
# ============================================================================


@router.post(
    "/screenshots/{screenshot_id}/match-states",
    response_model=list[ScreenshotStateMatchResponse],
    status_code=status.HTTP_200_OK,
)
async def match_screenshot_to_states(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    confidence_threshold: float = Query(
        0.7, ge=0.0, le=1.0, description="Minimum confidence for a match"
    ),
):
    """
    Match a capture screenshot against known states.

    Compares the screenshot against reference screenshots from snapshot runs
    to identify which UI states are present.

    Args:
        screenshot_id: ID of the screenshot to match
        confidence_threshold: Minimum confidence score (0.0-1.0)
        current_user: Authenticated user
        db: Database session

    Returns:
        List of state matches with confidence scores
    """
    # DEPRECATED: State matching functionality has been removed
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="State matching functionality has been removed. Use qontinui library for local execution.",
    )


@router.post(
    "/capture-sessions/{session_id}/match-states",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def match_session_to_states(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    confidence_threshold: float = Query(
        0.7, ge=0.0, le=1.0, description="Minimum confidence for a match"
    ),
):
    """
    Match all screenshots in a capture session against known states.

    Processes all screenshots in the session and compares them against
    reference screenshots to identify UI states throughout the capture.

    Args:
        session_id: ID of the capture session
        confidence_threshold: Minimum confidence score (0.0-1.0)
        current_user: Authenticated user
        db: Database session

    Returns:
        Statistics about the matching results
    """
    result = await CaptureSessionService.match_session_to_states(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        confidence_threshold=confidence_threshold,
    )

    return result


@router.get(
    "/screenshots/{screenshot_id}/state-matches",
    response_model=list[ScreenshotStateMatchResponse],
)
async def get_screenshot_state_matches(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get existing state matches for a screenshot.

    Args:
        screenshot_id: ID of the screenshot
        current_user: Authenticated user
        db: Database session

    Returns:
        List of existing state matches
    """
    from app.models.capture import CaptureScreenshot, ScreenshotStateMatch

    # Verify access
    result = await db.execute(
        select(CaptureScreenshot)
        .join(CaptureScreenshot.session)
        .filter(
            CaptureScreenshot.id == screenshot_id,
            CaptureScreenshot.session.has(user_id=current_user.id),
        )
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found or access denied",
        )

    # Get matches
    matches_result = await db.execute(
        select(ScreenshotStateMatch)
        .filter(ScreenshotStateMatch.screenshot_id == screenshot_id)
        .order_by(ScreenshotStateMatch.confidence.desc())
    )
    matches = list(matches_result.scalars().all())

    return [
        ScreenshotStateMatchResponse(
            id=match.id,
            screenshot_id=match.screenshot_id,
            state_identifier=match.state_identifier,
            state_metadata=match.state_metadata,
            confidence=match.confidence,
            matched_elements=match.matched_elements,
            is_confirmed=match.is_confirmed,
            review_notes=match.review_notes,
            created_at=match.created_at,
        )
        for match in matches
    ]


# ============================================================================
# Element Detection Endpoints
# ============================================================================


@router.post(
    "/screenshots/{screenshot_id}/detect-elements",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def detect_elements_in_screenshot(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    extract_text: bool = Query(True, description="Extract text from elements"),
    detect_elements: bool = Query(True, description="Detect UI elements"),
    segment_regions: bool = Query(False, description="Segment regions"),
):
    """
    Detect UI elements in a capture screenshot.

    Uses qontinui-api's computer vision to identify buttons, inputs,
    text, images, and other UI elements.

    Args:
        screenshot_id: ID of the screenshot to analyze
        extract_text: Whether to extract text (OCR)
        detect_elements: Whether to detect UI elements
        segment_regions: Whether to segment regions
        current_user: Authenticated user
        db: Database session

    Returns:
        List of detected elements with bounding boxes and properties
    """
    from app.services.element_detection_service import ElementDetectionService

    detection_config = {
        "extract_text": extract_text,
        "detect_elements": detect_elements,
        "segment_regions": segment_regions,
    }

    elements = await ElementDetectionService.detect_elements_in_screenshot(
        db=db,
        screenshot_id=screenshot_id,
        user_id=current_user.id,
        detection_config=detection_config,
    )

    return {
        "screenshot_id": str(screenshot_id),
        "element_count": len(elements),
        "elements": [
            {
                "id": str(elem.id),
                "element_type": elem.element_type,
                "x": elem.x,
                "y": elem.y,
                "width": elem.width,
                "height": elem.height,
                "text_content": elem.text_content,
                "confidence": elem.confidence,
                "properties": elem.properties,
            }
            for elem in elements
        ],
    }


@router.post(
    "/capture-sessions/{session_id}/detect-elements",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def detect_elements_in_session(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    extract_text: bool = Query(True, description="Extract text from elements"),
    detect_elements: bool = Query(True, description="Detect UI elements"),
):
    """
    Detect UI elements in all screenshots of a capture session.

    Processes all screenshots in the session to identify UI elements.
    Skips screenshots that have already been analyzed.

    Args:
        session_id: ID of the capture session
        extract_text: Whether to extract text (OCR)
        detect_elements: Whether to detect UI elements
        current_user: Authenticated user
        db: Database session

    Returns:
        Statistics about detected elements across the session
    """
    from app.services.element_detection_service import ElementDetectionService

    detection_config = {
        "extract_text": extract_text,
        "detect_elements": detect_elements,
    }

    result = await ElementDetectionService.detect_elements_in_session(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        detection_config=detection_config,
    )

    return result


@router.get(
    "/screenshots/{screenshot_id}/detected-elements",
    response_model=dict,
)
async def get_detected_elements(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get previously detected elements for a screenshot.

    Args:
        screenshot_id: ID of the screenshot
        current_user: Authenticated user
        db: Database session

    Returns:
        List of detected elements
    """
    from app.models.capture import CaptureDetectedElement, CaptureScreenshot

    # Verify access
    result = await db.execute(
        select(CaptureScreenshot)
        .join(CaptureScreenshot.session)
        .filter(
            CaptureScreenshot.id == screenshot_id,
            CaptureScreenshot.session.has(user_id=current_user.id),
        )
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found or access denied",
        )

    # Get detected elements
    elements_result = await db.execute(
        select(CaptureDetectedElement)
        .filter(CaptureDetectedElement.screenshot_id == screenshot_id)
        .order_by(CaptureDetectedElement.confidence.desc())
    )
    elements = list(elements_result.scalars().all())

    return {
        "screenshot_id": str(screenshot_id),
        "analysis_status": screenshot.analysis_status,
        "element_count": len(elements),
        "elements": [
            {
                "id": str(elem.id),
                "element_type": elem.element_type,
                "x": elem.x,
                "y": elem.y,
                "width": elem.width,
                "height": elem.height,
                "text_content": elem.text_content,
                "confidence": elem.confidence,
                "properties": elem.properties,
                "visual_hash": elem.visual_hash,
            }
            for elem in elements
        ],
    }


# ============================================================================
# Workflow Generation Endpoints
# ============================================================================


@router.post(
    "/capture-sessions/{session_id}/generate-workflow",
    response_model=LearnedWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generate_workflow_from_session(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    name: str | None = Query(None, description="Name for the learned workflow"),
    description: str | None = Query(None, description="Description for the workflow"),
):
    """
    Generate a workflow from a capture session.

    Analyzes the sequence of screenshots, state matches, and actions to
    automatically create a workflow structure.

    **Process:**
    1. Analyze screenshot sequence and state matches
    2. Extract unique states and transitions
    3. Calculate confidence scores
    4. Generate workflow JSON structure
    5. Create LearnedWorkflow record

    **Returns:**
    - Workflow with states, transitions, and metadata
    - Overall confidence score
    - Warnings about low-confidence transitions or missing states
    """
    from app.services.workflow_generation_service import WorkflowGenerationService

    workflow = await WorkflowGenerationService.generate_workflow_from_session(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        name=name,
        description=description,
    )

    return LearnedWorkflowResponse(
        id=workflow.id,
        session_id=workflow.session_id,
        project_id=workflow.project_id,
        name=workflow.name,
        description=workflow.description,
        workflow_json=workflow.workflow_json,
        confidence=workflow.confidence,
        status=workflow.status,
        warnings=workflow.warnings,
        created_at=workflow.created_at,
        reviewed_at=workflow.reviewed_at,
        reviewer_id=workflow.reviewer_id,
        published_info=workflow.published_info,
    )


@router.get(
    "/capture-sessions/{session_id}/learned-workflows",
    response_model=list[LearnedWorkflowResponse],
    status_code=status.HTTP_200_OK,
)
async def get_session_learned_workflows(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get all learned workflows for a capture session.

    Returns all workflows generated from this session, ordered by creation date (newest first).
    """
    from app.services.workflow_generation_service import WorkflowGenerationService

    workflows = await WorkflowGenerationService.get_learned_workflows(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
    )

    return [
        LearnedWorkflowResponse(
            id=wf.id,
            session_id=wf.session_id,
            project_id=wf.project_id,
            name=wf.name,
            description=wf.description,
            workflow_json=wf.workflow_json,
            confidence=wf.confidence,
            status=wf.status,
            warnings=wf.warnings,
            created_at=wf.created_at,
            reviewed_at=wf.reviewed_at,
            reviewer_id=wf.reviewer_id,
            published_info=wf.published_info,
        )
        for wf in workflows
    ]


@router.patch(
    "/learned-workflows/{workflow_id}/status",
    response_model=LearnedWorkflowResponse,
    status_code=status.HTTP_200_OK,
)
async def update_learned_workflow_status(
    workflow_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
    new_status: str = Query(
        ...,
        pattern="^(draft|reviewing|approved|rejected|published)$",
        description="New status for the workflow",
    ),
):
    """
    Update the status of a learned workflow.

    **Status values:**
    - `draft` - Initial state, workflow needs review
    - `reviewing` - Under review by user
    - `approved` - Approved and ready to publish
    - `rejected` - Rejected, not suitable for use
    - `published` - Published to project configuration

    When status is set to `approved` or `rejected`, the `reviewed_at` timestamp
    and `reviewer_id` are automatically set.
    """
    from app.services.workflow_generation_service import WorkflowGenerationService

    workflow = await WorkflowGenerationService.update_workflow_status(
        db=db,
        workflow_id=workflow_id,
        user_id=current_user.id,
        status=new_status,
    )

    return LearnedWorkflowResponse(
        id=workflow.id,
        session_id=workflow.session_id,
        project_id=workflow.project_id,
        name=workflow.name,
        description=workflow.description,
        workflow_json=workflow.workflow_json,
        confidence=workflow.confidence,
        status=workflow.status,
        warnings=workflow.warnings,
        created_at=workflow.created_at,
        reviewed_at=workflow.reviewed_at,
        reviewer_id=workflow.reviewer_id,
        published_info=workflow.published_info,
    )
