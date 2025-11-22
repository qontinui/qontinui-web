"""
Active Learning Detector - Adaptive Learning with User Feedback

Starts with heuristic-based detection, then improves over time by:
1. Accepting user corrections (false positives, false negatives)
2. Retraining lightweight model incrementally
3. Building user-specific/app-specific detection patterns

Uses a simple online learning approach with feature extraction.
"""

import json
import logging
import os
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

from ..base import (
    AnalysisInput,
    AnalysisResult,
    AnalysisType,
    BaseAnalyzer,
    BoundingBox,
    DetectedElement,
)

logger = logging.getLogger(__name__)


class ActiveLearningDetector(BaseAnalyzer):
    """
    Adaptive detector that learns from user feedback

    Components:
    1. Initial Detection: Heuristic-based baseline detector
    2. Feedback Loop: Accept user corrections
    3. Feature Learning: Extract visual features from corrections
    4. Model Update: Incrementally update detection weights
    5. Improved Detection: Use learned patterns

    Stores learned patterns for future sessions.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)

        # Initialize learning state
        self.positive_examples = []  # List of (features, bbox) for true buttons
        self.negative_examples = []  # List of (features, bbox) for non-buttons

        # Simple linear model weights (feature_dim,)
        self.weights = None
        self.bias = 0.0

        # Learning rate
        self.learning_rate = 0.01

        # Load persisted model if available
        self._load_model()

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        return "active_learning"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            # Heuristic detection params
            "min_area": 500,
            "max_area": 50000,
            "min_aspect_ratio": 1.5,
            "max_aspect_ratio": 8.0,
            "edge_threshold": 50,
            # Learning params
            "use_learned_model": True,  # Whether to use learned patterns
            "confidence_boost": 0.2,  # Confidence boost from learned model
            "min_learned_confidence": 0.6,  # Min confidence for learned detections
            # Model persistence
            "model_path": "/tmp/active_learning_model.json",
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform adaptive detection"""
        logger.info(
            f"Running active learning detection on {len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images
        images = self._load_images(input_data.screenshot_data)

        # Analyze each screenshot
        all_elements = []
        for screenshot_idx, img in enumerate(images):
            elements = await self._analyze_screenshot(img, screenshot_idx, params)
            all_elements.extend(elements)

        avg_confidence = (
            np.mean([e.confidence for e in all_elements]) if all_elements else 0.0
        )

        # Calculate model stats
        model_status = "initialized" if self.weights is not None else "heuristic_only"
        num_examples = len(self.positive_examples) + len(self.negative_examples)

        logger.info(
            f"Found {len(all_elements)} elements with avg confidence {avg_confidence:.2f}"
            f" (model: {model_status}, examples: {num_examples})"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=float(avg_confidence),
            metadata={
                "num_screenshots": len(images),
                "method": "active_learning",
                "model_status": model_status,
                "num_positive_examples": len(self.positive_examples),
                "num_negative_examples": len(self.negative_examples),
                "parameters": params,
            },
        )

    def _load_images(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots as numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("RGB")
            images.append(np.array(img))
        return images

    async def _analyze_screenshot(
        self, img: np.ndarray, screenshot_idx: int, params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """Analyze single screenshot"""

        # Step 1: Heuristic baseline detection
        candidates = self._heuristic_detection(img, params)

        logger.info(
            f"Screenshot {screenshot_idx}: {len(candidates)} heuristic candidates"
        )

        # Step 2: If model is trained, apply learned patterns
        if params["use_learned_model"] and self.weights is not None:
            candidates = self._apply_learned_model(img, candidates, params)

        # Convert to DetectedElement
        elements = []
        for bbox, confidence, method in candidates:
            elements.append(
                DetectedElement(
                    bounding_box=bbox,
                    confidence=confidence,
                    label="Button (Adaptive)",
                    element_type="button",
                    screenshot_index=screenshot_idx,
                    metadata={
                        "method": "active_learning",
                        "detection_method": method,
                    },
                )
            )

        return elements

    def _heuristic_detection(
        self, img: np.ndarray, params: Dict[str, Any]
    ) -> List[Tuple[BoundingBox, float, str]]:
        """
        Baseline heuristic detection

        Returns list of (bbox, confidence, method) tuples
        """
        candidates = []

        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

        # Edge-based detection
        edges = cv2.Canny(gray, params["edge_threshold"], params["edge_threshold"] * 2)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

        # Find contours
        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)

            area = w * h
            if not (params["min_area"] <= area <= params["max_area"]):
                continue

            aspect_ratio = w / h if h > 0 else 0
            if not (
                params["min_aspect_ratio"] <= aspect_ratio <= params["max_aspect_ratio"]
            ):
                continue

            # Basic confidence from shape properties
            confidence = 0.5

            # Boost for typical button aspect ratios
            if 2.0 <= aspect_ratio <= 5.0:
                confidence += 0.1

            bbox = BoundingBox(x=x, y=y, width=w, height=h)
            candidates.append((bbox, confidence, "heuristic"))

        return candidates

    def _apply_learned_model(
        self,
        img: np.ndarray,
        candidates: List[Tuple[BoundingBox, float, str]],
        params: Dict[str, Any],
    ) -> List[Tuple[BoundingBox, float, str]]:
        """
        Apply learned model to refine candidates

        Updates confidence scores based on learned patterns
        """
        refined_candidates = []

        for bbox, base_confidence, method in candidates:
            # Extract features
            features = self._extract_features(img, bbox)

            # Predict using learned model
            learned_score = self._predict(features)

            # Combine heuristic and learned scores
            if learned_score > 0.5:
                # Model thinks it's a button - boost confidence
                confidence = min(0.95, base_confidence + params["confidence_boost"])
                method = "learned"
            else:
                # Model is uncertain or thinks it's not a button
                confidence = base_confidence * learned_score * 2  # Reduce confidence

            # Only keep if meets minimum threshold
            if confidence >= params["min_learned_confidence"]:
                refined_candidates.append((bbox, confidence, method))

        return refined_candidates

    def _extract_features(self, img: np.ndarray, bbox: BoundingBox) -> np.ndarray:
        """
        Extract feature vector from image region

        Features:
        - Size and aspect ratio
        - Color statistics (mean, std in HSV)
        - Edge density
        - Texture features
        - Padding/isolation features
        """
        x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height

        # Extract region
        region = img[y : y + h, x : x + w]

        if region.size == 0:
            return np.zeros(20)  # Feature dimension

        features = []

        # 1. Size features (2)
        features.append(np.log1p(w * h) / 10.0)  # Log area, normalized
        features.append(w / h if h > 0 else 0)  # Aspect ratio

        # 2. Color features (6)
        hsv = cv2.cvtColor(region, cv2.COLOR_RGB2HSV)
        for channel in range(3):
            features.append(np.mean(hsv[:, :, channel]) / 255.0)
            features.append(np.std(hsv[:, :, channel]) / 255.0)

        # 3. Edge features (2)
        gray = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.sum(edges > 0) / edges.size
        edge_mean = np.mean(edges) / 255.0
        features.extend([edge_density, edge_mean])

        # 4. Texture features (4)
        # Use Laplacian variance as texture measure
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        texture_variance = np.var(laplacian)
        texture_mean = np.mean(np.abs(laplacian))
        features.append(np.log1p(texture_variance) / 10.0)
        features.append(np.log1p(texture_mean) / 10.0)

        # Gradient features
        gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        gradient_mag = np.sqrt(gx**2 + gy**2)
        features.append(np.mean(gradient_mag) / 255.0)
        features.append(np.std(gradient_mag) / 255.0)

        # 5. Spatial features (2)
        # Normalized position in image
        features.append(x / img.shape[1])
        features.append(y / img.shape[0])

        # 6. Shape features (4)
        # Rectangularity, compactness
        perimeter = 2 * (w + h)
        compactness = (4 * np.pi * w * h) / (perimeter**2) if perimeter > 0 else 0
        features.append(compactness)

        # Symmetry (horizontal)
        left_half = region[:, : w // 2]
        right_half = region[:, w // 2 :]
        if left_half.shape == right_half.shape and left_half.size > 0:
            right_flipped = np.fliplr(right_half)
            symmetry = (
                np.mean(np.abs(left_half.astype(float) - right_flipped.astype(float)))
                / 255.0
            )
            features.append(1 - symmetry)  # Higher = more symmetric
        else:
            features.append(0.5)

        # Fill to 20 features
        while len(features) < 20:
            features.append(0.0)

        return np.array(features[:20], dtype=np.float32)

    def _predict(self, features: np.ndarray) -> float:
        """
        Predict button probability using learned model

        Returns probability score (0-1)
        """
        if self.weights is None:
            return 0.5  # Neutral if not trained

        # Linear model: score = w^T * x + b
        score = np.dot(self.weights, features) + self.bias

        # Apply sigmoid for probability
        prob = 1 / (1 + np.exp(-score))

        return prob

    def add_positive_example(self, img: np.ndarray, bbox: BoundingBox):
        """
        Add positive example (true button) for learning

        Call this when user confirms a detection or adds a missed button
        """
        features = self._extract_features(img, bbox)
        self.positive_examples.append((features, bbox))

        # Incremental update
        self._update_model()
        self._save_model()

        logger.info(f"Added positive example. Total: {len(self.positive_examples)}")

    def add_negative_example(self, img: np.ndarray, bbox: BoundingBox):
        """
        Add negative example (false positive) for learning

        Call this when user rejects a detection
        """
        features = self._extract_features(img, bbox)
        self.negative_examples.append((features, bbox))

        # Incremental update
        self._update_model()
        self._save_model()

        logger.info(f"Added negative example. Total: {len(self.negative_examples)}")

    def _update_model(self):
        """
        Update model weights using stochastic gradient descent

        Simple online learning approach
        """
        if not self.positive_examples and not self.negative_examples:
            return

        # Initialize weights if needed
        if self.weights is None:
            feature_dim = 20
            self.weights = np.zeros(feature_dim, dtype=np.float32)
            self.bias = 0.0

        # Perform one epoch of SGD
        examples = [(f, 1.0) for f, _ in self.positive_examples] + [
            (f, 0.0) for f, _ in self.negative_examples
        ]

        # Shuffle
        np.random.shuffle(examples)

        # Update
        for features, label in examples:
            # Predict
            prediction = self._predict(features)

            # Gradient
            error = prediction - label
            gradient_w = error * features
            gradient_b = error

            # Update weights
            self.weights -= self.learning_rate * gradient_w
            self.bias -= self.learning_rate * gradient_b

        logger.info("Model updated with new examples")

    def _save_model(self):
        """Save model to disk for persistence"""
        model_path = self.config.get("model_path", "/tmp/active_learning_model.json")

        try:
            model_data = {
                "weights": self.weights.tolist() if self.weights is not None else None,
                "bias": float(self.bias),
                "num_positive": len(self.positive_examples),
                "num_negative": len(self.negative_examples),
            }

            os.makedirs(os.path.dirname(model_path), exist_ok=True)

            with open(model_path, "w") as f:
                json.dump(model_data, f)

            logger.info(f"Model saved to {model_path}")

        except Exception as e:
            logger.warning(f"Failed to save model: {e}")

    def _load_model(self):
        """Load model from disk"""
        model_path = self.config.get("model_path", "/tmp/active_learning_model.json")

        try:
            if not os.path.exists(model_path):
                logger.info("No saved model found, starting fresh")
                return

            with open(model_path, "r") as f:
                model_data = json.load(f)

            if model_data["weights"] is not None:
                self.weights = np.array(model_data["weights"], dtype=np.float32)
                self.bias = model_data["bias"]

                logger.info(
                    f"Model loaded from {model_path} "
                    f"({model_data['num_positive']} pos, {model_data['num_negative']} neg)"
                )

        except Exception as e:
            logger.warning(f"Failed to load model: {e}")
