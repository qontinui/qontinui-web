"""
API endpoints for GUI element analysis
"""

import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from app.api.deps import get_async_db, get_current_user_async
from app.models.analysis_result import (
    AnalysisJob,
    AnalyzerResult,
    DetectedElementModel,
    FusedElement,
)
from app.models.annotation import AnnotationSet
from app.models.user import User
from app.schemas.analysis import (
    AnalysisJobDetailSchema,
    AnalysisJobListResponse,
    AnalysisJobSchema,
    AnalysisRequest,
    AnalysisResponse,
    AnalyzerInfoSchema,
    AnalyzerListResponse,
    AnalyzerResultSchema,
    BoundingBoxSchema,
    DetectedElementSchema,
    FusedElementSchema,
    QuickAnalysisRequest,
)
from app.services.analysis import AnalysisOrchestrator
from app.services.analysis.base import AnalysisInput
from app.services.analysis.orchestrator import analyzer_registry
from app.services.analysis.progress import ProgressTracker
from app.services.object_storage import object_storage
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

router = APIRouter()


# Initialize orchestrator and progress tracker
progress_tracker = ProgressTracker()
orchestrator = AnalysisOrchestrator(progress_tracker=progress_tracker)


@router.get("/analyzers", response_model=AnalyzerListResponse)
async def list_analyzers(
    current_user: User = Depends(get_current_user_async),
):
    """
    List all available analyzers

    Returns information about each registered analyzer including:
    - Name and type
    - Version
    - Multi-screenshot support
    - Required parameters
    """
    try:
        analyzers = analyzer_registry.list_analyzers()

        return AnalyzerListResponse(
            analyzers=[AnalyzerInfoSchema(**a) for a in analyzers], total=len(analyzers)
        )
    except Exception as e:
        logger.error(f"Error listing analyzers: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze", response_model=AnalysisResponse)
