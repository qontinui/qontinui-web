"""
API endpoints for region analysis (inventory grids, minimaps, etc.)
"""

import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from app.api.deps import get_async_db, get_current_user_async
from app.models.annotation import AnnotationSet
from app.models.region_result import (
    DetectedRegionModel,
    FusedRegionModel,
    RegionAnalysisJob,
    RegionAnalyzerResult,
)
from app.models.user import User
from app.schemas.region_analysis import (
    BoundingBoxSchema,
    DetectedRegionSchema,
    FusedRegionSchema,
    GridCellSchema,
    GridMetadataSchema,
    QuickRegionAnalysisRequest,
    RegionAnalysisRequest,
    RegionAnalysisResponse,
    RegionAnalyzerInfoSchema,
    RegionAnalyzerListResponse,
    RegionAnalyzerResultSchema,
    RegionJobDetailSchema,
    RegionJobListResponse,
    RegionJobSchema,
)
from app.services.object_storage import object_storage
from app.services.region_analysis.base import RegionAnalysisInput
from app.services.region_analysis.orchestrator import (
    RegionOrchestrator,
    region_analyzer_registry,
)
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

router = APIRouter()


# Initialize orchestrator
orchestrator = RegionOrchestrator()


@router.get("/analyzers", response_model=RegionAnalyzerListResponse)
async def list_region_analyzers(
    current_user: User = Depends(get_current_user_async),
):
    """
    List all available region analyzers

    Returns information about each registered region analyzer including:
    - Name and version
    - Supported region types (inventory_grid, minimap, etc.)
    - Required parameters
    """
    try:
        analyzers = region_analyzer_registry.list_analyzers()

        return RegionAnalyzerListResponse(
            analyzers=[RegionAnalyzerInfoSchema(**a) for a in analyzers],
            total=len(analyzers),
        )
    except Exception as e:
        logger.error(f"Error listing region analyzers: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze", response_model=RegionAnalysisResponse)
