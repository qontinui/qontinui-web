import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.pattern_optimization_service import (
    PatternOptimizationService,
)
from app.services.pattern_optimization_service import (
    Region as ServiceRegion,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class Region(BaseModel):
    """Region coordinates for pattern extraction."""

    x: int
    y: int
    width: int
    height: int

    def to_service_region(self) -> ServiceRegion:
        """Convert to service Region dataclass."""
        return ServiceRegion(x=self.x, y=self.y, width=self.width, height=self.height)


class OptimizePatternRequest(BaseModel):
    """Request model for pattern optimization."""

    screenshots: list[str]  # Base64 encoded images
    negative_screenshots: list[str] | None = []
    regions: list[Region]
    strategies: list[str] | None = [
        "multi-pattern",
        "consensus",
        "feature-based",
        "differential",
    ]


class ExtractedPattern(BaseModel):
    """Extracted pattern data."""

    id: str
    screenshot_index: int
    region: Region
    image_data: str  # Base64 encoded pattern image


class OptimizePatternResponse(BaseModel):
    """Response model for pattern optimization."""

    extractedPatterns: list[dict[str, Any]]
    similarityMatrix: dict[str, Any]
    statistics: dict[str, Any]
    evaluations: list[dict[str, Any]]


@router.post("/optimize-pattern", response_model=OptimizePatternResponse)
async def optimize_pattern(request: OptimizePatternRequest):
    """
    Analyze patterns from screenshots and return optimization results.

    This endpoint:
    1. Extracts patterns from screenshots at specified regions
    2. Calculates similarity between all pattern pairs
    3. Computes statistics (mean, variance, outliers)
    4. Evaluates different matching strategies

    Args:
        request: Pattern optimization request with screenshots and regions

    Returns:
        Optimization results including patterns, similarity matrix, and evaluations

    Raises:
        HTTPException: If image processing fails or invalid data provided
    """
    try:
        # Initialize service
        service = PatternOptimizationService()

        # Convert request regions to service regions
        service_regions = [region.to_service_region() for region in request.regions]

        # Extract patterns from screenshots
        patterns = service.extract_patterns(request.screenshots, service_regions)

        # Calculate similarity matrix
        similarity_matrix = service.calculate_similarity_matrix(patterns)

        # Calculate statistics
        pattern_ids = [p.id for p in patterns]
        stats = service.calculate_statistics(similarity_matrix, pattern_ids)

        # Evaluate strategies
        evaluations = service.evaluate_strategies(patterns, request.strategies)

        # Prepare response data (remove numpy arrays)
        extracted_patterns = service.prepare_response_data(patterns)

        # Build response
        response = OptimizePatternResponse(
            extractedPatterns=extracted_patterns,
            similarityMatrix={
                "patterns": extracted_patterns,
                "scores": similarity_matrix,
            },
            statistics={
                "meanSimilarity": stats.mean_similarity,
                "variance": stats.variance,
                "minSimilarity": stats.min_similarity,
                "maxSimilarity": stats.max_similarity,
                "outliers": stats.outliers,
            },
            evaluations=evaluations,
        )

        return response

    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Pattern optimization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateStateImageRequest(BaseModel):
    name: str
    patterns: list[dict[str, Any]]
    strategy_type: str
    similarity_threshold: float = 0.8


@router.post("/create-state-image")
async def create_state_image(request: CreateStateImageRequest):
    """
    Create a StateImage from optimized patterns.
    """
    try:
        # In production, this would actually create a StateImage in the qontinui system
        # For now, we'll return a success response

        return {
            "success": True,
            "message": f"StateImage '{request.name}' created with {len(request.patterns)} patterns",
            "stateImage": {
                "name": request.name,
                "patternCount": len(request.patterns),
                "strategy": request.strategy_type,
                "threshold": request.similarity_threshold,
            },
        }

    except Exception as e:
        logger.error(f"Failed to create StateImage: {e}")
        raise HTTPException(status_code=500, detail=str(e))