async def run_analysis(
    request: AnalysisRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Run analysis on an annotation set

    This endpoint:
    1. Validates the annotation set exists and user has access
    2. Downloads screenshot data
    3. Runs specified analyzers (or all if not specified)
    4. Optionally fuses results
    5. Optionally saves to database
    6. Returns analysis results
    """
    try:
        # Check annotation set exists and user has access
        result = await db.execute(
            select(AnnotationSet).where(
                AnnotationSet.id == str(request.annotation_set_id)
            )
        )
        annotation_set = result.scalar_one_or_none()

        if not annotation_set:
            raise HTTPException(status_code=404, detail="Annotation set not found")

        # Check user has access (must be owner or admin)
        if (
            annotation_set.created_by_id != str(current_user.id)
            and not current_user.is_superuser
        ):
            raise HTTPException(status_code=403, detail="Access denied")

        # Get screenshots metadata
        screenshots = annotation_set.screenshots or []
        if not screenshots:
            # Fall back to single screenshot mode
            screenshots = [
                {
                    "name": annotation_set.screenshot_name,
                    "url": annotation_set.screenshot_url,
                    "width": annotation_set.image_width,
                    "height": annotation_set.image_height,
                }
            ]

        # Download screenshot data
        screenshot_data = []
        for screenshot in screenshots:
            try:
                # Strip /uploads/ prefix if present to get the storage key
                url = screenshot["url"]
                if url.startswith("/uploads/"):
                    key = url[len("/uploads/") :]
                elif url.startswith("uploads/"):
                    key = url[len("uploads/") :]
                else:
                    key = url

                logger.info(f"Downloading screenshot: url={url}, key={key}")
                data = object_storage.download_file(key)
                screenshot_data.append(data)
            except Exception as e:
                logger.error(f"Error downloading screenshot {screenshot['url']}: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to download screenshot: {screenshot['name']}",
                )

        # Create analysis input
        analysis_input = AnalysisInput(
            annotation_set_id=request.annotation_set_id,
            screenshots=screenshots,
            screenshot_data=screenshot_data,
            parameters=request.analyzer_configs or {},
        )

        # Generate a temporary job ID for progress tracking
        import uuid

        temp_job_id = uuid.uuid4()

        # Run analysis
        results = await orchestrator.analyze(
            input_data=analysis_input,
            analyzer_names=request.analyzer_names,
            analyzer_configs=request.analyzer_configs,
            parallel=request.parallel,
            fuse_results=request.fuse_results,
            overlap_threshold=request.overlap_threshold,
            job_id=temp_job_id,
        )

        # Save to database if requested
        analysis_job_id = None
        if request.save_to_database:
            analysis_job_id = await _save_analysis_to_db(
                db, annotation_set, results, request, current_user
            )

        # Convert to response schema
        response = AnalysisResponse(
            analysis_job_id=analysis_job_id,
            progress_job_id=temp_job_id,  # Return progress ID for potential polling
            annotation_set_id=request.annotation_set_id,
            analyzer_results=[
                _convert_analyzer_result(r) for r in results["analyzer_results"]
            ],
            fused_elements=(
                [_convert_fused_element(e) for e in results.get("fused_elements", [])]
                if request.fuse_results
                else None
            ),
            fusion_stats=results.get("fusion_stats"),
            analyzer_statistics=results["analyzer_statistics"],
            status="completed",
        )

        # Clean up progress data after completion
        await progress_tracker.clear_progress(temp_job_id)

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error running analysis: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze/quick", response_model=AnalysisResponse)
async def run_quick_analysis(
    request: QuickAnalysisRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Run quick analysis without saving to database

    This is faster for testing different analyzer configurations
    """
    full_request = AnalysisRequest(
        annotation_set_id=request.annotation_set_id,
        analyzer_names=request.analyzers,
        fuse_results=request.fuse_results,
        save_to_database=False,
    )

    return await run_analysis(
        request=full_request,
        background_tasks=BackgroundTasks(),
        db=db,
        current_user=current_user,
    )


@router.get("/jobs", response_model=AnalysisJobListResponse)
async def list_analysis_jobs(
    annotation_set_id: Optional[UUID] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    List analysis jobs

    Filter by:
    - annotation_set_id: Show jobs for specific annotation set
    - status: pending, running, completed, failed
    - page, page_size: Pagination
    """
    try:
        # Build query
        query = select(AnalysisJob)

        # Filter by annotation set
        if annotation_set_id:
            query = query.where(AnalysisJob.annotation_set_id == annotation_set_id)

        # Filter by status
        if status:
            query = query.where(AnalysisJob.status == status)

        # Filter by user (non-admins see only their jobs)
        if not current_user.is_superuser:
            query = query.where(AnalysisJob.created_by_id == current_user.id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # Add pagination
        query = query.order_by(desc(AnalysisJob.created_at))
        query = query.offset((page - 1) * page_size).limit(page_size)

        # Execute
        result = await db.execute(query)
        jobs = result.scalars().all()

        return AnalysisJobListResponse(
            jobs=[AnalysisJobSchema.model_validate(job) for job in jobs],
            total=total,
            page=page,
            page_size=page_size,
        )

    except Exception as e:
        logger.error(f"Error listing analysis jobs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}", response_model=AnalysisJobDetailSchema)
async def get_analysis_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Get detailed analysis job results

    Includes all fused elements
    """
    try:
        # Load job with relationships
        result = await db.execute(
            select(AnalysisJob)
            .where(AnalysisJob.id == job_id)
            .options(selectinload(AnalysisJob.fused_elements))
        )
        job = result.scalar_one_or_none()

        if not job:
            raise HTTPException(status_code=404, detail="Analysis job not found")

        # Check access
        if job.created_by_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")

        # Convert to schema
        job_dict = {
            "id": job.id,
            "annotation_set_id": job.annotation_set_id,
            "analyzers_used": job.analyzers_used,
            "parameters": job.parameters,
            "fusion_enabled": bool(job.fusion_enabled),
            "fusion_config": job.fusion_config,
            "status": job.status,
            "started_at": job.started_at,
            "completed_at": job.completed_at,
            "error_message": job.error_message,
            "total_elements_found": job.total_elements_found,
            "total_fused_elements": job.total_fused_elements,
            "analyzer_statistics": job.analyzer_statistics,
            "created_at": job.created_at,
            "created_by_id": job.created_by_id,
            "fused_elements": [
                FusedElementSchema(
                    bounding_box=BoundingBoxSchema(
                        x=elem.x, y=elem.y, width=elem.width, height=elem.height
                    ),
                    confidence=elem.confidence,
                    sources=elem.sources,
                    source_confidences=elem.source_confidences,
                    votes=elem.votes,
                    label=elem.label,
                    element_type=elem.element_type,
                    screenshot_index=elem.screenshot_index,
                    metadata=elem.metadata or {},
                )
                for elem in job.fused_elements
            ],
        }

        return AnalysisJobDetailSchema(**job_dict)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting analysis job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/jobs/{job_id}")
async def delete_analysis_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Delete an analysis job and all its results
    """
    try:
        result = await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))
        job = result.scalar_one_or_none()

        if not job:
            raise HTTPException(status_code=404, detail="Analysis job not found")

        # Check access
        if job.created_by_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")

        await db.delete(job)
        await db.commit()

        return {"message": "Analysis job deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting analysis job: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/progress/{job_id}")
async def get_analysis_progress(
    job_id: UUID,
    current_user: User = Depends(get_current_user_async),
):
    """
    Get real-time progress of an analysis job

    Returns progress information including:
    - Overall status
    - Current analyzer being run
    - Progress per analyzer
    - Fusion status
    """
    try:
        progress = await progress_tracker.get_progress(job_id)

        if not progress:
            raise HTTPException(
                status_code=404,
                detail="Progress not found. Job may be completed or does not exist.",
            )

        return progress

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting analysis progress: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# Helper functions


async def _save_analysis_to_db(
    db: AsyncSession,
    annotation_set: AnnotationSet,
    results: dict,
    request: AnalysisRequest,
    user: User,
) -> UUID:
    """Save analysis results to database"""
    try:
        # Create analysis job
        job = AnalysisJob(
            annotation_set_id=annotation_set.id,
            analyzers_used=request.analyzer_names
            or [a["analyzer_name"] for a in results["analyzer_results"]],
            parameters=request.analyzer_configs,
            fusion_enabled=1 if request.fuse_results else 0,
            fusion_config=(
                {"overlap_threshold": request.overlap_threshold}
                if request.fuse_results
                else None
            ),
            status="completed",
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
            total_elements_found=sum(
                len(r["elements"]) for r in results["analyzer_results"]
            ),
            total_fused_elements=len(results.get("fused_elements", [])),
            analyzer_statistics=results["analyzer_statistics"],
            created_by_id=user.id,
        )
        db.add(job)
        await db.flush()

        # Save fused elements if available
        if request.fuse_results and "fused_elements" in results:
            for elem_data in results["fused_elements"]:
                elem = FusedElement(
                    analysis_job_id=job.id,
                    x=elem_data["bounding_box"]["x"],
                    y=elem_data["bounding_box"]["y"],
                    width=elem_data["bounding_box"]["width"],
                    height=elem_data["bounding_box"]["height"],
                    confidence=elem_data["confidence"],
                    votes=elem_data["votes"],
                    sources=elem_data["sources"],
                    source_confidences=elem_data["source_confidences"],
                    label=elem_data.get("label"),
                    element_type=elem_data.get("element_type"),
                    screenshot_index=elem_data.get("screenshot_index", 0),
                    element_metadata=elem_data.get("metadata"),
                )
                db.add(elem)

        await db.commit()
        return job.id

    except Exception as e:
        logger.error(f"Error saving analysis to database: {e}", exc_info=True)
        await db.rollback()
        raise


def _convert_analyzer_result(result_dict: dict) -> AnalyzerResultSchema:
    """Convert analyzer result dict to schema"""
    return AnalyzerResultSchema(
        analyzer_type=result_dict["analyzer_type"],
        analyzer_name=result_dict["analyzer_name"],
        elements=[
            DetectedElementSchema(
                bounding_box=BoundingBoxSchema(**elem["bounding_box"]),
                confidence=elem["confidence"],
                label=elem.get("label"),
                element_type=elem.get("element_type"),
                screenshot_index=elem.get("screenshot_index", 0),
                metadata=elem.get("metadata", {}),
            )
            for elem in result_dict["elements"]
        ],
        confidence=result_dict["confidence"],
        metadata=result_dict.get("metadata", {}),
    )


def _convert_fused_element(elem_dict: dict) -> FusedElementSchema:
    """Convert fused element dict to schema"""
    return FusedElementSchema(
        bounding_box=BoundingBoxSchema(**elem_dict["bounding_box"]),
        confidence=elem_dict["confidence"],
        sources=elem_dict["sources"],
        source_confidences=elem_dict["source_confidences"],
        votes=elem_dict["votes"],
        label=elem_dict.get("label"),
        element_type=elem_dict.get("element_type"),
        screenshot_index=elem_dict.get("screenshot_index", 0),
        metadata=elem_dict.get("metadata", {}),
    )
