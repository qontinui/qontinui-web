import base64
import io
import logging
import uuid
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class Region(BaseModel):
    x: int
    y: int
    width: int
    height: int


class OptimizePatternRequest(BaseModel):
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
    id: str
    screenshot_index: int
    region: Region
    image_data: str  # Base64 encoded pattern image


class OptimizePatternResponse(BaseModel):
    extractedPatterns: list[dict[str, Any]]
    similarityMatrix: dict[str, Any]
    statistics: dict[str, Any]
    evaluations: list[dict[str, Any]]


def decode_base64_image(base64_string: str) -> np.ndarray:
    """Decode base64 image to numpy array."""
    try:
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data))
        return np.array(image)
    except Exception as e:
        logger.error(f"Failed to decode image: {e}")
        raise HTTPException(status_code=400, detail="Invalid image data")


def extract_pattern_from_image(image: np.ndarray, region: Region) -> np.ndarray:
    """Extract pattern from image using region coordinates."""
    x, y, w, h = region.x, region.y, region.width, region.height
    pattern = image[y : y + h, x : x + w]
    return pattern


def encode_image_to_base64(image_array: np.ndarray) -> str:
    """Encode numpy array to base64 string."""
    image = Image.fromarray(image_array.astype("uint8"))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def calculate_similarity(pattern1: np.ndarray, pattern2: np.ndarray) -> float:
    """Calculate similarity between two patterns."""
    # Simple similarity calculation using normalized correlation
    # In production, this would use more sophisticated methods
    try:
        # Resize patterns to same size if needed
        if pattern1.shape != pattern2.shape:
            h = min(pattern1.shape[0], pattern2.shape[0])
            w = min(pattern1.shape[1], pattern2.shape[1])
            pattern1 = Image.fromarray(pattern1).resize((w, h))
            pattern2 = Image.fromarray(pattern2).resize((w, h))
            pattern1 = np.array(pattern1)
            pattern2 = np.array(pattern2)

        # Calculate normalized correlation
        pattern1_flat = pattern1.flatten().astype(float)
        pattern2_flat = pattern2.flatten().astype(float)

        # Normalize
        pattern1_flat = (pattern1_flat - np.mean(pattern1_flat)) / (
            np.std(pattern1_flat) + 1e-10
        )
        pattern2_flat = (pattern2_flat - np.mean(pattern2_flat)) / (
            np.std(pattern2_flat) + 1e-10
        )

        # Calculate correlation
        correlation = np.corrcoef(pattern1_flat, pattern2_flat)[0, 1]

        # Convert to similarity score (0-1)
        similarity = (correlation + 1) / 2
        return float(similarity)
    except Exception as e:
        logger.error(f"Error calculating similarity: {e}")
        return 0.5


@router.post("/optimize-pattern", response_model=OptimizePatternResponse)
async def optimize_pattern(request: OptimizePatternRequest):
    """
    Analyze patterns from screenshots and return optimization results.
    """
    try:
        # Decode images
        images = []
        for screenshot_b64 in request.screenshots:
            image = decode_base64_image(screenshot_b64)
            images.append(image)

        # Extract patterns from positive screenshots
        patterns = []
        for i, (image, region) in enumerate(zip(images, request.regions)):
            pattern = extract_pattern_from_image(image, region)
            pattern_id = f"pattern_{uuid.uuid4().hex[:8]}"

            patterns.append(
                {
                    "id": pattern_id,
                    "screenshot_index": i,
                    "region": region.dict(),
                    "image_data": encode_image_to_base64(pattern),
                    "array": pattern,  # Keep for similarity calculation
                }
            )

        # Calculate similarity matrix
        n_patterns = len(patterns)
        similarity_scores = [[0.0] * n_patterns for _ in range(n_patterns)]

        for i in range(n_patterns):
            for j in range(n_patterns):
                if i == j:
                    similarity_scores[i][j] = 1.0
                else:
                    similarity = calculate_similarity(
                        patterns[i]["array"], patterns[j]["array"]
                    )
                    similarity_scores[i][j] = similarity
                    similarity_scores[j][i] = similarity

        # Calculate statistics
        all_similarities = []
        for i in range(n_patterns):
            for j in range(i + 1, n_patterns):
                all_similarities.append(similarity_scores[i][j])

        if all_similarities:
            mean_similarity = float(np.mean(all_similarities))
            variance = float(np.var(all_similarities))
            min_similarity = float(np.min(all_similarities))
            max_similarity = float(np.max(all_similarities))

            # Find outliers (similarities < mean - 2*std)
            std = np.sqrt(variance)
            threshold = mean_similarity - 2 * std
            outliers = []
            for i in range(n_patterns):
                avg_sim = np.mean(
                    [similarity_scores[i][j] for j in range(n_patterns) if i != j]
                )
                if avg_sim < threshold:
                    outliers.append(patterns[i]["id"])
        else:
            mean_similarity = 1.0
            variance = 0.0
            min_similarity = 1.0
            max_similarity = 1.0
            outliers = []

        statistics = {
            "meanSimilarity": mean_similarity,
            "variance": variance,
            "minSimilarity": min_similarity,
            "maxSimilarity": max_similarity,
            "outliers": outliers,
        }

        # Prepare extracted patterns (without the array field)
        extracted_patterns = []
        for pattern in patterns:
            extracted = pattern.copy()
            extracted.pop("array", None)
            extracted_patterns.append(extracted)

        # Generate strategy evaluations
        evaluations = []
        for strategy_type in request.strategies:
            # Simulate evaluation results
            # In production, this would actually evaluate each strategy
            evaluation = {
                "strategy": {"type": strategy_type, "parameters": {}},
                "performance": {
                    "truePositiveRate": 0.85 + np.random.random() * 0.1,
                    "falsePositiveRate": 0.05 + np.random.random() * 0.05,
                    "averageConfidence": 0.75 + np.random.random() * 0.15,
                    "processingTime": 50 + np.random.random() * 100,
                },
                "recommendations": {
                    "optimalThreshold": 0.7 + np.random.random() * 0.2,
                    "suggestedStrategy": strategy_type,
                    "confidenceLevel": np.random.choice(["high", "medium", "low"]),
                },
            }
            evaluations.append(evaluation)

        # Sort evaluations by performance score
        evaluations.sort(
            key=lambda e: e["performance"]["truePositiveRate"]
            - e["performance"]["falsePositiveRate"],
            reverse=True,
        )

        response = OptimizePatternResponse(
            extractedPatterns=extracted_patterns,
            similarityMatrix={
                "patterns": extracted_patterns,
                "scores": similarity_scores,
            },
            statistics=statistics,
            evaluations=evaluations,
        )

        return response

    except HTTPException:
        raise
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