async def run_region_analysis(
    request: RegionAnalysisRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Run region analysis on an annotation set

    This endpoint:
    1. Validates the annotation set exists and user has access
    2. Downloads screenshot data
    3. Runs specified region analyzers (or all if not specified)
    4. Optionally fuses results
    5. Optionally saves to database
    6. Returns region analysis results with grid metadata
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
                data = object_storage.download_file(screenshot["url"])
                screenshot_data.append(data)
            except Exception as e:
                logger.error(f"Error downloading screenshot {screenshot['url']}: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to download screenshot: {screenshot['name']}",
                )

        # Create region analysis input
        analysis_input = RegionAnalysisInput(
            annotation_set_id=request.annotation_set_id,
            screenshots=screenshots,
            screenshot_data=screenshot_data,
            parameters=request.analyzer_configs or {},
        )

        # Run region analysis
        results = await orchestrator.analyze(
            input_data=analysis_input,
            analyzer_names=request.analyzer_names,
            analyzer_configs=request.analyzer_configs,
            parallel=request.parallel,
            fuse_results=request.fuse_results,
            overlap_threshold=request.overlap_threshold,
        )

        # Save to database if requested
        analysis_job_id = None
        if request.save_to_database:
            analysis_job_id = await _save_region_analysis_to_db(
                db, annotation_set, results, request, current_user
            )

        # Convert to response schema
        response = RegionAnalysisResponse(
            analysis_job_id=analysis_job_id,
            annotation_set_id=request.annotation_set_id,
            analyzer_results=[
                _convert_region_analyzer_result(r) for r in results["analyzer_results"]
            ],
            fused_regions=(
                [_convert_fused_region(r) for r in results.get("fused_regions", [])]
                if request.fuse_results
                else None
            ),
            fusion_stats=results.get("fusion_stats"),
            analyzer_statistics=results["analyzer_statistics"],
            status="completed",
        )

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error running region analysis: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze/quick", response_model=RegionAnalysisResponse)
async def run_quick_region_analysis(
    request: QuickRegionAnalysisRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Run quick region analysis without saving to database

    This is faster for testing different region analyzer configurations
    """
    full_request = RegionAnalysisRequest(
        annotation_set_id=request.annotation_set_id,
        analyzer_names=request.analyzers,
        fuse_results=request.fuse_results,
        save_to_database=False,
    )

    return await run_region_analysis(
        request=full_request,
        background_tasks=BackgroundTasks(),
        db=db,
        current_user=current_user,
    )


@router.get("/jobs", response_model=RegionJobListResponse)
async def list_region_analysis_jobs(
    annotation_set_id: Optional[UUID] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    List region analysis jobs

    Filter by:
    - annotation_set_id: Show jobs for specific annotation set
    - status: pending, running, completed, failed
    - page, page_size: Pagination
    """
    try:
        # Build query
        query = select(RegionAnalysisJob)

        # Filter by annotation set
        if annotation_set_id:
            query = query.where(
                RegionAnalysisJob.annotation_set_id == annotation_set_id
            )

        # Filter by status
        if status:
            query = query.where(RegionAnalysisJob.status == status)

        # Filter by user (non-admins see only their jobs)
        if not current_user.is_superuser:
            query = query.where(RegionAnalysisJob.created_by_id == current_user.id)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # Add pagination
        query = query.order_by(desc(RegionAnalysisJob.created_at))
        query = query.offset((page - 1) * page_size).limit(page_size)

        # Execute
        result = await db.execute(query)
        jobs = result.scalars().all()

        return RegionJobListResponse(
            jobs=[RegionJobSchema.model_validate(job) for job in jobs],
            total=total,
            page=page,
            page_size=page_size,
        )

    except Exception as e:
        logger.error(f"Error listing region analysis jobs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}", response_model=RegionJobDetailSchema)
async def get_region_analysis_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Get detailed region analysis job results

    Includes all fused regions with grid metadata
    """
    try:
        # Load job with relationships
        result = await db.execute(
            select(RegionAnalysisJob)
            .where(RegionAnalysisJob.id == job_id)
            .options(selectinload(RegionAnalysisJob.fused_regions))
        )
        job = result.scalar_one_or_none()

        if not job:
            raise HTTPException(status_code=404, detail="Region analysis job not found")

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
            "total_regions_found": job.total_regions_found,
            "total_fused_regions": job.total_fused_regions,
            "analyzer_statistics": job.analyzer_statistics,
            "created_at": job.created_at,
            "created_by_id": job.created_by_id,
            "fused_regions": [
                FusedRegionSchema(
                    bounding_box=BoundingBoxSchema(
                        x=region.x, y=region.y, width=region.width, height=region.height
                    ),
                    confidence=region.confidence,
                    sources=region.sources,
                    source_confidences=region.source_confidences,
                    votes=region.votes,
                    label=region.label,
                    region_type=region.region_type,
                    screenshot_index=region.screenshot_index,
                    grid_metadata=(
                        _convert_grid_metadata(region.grid_metadata)
                        if region.grid_metadata
                        else None
                    ),
                    metadata=region.region_metadata or {},
                )
                for region in job.fused_regions
            ],
        }

        return RegionJobDetailSchema(**job_dict)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting region analysis job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/jobs/{job_id}")
async def delete_region_analysis_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user_async),
):
    """
    Delete a region analysis job and all its results
    """
    try:
        result = await db.execute(
            select(RegionAnalysisJob).where(RegionAnalysisJob.id == job_id)
        )
        job = result.scalar_one_or_none()

        if not job:
            raise HTTPException(status_code=404, detail="Region analysis job not found")

        # Check access
        if job.created_by_id != current_user.id and not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Access denied")

        await db.delete(job)
        await db.commit()

        return {"message": "Region analysis job deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting region analysis job: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# Helper functions


async def _save_region_analysis_to_db(
    db: AsyncSession,
    annotation_set: AnnotationSet,
    results: dict,
    request: RegionAnalysisRequest,
    user: User,
) -> UUID:
    """Save region analysis results to database"""
    try:
        # Create region analysis job
        job = RegionAnalysisJob(
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
            total_regions_found=sum(
                len(r["regions"]) for r in results["analyzer_results"]
            ),
            total_fused_regions=len(results.get("fused_regions", [])),
            analyzer_statistics=results["analyzer_statistics"],
            created_by_id=user.id,
        )
        db.add(job)
        await db.flush()

        # Save fused regions if available
        if request.fuse_results and "fused_regions" in results:
            for region_data in results["fused_regions"]:
                region = FusedRegionModel(
                    analysis_job_id=job.id,
                    x=region_data["bounding_box"]["x"],
                    y=region_data["bounding_box"]["y"],
                    width=region_data["bounding_box"]["width"],
                    height=region_data["bounding_box"]["height"],
                    confidence=region_data["confidence"],
                    votes=region_data["votes"],
                    sources=region_data["sources"],
                    source_confidences=region_data["source_confidences"],
                    label=region_data.get("label"),
                    region_type=region_data.get("region_type"),
                    screenshot_index=region_data.get("screenshot_index", 0),
                    grid_metadata=region_data.get("grid_metadata"),
                    region_metadata=region_data.get("metadata"),
                )
                db.add(region)

        await db.commit()
        return job.id

    except Exception as e:
        logger.error(f"Error saving region analysis to database: {e}", exc_info=True)
        await db.rollback()
        raise


def _convert_region_analyzer_result(result_dict: dict) -> RegionAnalyzerResultSchema:
    """Convert region analyzer result dict to schema"""
    return RegionAnalyzerResultSchema(
        analyzer_name=result_dict["analyzer_name"],
        regions=[
            DetectedRegionSchema(
                bounding_box=BoundingBoxSchema(**region["bounding_box"]),
                confidence=region["confidence"],
                label=region.get("label"),
                region_type=region.get("region_type"),
                screenshot_index=region.get("screenshot_index", 0),
                grid_metadata=(
                    _convert_grid_metadata(region.get("grid_metadata"))
                    if region.get("grid_metadata")
                    else None
                ),
                metadata=region.get("metadata", {}),
            )
            for region in result_dict["regions"]
        ],
        confidence=result_dict["confidence"],
        metadata=result_dict.get("metadata", {}),
    )


def _convert_fused_region(region_dict: dict) -> FusedRegionSchema:
    """Convert fused region dict to schema"""
    return FusedRegionSchema(
        bounding_box=BoundingBoxSchema(**region_dict["bounding_box"]),
        confidence=region_dict["confidence"],
        sources=region_dict["sources"],
        source_confidences=region_dict["source_confidences"],
        votes=region_dict["votes"],
        label=region_dict.get("label"),
        region_type=region_dict.get("region_type"),
        screenshot_index=region_dict.get("screenshot_index", 0),
        grid_metadata=(
            _convert_grid_metadata(region_dict.get("grid_metadata"))
            if region_dict.get("grid_metadata")
            else None
        ),
        metadata=region_dict.get("metadata", {}),
    )


def _convert_grid_metadata(grid_data: dict) -> GridMetadataSchema:
    """Convert grid metadata dict to schema"""
    if not grid_data:
        return None

    return GridMetadataSchema(
        rows=grid_data["rows"],
        cols=grid_data["cols"],
        cells=[GridCellSchema(**cell) for cell in grid_data["cells"]],
        cell_spacing=grid_data.get("cell_spacing"),
        cell_size=grid_data.get("cell_size"),
    )
