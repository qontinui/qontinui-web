"""
API endpoints for capture session management.

Handles creating, managing, and analyzing screenshot capture sessions
for the workflow learning pipeline.
"""

import json
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.capture import (
    CaptureDetectedElement,
    CaptureScreenshot,
    ScreenshotStateMatch,
)
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
from app.services.capture_response_builder import capture_response_builder
from app.services.capture_session_service import CaptureSessionService
from app.services.element_detection_service import ElementDetectionService
from app.services.workflow_generation_service import WorkflowGenerationService

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
    """Create a new capture session for a project."""
    session = await CaptureSessionService.create_session(
        db=db,
        project_id=project_id,
        user_id=current_user.id,
        session_data=session_data,
    )
    return capture_response_builder.build_session_response(session, screenshot_count=0)


@router.get(
    "/capture-sessions/{session_id}",
    response_model=CaptureSessionResponse,
)
async def get_capture_session(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get a capture session by ID."""
    session = await CaptureSessionService.get_session(
        db=db, session_id=session_id, user_id=current_user.id
    )
    return capture_response_builder.build_session_response(session)


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
    """List capture sessions for the current user."""
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
            capture_response_builder.build_session_response(s, screenshot_count=0)
            for s in sessions
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
    """Update a capture session."""
    session = await CaptureSessionService.update_session(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        update_data=update_data,
    )
    return capture_response_builder.build_session_response(session)


@router.delete(
    "/capture-sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_capture_session(
    session_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a capture session and all related data."""
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
    """Upload a screenshot to a capture session."""
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
    return capture_response_builder.build_screenshot_response(
        screenshot, action_count=0, detected_element_count=0
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
    """Get all screenshots for a capture session."""
    screenshots = await CaptureSessionService.get_session_screenshots(
        db=db, session_id=session_id, user_id=current_user.id
    )
    return [capture_response_builder.build_screenshot_response(s) for s in screenshots]


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
    """Create a user action within a screenshot."""
    action_data.screenshot_id = screenshot_id
    action = await CaptureSessionService.create_action(
        db=db, user_id=current_user.id, action_data=action_data
    )
    return capture_response_builder.build_action_response(action)


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
    """Batch create multiple actions."""
    actions = await CaptureSessionService.batch_create_actions(
        db=db, user_id=current_user.id, actions_data=batch_data.actions
    )
    return [capture_response_builder.build_action_response(a) for a in actions]


@router.get(
    "/screenshots/{screenshot_id}/actions",
    response_model=list[CaptureActionResponse],
)
async def list_screenshot_actions(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get all actions for a screenshot."""
    actions = await CaptureSessionService.get_screenshot_actions(
        db=db, screenshot_id=screenshot_id, user_id=current_user.id
    )
    return [capture_response_builder.build_action_response(a) for a in actions]


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
    """Match a capture screenshot against known states (DEPRECATED)."""
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
    """Match all screenshots in a capture session against known states."""
    return await CaptureSessionService.match_session_to_states(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        confidence_threshold=confidence_threshold,
    )


@router.get(
    "/screenshots/{screenshot_id}/state-matches",
    response_model=list[ScreenshotStateMatchResponse],
)
async def get_screenshot_state_matches(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get existing state matches for a screenshot."""
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

    return [capture_response_builder.build_state_match_response(m) for m in matches]


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
    """Detect UI elements in a capture screenshot."""
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
            capture_response_builder.build_detected_element_dict(e) for e in elements
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
    """Detect UI elements in all screenshots of a capture session."""
    detection_config = {
        "extract_text": extract_text,
        "detect_elements": detect_elements,
    }

    return await ElementDetectionService.detect_elements_in_session(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        detection_config=detection_config,
    )


@router.get(
    "/screenshots/{screenshot_id}/detected-elements",
    response_model=dict,
)
async def get_detected_elements(
    screenshot_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get previously detected elements for a screenshot."""
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
            capture_response_builder.build_detected_element_dict_full(e)
            for e in elements
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
    """
    workflow = await WorkflowGenerationService.generate_workflow_from_session(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
        name=name,
        description=description,
    )
    return capture_response_builder.build_workflow_response(workflow)


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
    """Get all learned workflows for a capture session."""
    workflows = await WorkflowGenerationService.get_learned_workflows(
        db=db,
        session_id=session_id,
        user_id=current_user.id,
    )
    return [capture_response_builder.build_workflow_response(wf) for wf in workflows]


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

    Status values: draft, reviewing, approved, rejected, published
    """
    workflow = await WorkflowGenerationService.update_workflow_status(
        db=db,
        workflow_id=workflow_id,
        user_id=current_user.id,
        status=new_status,
    )
    return capture_response_builder.build_workflow_response(workflow)
