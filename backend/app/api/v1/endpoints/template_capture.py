"""API endpoints for Template Capture (click-to-template system)."""

import io
from datetime import UTC, datetime
from uuid import UUID

import httpx
import numpy as np
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from PIL import Image
from pydantic import BaseModel
from qontinui_schemas.template_capture import (
    ApplicationProfileCreate,
    ApplicationProfileListResponse,
    ApplicationProfileResponse,
    ApplicationProfileUpdate,
    ApprovedTemplateData,
    CandidateBoundingBox,
    CandidateStatus,
    DetectionStrategyType,
    InferenceConfigSchema,
    TemplateCandidateBatchCreate,
    TemplateCandidateCreate,
    TemplateCandidateDetail,
    TemplateCandidateListResponse,
    TemplateCandidateResponse,
    TemplateCandidateSummary,
    TemplateCandidateUpdate,
    TuningMetrics,
    TuningRequest,
    TuningResult,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models import ApplicationProfile, TemplateCandidate, User
from app.services.template_candidate_storage_service import (
    TemplateCandidateStorageService,
)

router = APIRouter()
logger = structlog.get_logger(__name__)

# HTTP client timeout for downloading screenshots
SCREENSHOT_DOWNLOAD_TIMEOUT = 30.0


class CandidateUrlsResponse(BaseModel):
    """Response schema for candidate image URLs."""

    pixel_data_url: str | None = None
    thumbnail_url: str | None = None
    mask_url: str | None = None


def _convert_strategies(strategies: list[str] | None) -> list[DetectionStrategyType]:
    """Convert list of strategy strings to DetectionStrategyType enums."""
    if not strategies:
        return []
    return [DetectionStrategyType(s) for s in strategies]


# =============================================================================
# Template Candidate Endpoints
# =============================================================================


@router.post(
    "/candidates",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def receive_candidates(
    candidates: list[TemplateCandidateCreate],
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_async_db),
):
    """Receive template candidates from runner after capture session.

    This endpoint is called by the runner to upload detected template
    candidates. The candidates can optionally be associated with a project.

    If pixel_data_base64 is provided, the images will be stored in object storage
    and URLs will be set on the candidate record.
    """
    created_count = 0
    storage_errors = []

    for candidate_data in candidates:
        candidate_id = candidate_data.id
        session_id = candidate_data.session_id

        # Initialize URL fields
        pixel_data_url = None
        thumbnail_url = None
        mask_url = None
        pixel_data_path = None
        mask_path = None

        # Upload images to storage if pixel data is provided
        if candidate_data.pixel_data_base64:
            try:
                upload_result = await TemplateCandidateStorageService.upload_candidate_images_from_base64(
                    candidate_id=candidate_id,
                    session_id=session_id,
                    pixel_data_base64=candidate_data.pixel_data_base64,
                    mask_base64=candidate_data.mask_base64,
                )

                if upload_result["image"]:
                    pixel_data_path, pixel_data_url = upload_result["image"]

                if upload_result["thumbnail"]:
                    _, thumbnail_url = upload_result["thumbnail"]

                if upload_result["mask"]:
                    mask_path, mask_url = upload_result["mask"]

                logger.info(
                    "candidate_images_stored",
                    candidate_id=candidate_id,
                    session_id=session_id,
                    has_image=pixel_data_url is not None,
                    has_thumbnail=thumbnail_url is not None,
                    has_mask=mask_url is not None,
                )

            except Exception as e:
                logger.error(
                    "candidate_image_storage_failed",
                    candidate_id=candidate_id,
                    session_id=session_id,
                    error=str(e),
                )
                storage_errors.append({"candidate_id": candidate_id, "error": str(e)})
                # Continue processing - don't fail the entire batch

        candidate = TemplateCandidate(
            id=UUID(candidate_id),
            session_id=session_id,
            project_id=project_id,
            click_x=candidate_data.click_x,
            click_y=candidate_data.click_y,
            click_button=candidate_data.click_button,
            timestamp=candidate_data.timestamp,
            frame_number=candidate_data.frame_number,
            primary_boundary=candidate_data.primary_boundary.model_dump(by_alias=True),
            alternative_boundaries=[
                b.model_dump(by_alias=True)
                for b in candidate_data.alternative_boundaries
            ],
            detection_strategies=[
                s.value for s in candidate_data.detection_strategies_used
            ],
            confidence_score=candidate_data.confidence_score,
            element_type=candidate_data.element_type,
            application_name=candidate_data.application_hint,
            status="pending",
            # Storage fields
            pixel_data_path=pixel_data_path,
            pixel_data_url=pixel_data_url,
            thumbnail_url=thumbnail_url,
            mask_path=mask_path,
            mask_url=mask_url,
        )
        db.add(candidate)
        created_count += 1

    await db.commit()

    response: dict = {"success": True, "created_count": created_count}
    if storage_errors:
        response["storage_errors"] = storage_errors

    return response


@router.post(
    "/candidates/batch",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def receive_candidates_batch(
    batch: TemplateCandidateBatchCreate,
    project_id: UUID | None = None,
    db: AsyncSession = Depends(get_async_db),
):
    """Receive a batch of template candidates."""
    return await receive_candidates(batch.candidates, project_id, db)


@router.get(
    "/candidates",
    response_model=TemplateCandidateListResponse,
)
async def list_candidates(
    session_id: str | None = None,
    status_filter: CandidateStatus | None = None,
    project_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List template candidates, optionally filtered."""
    query = select(TemplateCandidate)

    if session_id:
        query = query.where(TemplateCandidate.session_id == session_id)

    if status_filter:
        query = query.where(TemplateCandidate.status == status_filter.value)

    if project_id:
        query = query.where(TemplateCandidate.project_id == project_id)

    # Get total count
    count_query = select(TemplateCandidate)
    if session_id:
        count_query = count_query.where(TemplateCandidate.session_id == session_id)
    if status_filter:
        count_query = count_query.where(TemplateCandidate.status == status_filter.value)
    if project_id:
        count_query = count_query.where(TemplateCandidate.project_id == project_id)

    total_result = await db.execute(count_query)
    total = len(total_result.scalars().all())

    # Get paginated results
    query = query.order_by(TemplateCandidate.created_at.desc())
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    candidates = result.scalars().all()

    items = [
        TemplateCandidateSummary(
            id=str(c.id),
            sessionId=c.session_id,
            clickX=c.click_x,
            clickY=c.click_y,
            status=CandidateStatus(c.status),
            confidenceScore=c.confidence_score,
            elementType=c.element_type,
            thumbnailUrl=c.thumbnail_url,
            createdAt=c.created_at.isoformat(),
        )
        for c in candidates
    ]

    return TemplateCandidateListResponse(items=items, total=total)


@router.get(
    "/candidates/{candidate_id}",
    response_model=TemplateCandidateDetail,
)
async def get_candidate(
    candidate_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get a specific template candidate by ID."""
    result = await db.execute(
        select(TemplateCandidate).where(TemplateCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template candidate not found",
        )

    return TemplateCandidateDetail(
        id=str(candidate.id),
        sessionId=candidate.session_id,
        projectId=str(candidate.project_id) if candidate.project_id else None,
        clickX=candidate.click_x,
        clickY=candidate.click_y,
        clickButton=candidate.click_button,
        timestamp=candidate.timestamp,
        frameNumber=candidate.frame_number,
        primaryBoundary=CandidateBoundingBox(**candidate.primary_boundary),
        alternativeBoundaries=[
            CandidateBoundingBox(**b) for b in (candidate.alternative_boundaries or [])
        ],
        detectionStrategiesUsed=[
            DetectionStrategyType(s) for s in (candidate.detection_strategies or [])
        ],
        status=CandidateStatus(candidate.status),
        adjustedBoundary=(
            CandidateBoundingBox(**candidate.adjusted_boundary)
            if candidate.adjusted_boundary
            else None
        ),
        confidenceScore=candidate.confidence_score,
        elementType=candidate.element_type,
        applicationHint=candidate.application_name,
        pixelDataUrl=candidate.pixel_data_url,
        thumbnailUrl=candidate.thumbnail_url,
        maskUrl=candidate.mask_url,
        reviewedBy=str(candidate.reviewed_by_id) if candidate.reviewed_by_id else None,
        reviewedAt=(
            candidate.reviewed_at.isoformat() if candidate.reviewed_at else None
        ),
        createdAt=candidate.created_at.isoformat(),
    )


@router.get(
    "/candidates/{candidate_id}/image",
    response_model=CandidateUrlsResponse,
)
async def get_candidate_image_urls(
    candidate_id: UUID,
    expiration: int = 3600,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get fresh presigned URLs for a candidate's images.

    Use this endpoint when image URLs have expired and need to be refreshed.
    Presigned URLs typically expire after 1 hour.

    Args:
        candidate_id: The candidate UUID
        expiration: URL expiration time in seconds (default: 3600 = 1 hour)

    Returns:
        CandidateUrlsResponse with pixel_data_url, thumbnail_url, and mask_url
    """
    result = await db.execute(
        select(TemplateCandidate).where(TemplateCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template candidate not found",
        )

    # Get fresh URLs from storage
    urls = TemplateCandidateStorageService.get_candidate_urls(
        candidate_id=str(candidate_id),
        session_id=candidate.session_id,
        expiration=expiration,
    )

    # Update the stored URLs in the database for caching
    if urls["pixel_data_url"]:
        candidate.pixel_data_url = urls["pixel_data_url"]
    if urls["thumbnail_url"]:
        candidate.thumbnail_url = urls["thumbnail_url"]
    if urls["mask_url"]:
        candidate.mask_url = urls["mask_url"]

    await db.commit()

    return CandidateUrlsResponse(
        pixel_data_url=urls["pixel_data_url"],
        thumbnail_url=urls["thumbnail_url"],
        mask_url=urls["mask_url"],
    )


@router.patch(
    "/candidates/{candidate_id}/approve",
    response_model=TemplateCandidateResponse,
)
async def approve_candidate(
    candidate_id: UUID,
    body: TemplateCandidateUpdate | None = None,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Approve a template candidate with optional boundary adjustment."""
    from datetime import UTC, datetime

    result = await db.execute(
        select(TemplateCandidate).where(TemplateCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template candidate not found",
        )

    candidate.status = "approved"
    candidate.reviewed_by_id = current_user.id
    candidate.reviewed_at = datetime.now(UTC)

    if body and body.adjusted_boundary:
        candidate.adjusted_boundary = body.adjusted_boundary.model_dump(by_alias=True)
        candidate.status = "modified"

    await db.commit()
    await db.refresh(candidate)

    return TemplateCandidateResponse(
        id=str(candidate.id),
        sessionId=candidate.session_id,
        projectId=str(candidate.project_id) if candidate.project_id else None,
        clickX=candidate.click_x,
        clickY=candidate.click_y,
        clickButton=candidate.click_button,
        timestamp=candidate.timestamp,
        frameNumber=candidate.frame_number,
        primaryBoundary=CandidateBoundingBox(**candidate.primary_boundary),
        status=CandidateStatus(candidate.status),
        confidenceScore=candidate.confidence_score,
        elementType=candidate.element_type,
        applicationHint=candidate.application_name,
        pixelDataUrl=candidate.pixel_data_url,
        thumbnailUrl=candidate.thumbnail_url,
        createdAt=candidate.created_at.isoformat(),
    )


@router.patch(
    "/candidates/{candidate_id}/reject",
    response_model=TemplateCandidateResponse,
)
async def reject_candidate(
    candidate_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Reject a template candidate as false positive."""
    from datetime import UTC, datetime

    result = await db.execute(
        select(TemplateCandidate).where(TemplateCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template candidate not found",
        )

    candidate.status = "rejected"
    candidate.reviewed_by_id = current_user.id
    candidate.reviewed_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(candidate)

    return TemplateCandidateResponse(
        id=str(candidate.id),
        sessionId=candidate.session_id,
        projectId=str(candidate.project_id) if candidate.project_id else None,
        clickX=candidate.click_x,
        clickY=candidate.click_y,
        clickButton=candidate.click_button,
        timestamp=candidate.timestamp,
        frameNumber=candidate.frame_number,
        primaryBoundary=CandidateBoundingBox(**candidate.primary_boundary),
        status=CandidateStatus(candidate.status),
        confidenceScore=candidate.confidence_score,
        elementType=candidate.element_type,
        applicationHint=candidate.application_name,
        pixelDataUrl=candidate.pixel_data_url,
        thumbnailUrl=candidate.thumbnail_url,
        createdAt=candidate.created_at.isoformat(),
    )


# =============================================================================
# Application Profile Endpoints
# =============================================================================


@router.get(
    "/profiles",
    response_model=ApplicationProfileListResponse,
)
async def list_profiles(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all application profiles."""
    # Get total count
    count_result = await db.execute(select(ApplicationProfile))
    total = len(count_result.scalars().all())

    # Get paginated results
    query = select(ApplicationProfile).order_by(ApplicationProfile.name)
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    profiles = result.scalars().all()

    items = [
        ApplicationProfileResponse(
            id=str(p.id),
            name=p.name,
            inferenceConfig=InferenceConfigSchema(**(p.inference_config or {})),
            preferredStrategies=_convert_strategies(p.preferred_strategies),
            avgElementSize=p.avg_element_size or [60, 30],
            tuningMetrics=(
                TuningMetrics(**(p.tuning_metrics or {})) if p.tuning_metrics else None
            ),
            successRate=p.success_rate,
            sampleCount=p.sample_count,
            createdAt=p.created_at.isoformat(),
            updatedAt=p.updated_at.isoformat(),
        )
        for p in profiles
    ]

    return ApplicationProfileListResponse(items=items, total=total)


@router.post(
    "/profiles",
    response_model=ApplicationProfileResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_profile(
    profile_data: ApplicationProfileCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new application profile."""
    # Check if name already exists
    result = await db.execute(
        select(ApplicationProfile).where(ApplicationProfile.name == profile_data.name)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Profile with name '{profile_data.name}' already exists",
        )

    profile = ApplicationProfile(
        name=profile_data.name,
        inference_config=(
            profile_data.inference_config.model_dump(by_alias=True)
            if profile_data.inference_config
            else {}
        ),
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)

    return ApplicationProfileResponse(
        id=str(profile.id),
        name=profile.name,
        inferenceConfig=InferenceConfigSchema(**(profile.inference_config or {})),
        preferredStrategies=_convert_strategies(profile.preferred_strategies),
        avgElementSize=profile.avg_element_size or [60, 30],
        tuningMetrics=None,
        successRate=profile.success_rate,
        sampleCount=profile.sample_count,
        createdAt=profile.created_at.isoformat(),
        updatedAt=profile.updated_at.isoformat(),
    )


@router.get(
    "/profiles/{name}",
    response_model=ApplicationProfileResponse,
)
async def get_profile(
    name: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get an application profile by name."""
    result = await db.execute(
        select(ApplicationProfile).where(ApplicationProfile.name == name)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile '{name}' not found",
        )

    return ApplicationProfileResponse(
        id=str(profile.id),
        name=profile.name,
        inferenceConfig=InferenceConfigSchema(**(profile.inference_config or {})),
        preferredStrategies=_convert_strategies(profile.preferred_strategies),
        avgElementSize=profile.avg_element_size or [60, 30],
        tuningMetrics=(
            TuningMetrics(**(profile.tuning_metrics or {}))
            if profile.tuning_metrics
            else None
        ),
        successRate=profile.success_rate,
        sampleCount=profile.sample_count,
        createdAt=profile.created_at.isoformat(),
        updatedAt=profile.updated_at.isoformat(),
    )


@router.patch(
    "/profiles/{name}",
    response_model=ApplicationProfileResponse,
)
async def update_profile(
    name: str,
    update_data: ApplicationProfileUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update an application profile."""
    result = await db.execute(
        select(ApplicationProfile).where(ApplicationProfile.name == name)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile '{name}' not found",
        )

    if update_data.name:
        profile.name = update_data.name

    if update_data.inference_config:
        profile.inference_config = update_data.inference_config.model_dump(
            by_alias=True
        )

    if update_data.preferred_strategies:
        profile.preferred_strategies = [
            s.value for s in update_data.preferred_strategies
        ]

    await db.commit()
    await db.refresh(profile)

    return ApplicationProfileResponse(
        id=str(profile.id),
        name=profile.name,
        inferenceConfig=InferenceConfigSchema(**(profile.inference_config or {})),
        preferredStrategies=_convert_strategies(profile.preferred_strategies),
        avgElementSize=profile.avg_element_size or [60, 30],
        tuningMetrics=(
            TuningMetrics(**(profile.tuning_metrics or {}))
            if profile.tuning_metrics
            else None
        ),
        successRate=profile.success_rate,
        sampleCount=profile.sample_count,
        createdAt=profile.created_at.isoformat(),
        updatedAt=profile.updated_at.isoformat(),
    )


@router.post(
    "/profiles/{name}/tune",
    response_model=TuningResult,
)
async def tune_profile(
    name: str,
    tuning_request: TuningRequest,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Trigger tuning for an application profile.

    This endpoint accepts screenshot URLs and triggers the tuning
    algorithm to optimize detection parameters for the application.

    The tuning process:
    1. Downloads screenshots from the provided URLs
    2. Runs the ApplicationTuner algorithm to find optimal parameters
    3. Updates the profile with the tuning results
    4. Returns metrics and strategy rankings
    """
    # Import qontinui tuning components
    from qontinui.discovery.click_analysis.application_tuner import ApplicationTuner
    from qontinui.discovery.click_analysis.models import InferredBoundingBox

    result = await db.execute(
        select(ApplicationProfile).where(ApplicationProfile.name == name)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile '{name}' not found",
        )

    # Validate request
    if not tuning_request.screenshot_urls:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one screenshot URL is required for tuning",
        )

    logger.info(
        "Starting profile tuning",
        profile_name=name,
        screenshot_count=len(tuning_request.screenshot_urls),
    )

    # Download screenshots from URLs
    screenshots: list[np.ndarray] = []
    failed_urls: list[str] = []

    async with httpx.AsyncClient(timeout=SCREENSHOT_DOWNLOAD_TIMEOUT) as client:
        for url in tuning_request.screenshot_urls:
            try:
                response = await client.get(url)
                response.raise_for_status()

                # Convert image bytes to numpy array (BGR for OpenCV compatibility)
                image_bytes = io.BytesIO(response.content)
                pil_image: Image.Image = Image.open(image_bytes)

                # Convert to RGB first, then to BGR for OpenCV
                if pil_image.mode != "RGB":
                    pil_image = pil_image.convert("RGB")

                # Convert to numpy array and swap RGB to BGR
                np_array = np.array(pil_image)
                bgr_array = np_array[:, :, ::-1].copy()  # RGB to BGR
                screenshots.append(bgr_array)

                logger.debug(
                    "Downloaded screenshot",
                    url=url,
                    shape=bgr_array.shape,
                )

            except httpx.HTTPStatusError as e:
                logger.warning(
                    "Failed to download screenshot - HTTP error",
                    url=url,
                    status_code=e.response.status_code,
                )
                failed_urls.append(url)

            except httpx.RequestError as e:
                logger.warning(
                    "Failed to download screenshot - request error",
                    url=url,
                    error=str(e),
                )
                failed_urls.append(url)

            except Exception as e:
                logger.warning(
                    "Failed to process screenshot",
                    url=url,
                    error=str(e),
                )
                failed_urls.append(url)

    # Check if we have enough screenshots
    if not screenshots:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to download any screenshots. Failed URLs: {failed_urls}",
        )

    # Convert known elements to InferredBoundingBox if provided
    known_elements: list[InferredBoundingBox] | None = None
    if tuning_request.known_elements:
        from qontinui.discovery.click_analysis.models import (
            DetectionStrategy,
            ElementType,
        )

        known_elements = []
        for elem in tuning_request.known_elements:
            # Convert schema DetectionStrategyType to qontinui DetectionStrategy
            strategy_value = (
                elem.strategy_used.value if elem.strategy_used else "fixed_size"
            )
            element_type_value = (
                elem.element_type.value if elem.element_type else "unknown"
            )

            known_elements.append(
                InferredBoundingBox(
                    x=elem.x,
                    y=elem.y,
                    width=elem.width,
                    height=elem.height,
                    confidence=elem.confidence,
                    strategy_used=DetectionStrategy(strategy_value),
                    element_type=ElementType(element_type_value),
                )
            )

    # Run the tuning algorithm
    try:
        tuner = ApplicationTuner()
        tuning_result = tuner.tune_from_samples(
            screenshots=screenshots,
            known_elements=known_elements,
        )

        logger.info(
            "Tuning completed",
            profile_name=name,
            success=tuning_result.success,
            sample_count=len(screenshots),
            strategy_rankings=[
                (s.value, score) for s, score in tuning_result.strategy_rankings[:3]
            ],
        )

    except Exception as e:
        logger.error(
            "Tuning algorithm failed",
            profile_name=name,
            error=str(e),
        )
        return TuningResult(
            success=False,
            metrics=None,
            strategyRankings=[],
            errorMessage=f"Tuning algorithm failed: {str(e)}",
        )

    if not tuning_result.success:
        return TuningResult(
            success=False,
            metrics=None,
            strategyRankings=[],
            errorMessage=tuning_result.error_message or "Tuning failed",
        )

    # Update the profile with tuning results
    # Convert InferenceConfig to dict for storage
    config_dict = tuning_result.config.to_dict()
    profile.inference_config = config_dict

    # Set preferred strategies from rankings (top 4)
    profile.preferred_strategies = [
        s.value for s, _ in tuning_result.strategy_rankings[:4]
    ]

    # Convert TuningMetrics to dict for storage
    metrics_dict = tuning_result.metrics.to_dict()
    profile.tuning_metrics = metrics_dict

    # Update sample count (add to existing count)
    profile.sample_count = (profile.sample_count or 0) + len(screenshots)

    # Calculate success rate based on average confidence
    # Higher confidence = higher success rate estimate
    avg_confidence = tuning_result.metrics.avg_confidence
    if avg_confidence > 0:
        # Weighted average with existing success rate
        if profile.success_rate > 0 and profile.sample_count > len(screenshots):
            old_weight = min(0.7, (profile.sample_count - len(screenshots)) / 100)
            profile.success_rate = (
                old_weight * profile.success_rate + (1 - old_weight) * avg_confidence
            )
        else:
            profile.success_rate = avg_confidence

    await db.commit()
    await db.refresh(profile)

    logger.info(
        "Profile updated with tuning results",
        profile_name=name,
        sample_count=profile.sample_count,
        success_rate=profile.success_rate,
        preferred_strategies=profile.preferred_strategies,
    )

    # Build response
    metrics_response = TuningMetrics(
        sampleCount=tuning_result.metrics.sample_count,
        edgeScore=tuning_result.metrics.edge_score,
        contourScore=tuning_result.metrics.contour_score,
        colorScore=tuning_result.metrics.color_score,
        floodFillScore=tuning_result.metrics.flood_fill_score,
        gradientScore=tuning_result.metrics.gradient_score,
        avgDetectionTimeMs=tuning_result.metrics.avg_detection_time_ms,
        avgConfidence=tuning_result.metrics.avg_confidence,
        tuningIterations=tuning_result.metrics.tuning_iterations,
        lastTunedAt=(
            tuning_result.metrics.last_tuned_at.isoformat()
            if tuning_result.metrics.last_tuned_at
            else datetime.now(UTC).isoformat()
        ),
    )

    # Convert strategy rankings to list of tuples (strategy_value, score)
    strategy_rankings_response = [
        (s.value, score) for s, score in tuning_result.strategy_rankings
    ]

    # Include warning about failed downloads if any
    error_msg = None
    if failed_urls:
        error_msg = f"Warning: {len(failed_urls)} screenshot(s) failed to download"

    return TuningResult(
        success=True,
        metrics=metrics_response,
        strategyRankings=strategy_rankings_response,
        errorMessage=error_msg,
    )


# =============================================================================
# State Machine Generation Endpoints
# =============================================================================


@router.get(
    "/candidates/approved/export",
    response_model=list[ApprovedTemplateData],
)
async def export_approved_candidates(
    session_id: str | None = None,
    project_id: UUID | None = None,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export approved candidates as ApprovedTemplateData for state machine generation.

    This endpoint fetches approved (and modified) candidates from the database
    and returns them in a format ready for the runner's generate_state_machine command.

    Args:
        session_id: Filter by capture session
        project_id: Filter by project

    Returns:
        List of ApprovedTemplateData ready for state machine generation
    """
    query = select(TemplateCandidate).where(
        TemplateCandidate.status.in_(["approved", "modified"])
    )

    if session_id:
        query = query.where(TemplateCandidate.session_id == session_id)

    if project_id:
        query = query.where(TemplateCandidate.project_id == project_id)

    query = query.order_by(TemplateCandidate.timestamp)

    result = await db.execute(query)
    candidates = result.scalars().all()

    approved_templates = []
    for c in candidates:
        # Use adjusted boundary if available, otherwise primary
        boundary_data = (
            c.adjusted_boundary if c.adjusted_boundary else c.primary_boundary
        )
        boundary = CandidateBoundingBox(**boundary_data)

        # Get state hint from metadata if set
        state_hint = None
        if c.user_metadata:
            state_hint = c.user_metadata.get("state_hint")

        # Get name from metadata if set
        name = None
        if c.user_metadata:
            name = c.user_metadata.get("name")

        approved_templates.append(
            ApprovedTemplateData(
                id=str(c.id),
                sessionId=c.session_id,
                clickX=c.click_x,
                clickY=c.click_y,
                clickTimestamp=c.timestamp,
                frameNumber=c.frame_number,
                boundary=boundary,
                name=name,
                stateHint=state_hint,
                elementType=c.element_type or "unknown",
                confidence=c.confidence_score,
                approvedAt=c.reviewed_at.isoformat() if c.reviewed_at else None,
                metadata=c.user_metadata,
            )
        )

    return approved_templates


@router.patch(
    "/candidates/{candidate_id}/state-hint",
    response_model=TemplateCandidateResponse,
)
async def set_candidate_state_hint(
    candidate_id: UUID,
    state_hint: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Set the state hint for a candidate.

    The state hint is used during state machine generation to group
    templates that belong to the same state.
    """
    result = await db.execute(
        select(TemplateCandidate).where(TemplateCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template candidate not found",
        )

    # Update metadata with state hint
    if candidate.user_metadata is None:
        candidate.user_metadata = {}
    candidate.user_metadata["state_hint"] = state_hint

    await db.commit()
    await db.refresh(candidate)

    return TemplateCandidateResponse(
        id=str(candidate.id),
        sessionId=candidate.session_id,
        projectId=str(candidate.project_id) if candidate.project_id else None,
        clickX=candidate.click_x,
        clickY=candidate.click_y,
        clickButton=candidate.click_button,
        timestamp=candidate.timestamp,
        frameNumber=candidate.frame_number,
        primaryBoundary=CandidateBoundingBox(**candidate.primary_boundary),
        status=CandidateStatus(candidate.status),
        confidenceScore=candidate.confidence_score,
        elementType=candidate.element_type,
        applicationHint=candidate.application_name,
        pixelDataUrl=candidate.pixel_data_url,
        thumbnailUrl=candidate.thumbnail_url,
        createdAt=candidate.created_at.isoformat(),
    )


@router.patch(
    "/candidates/{candidate_id}/name",
    response_model=TemplateCandidateResponse,
)
async def set_candidate_name(
    candidate_id: UUID,
    name: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Set the name for a candidate.

    The name is used during state machine generation for the StateImage.
    """
    result = await db.execute(
        select(TemplateCandidate).where(TemplateCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template candidate not found",
        )

    # Update metadata with name
    if candidate.user_metadata is None:
        candidate.user_metadata = {}
    candidate.user_metadata["name"] = name

    await db.commit()
    await db.refresh(candidate)

    return TemplateCandidateResponse(
        id=str(candidate.id),
        sessionId=candidate.session_id,
        projectId=str(candidate.project_id) if candidate.project_id else None,
        clickX=candidate.click_x,
        clickY=candidate.click_y,
        clickButton=candidate.click_button,
        timestamp=candidate.timestamp,
        frameNumber=candidate.frame_number,
        primaryBoundary=CandidateBoundingBox(**candidate.primary_boundary),
        status=CandidateStatus(candidate.status),
        confidenceScore=candidate.confidence_score,
        elementType=candidate.element_type,
        applicationHint=candidate.application_name,
        pixelDataUrl=candidate.pixel_data_url,
        thumbnailUrl=candidate.thumbnail_url,
        createdAt=candidate.created_at.isoformat(),
    )
