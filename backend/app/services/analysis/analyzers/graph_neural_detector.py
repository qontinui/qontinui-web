"""
Graph Neural Detector - Graph-Based Spatial Relationship Analysis

Models UI as a graph where:
- Nodes = UI regions/elements
- Edges = spatial relationships (above, below, left, right, contains)

Uses graph structure to reason about element types based on:
- Position in UI hierarchy
- Relationships with other elements
- Typical UI patterns (e.g., buttons at bottom of forms)

This is a conceptual implementation showing graph-based reasoning.
For production, could use actual Graph Neural Networks (GNNs).
"""

import logging
from dataclasses import dataclass
from enum import Enum
from io import BytesIO
from typing import Any, Dict, List, Optional, Set, Tuple

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


class RelationType(str, Enum):
    """Types of spatial relationships between UI elements"""

    ABOVE = "above"
    BELOW = "below"
    LEFT = "left"
    RIGHT = "right"
    CONTAINS = "contains"
    CONTAINED_BY = "contained_by"
    ALIGNED_HORIZONTAL = "aligned_horizontal"
    ALIGNED_VERTICAL = "aligned_vertical"


@dataclass
class UINode:
    """Represents a UI element node in the graph"""

    id: int
    bbox: BoundingBox
    features: np.ndarray
    node_type: Optional[str] = None  # "button", "input", "text", etc.
    confidence: float = 0.5


@dataclass
class UIEdge:
    """Represents a relationship between UI elements"""

    source_id: int
    target_id: int
    relation_type: RelationType
    strength: float  # 0-1, strength of relationship


class GraphNeuralDetector(BaseAnalyzer):
    """
    Detects UI elements using graph-based spatial reasoning

    Algorithm:
    1. Extract candidate regions (potential UI elements)
    2. Build UI graph with spatial relationships
    3. Extract graph features (degree, centrality, patterns)
    4. Apply graph-based rules/patterns
    5. Propagate confidence through graph
    6. Classify nodes as buttons vs. other elements

    Uses spatial context and UI patterns:
    - Buttons often at bottom of forms (below inputs)
    - Buttons often horizontally aligned in groups
    - Buttons near form inputs suggest action buttons
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        return "graph_neural"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            # Node extraction
            "min_node_area": 200,
            "max_node_area": 50000,
            "edge_threshold": 50,
            # Relationship thresholds
            "alignment_threshold": 5,  # pixels for alignment
            "proximity_threshold": 50,  # pixels for proximity
            # Graph patterns
            "button_group_bonus": 0.2,  # Confidence boost for button groups
            "form_action_bonus": 0.15,  # Bonus for buttons below inputs
            "centered_bonus": 0.1,  # Bonus for centered elements
            # Propagation
            "propagation_iterations": 3,
            "propagation_alpha": 0.3,
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform graph-based detection"""
        logger.info(
            f"Running graph neural detection on {len(input_data.screenshots)} screenshots"
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

        logger.info(
            f"Found {len(all_elements)} elements using graph analysis "
            f"with avg confidence {avg_confidence:.2f}"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=float(avg_confidence),
            metadata={
                "num_screenshots": len(images),
                "method": "graph_neural",
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
        """Analyze single screenshot using graph approach"""

        # Step 1: Extract candidate nodes
        nodes = self._extract_nodes(img, params)

        logger.info(f"Screenshot {screenshot_idx}: Extracted {len(nodes)} nodes")

        if not nodes:
            return []

        # Step 2: Build graph (compute relationships)
        edges = self._build_graph(nodes, img, params)

        logger.info(f"Screenshot {screenshot_idx}: Built graph with {len(edges)} edges")

        # Step 3: Apply graph-based reasoning
        nodes = self._apply_graph_reasoning(nodes, edges, img, params)

        # Step 4: Propagate confidence through graph
        nodes = self._propagate_confidence(nodes, edges, params)

        # Step 5: Filter and convert to DetectedElements
        elements = []
        for node in nodes:
            # Filter by confidence and type
            if node.node_type == "button" and node.confidence > 0.5:
                elements.append(
                    DetectedElement(
                        bounding_box=node.bbox,
                        confidence=node.confidence,
                        label="Button (Graph)",
                        element_type="button",
                        screenshot_index=screenshot_idx,
                        metadata={
                            "method": "graph_neural",
                            "node_id": node.id,
                        },
                    )
                )

        return elements

    def _extract_nodes(self, img: np.ndarray, params: Dict[str, Any]) -> List[UINode]:
        """
        Extract candidate UI element nodes from image
        """
        nodes = []
        node_id = 0

        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

        # Detect regions using edges
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
            if not (params["min_node_area"] <= area <= params["max_node_area"]):
                continue

            bbox = BoundingBox(x=x, y=y, width=w, height=h)

            # Extract visual features
            features = self._extract_node_features(img, bbox)

            nodes.append(
                UINode(
                    id=node_id,
                    bbox=bbox,
                    features=features,
                    node_type=None,  # Unknown initially
                    confidence=0.5,
                )
            )

            node_id += 1

        return nodes

    def _extract_node_features(self, img: np.ndarray, bbox: BoundingBox) -> np.ndarray:
        """
        Extract visual features for a node

        Returns feature vector
        """
        x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height

        region = img[y : y + h, x : x + w]

        if region.size == 0:
            return np.zeros(10)

        features = []

        # Size features
        features.append(np.log1p(w * h) / 10.0)
        features.append(w / h if h > 0 else 0)

        # Color features
        mean_color = np.mean(region, axis=(0, 1)) / 255.0
        features.extend(mean_color.tolist())

        # Texture
        gray = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)
        texture = np.std(gray) / 255.0
        features.append(texture)

        # Position (normalized)
        features.append(x / img.shape[1])
        features.append(y / img.shape[0])

        # Ensure fixed size
        while len(features) < 10:
            features.append(0.0)

        return np.array(features[:10], dtype=np.float32)

    def _build_graph(
        self, nodes: List[UINode], img: np.ndarray, params: Dict[str, Any]
    ) -> List[UIEdge]:
        """
        Build graph by computing spatial relationships between nodes
        """
        edges = []

        for i, node1 in enumerate(nodes):
            for j, node2 in enumerate(nodes):
                if i >= j:  # Only compute once per pair
                    continue

                # Compute spatial relationships
                relations = self._compute_spatial_relations(
                    node1.bbox, node2.bbox, params
                )

                for relation_type, strength in relations:
                    edges.append(
                        UIEdge(
                            source_id=node1.id,
                            target_id=node2.id,
                            relation_type=relation_type,
                            strength=strength,
                        )
                    )

        return edges

    def _compute_spatial_relations(
        self, bbox1: BoundingBox, bbox2: BoundingBox, params: Dict[str, Any]
    ) -> List[Tuple[RelationType, float]]:
        """
        Compute spatial relationships between two bounding boxes

        Returns list of (relation_type, strength) tuples
        """
        relations = []

        x1, y1, w1, h1 = bbox1.x, bbox1.y, bbox1.width, bbox1.height
        x2, y2, w2, h2 = bbox2.x, bbox2.y, bbox2.width, bbox2.height

        # Compute centers
        cx1, cy1 = x1 + w1 / 2, y1 + h1 / 2
        cx2, cy2 = x2 + w2 / 2, y2 + h2 / 2

        # Check containment
        if x1 <= x2 and y1 <= y2 and x1 + w1 >= x2 + w2 and y1 + h1 >= y2 + h2:
            relations.append((RelationType.CONTAINS, 1.0))

        elif x2 <= x1 and y2 <= y1 and x2 + w2 >= x1 + w1 and y2 + h2 >= y1 + h1:
            relations.append((RelationType.CONTAINED_BY, 1.0))

        # Check alignment
        if abs(cy1 - cy2) < params["alignment_threshold"]:
            relations.append((RelationType.ALIGNED_HORIZONTAL, 1.0))

        if abs(cx1 - cx2) < params["alignment_threshold"]:
            relations.append((RelationType.ALIGNED_VERTICAL, 1.0))

        # Check directional relationships (if close enough)
        distance = np.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2)

        if distance < params["proximity_threshold"]:
            # Above/Below
            if cy1 < cy2:
                strength = 1.0 - (distance / params["proximity_threshold"])
                relations.append((RelationType.ABOVE, strength))
            elif cy1 > cy2:
                strength = 1.0 - (distance / params["proximity_threshold"])
                relations.append((RelationType.BELOW, strength))

            # Left/Right
            if cx1 < cx2:
                strength = 1.0 - (distance / params["proximity_threshold"])
                relations.append((RelationType.LEFT, strength))
            elif cx1 > cx2:
                strength = 1.0 - (distance / params["proximity_threshold"])
                relations.append((RelationType.RIGHT, strength))

        return relations

    def _apply_graph_reasoning(
        self,
        nodes: List[UINode],
        edges: List[UIEdge],
        img: np.ndarray,
        params: Dict[str, Any],
    ) -> List[UINode]:
        """
        Apply graph-based reasoning to classify nodes and adjust confidence

        Uses UI patterns:
        - Buttons often horizontally aligned in groups
        - Buttons often below form inputs
        - Centered elements more likely to be important
        """
        # Build adjacency information
        node_edges = {node.id: [] for node in nodes}
        for edge in edges:
            node_edges[edge.source_id].append(edge)
            node_edges[edge.target_id].append(edge)

        # Initial classification (simple heuristics)
        for node in nodes:
            node.node_type = self._classify_node_type(node, img)

        # Apply graph patterns
        for node in nodes:
            # Pattern 1: Button groups (horizontally aligned)
            aligned_buttons = self._count_aligned_buttons(
                node, nodes, edges, RelationType.ALIGNED_HORIZONTAL
            )

            if aligned_buttons >= 2:
                node.confidence += params["button_group_bonus"]
                if node.node_type != "button":
                    node.node_type = "button"

            # Pattern 2: Form actions (buttons below other elements)
            elements_above = self._count_elements_in_direction(
                node, nodes, edges, RelationType.ABOVE
            )

            if elements_above >= 2:
                node.confidence += params["form_action_bonus"]
                if node.node_type != "button":
                    node.node_type = "button"

            # Pattern 3: Centered elements
            if self._is_centered(node.bbox, img):
                node.confidence += params["centered_bonus"]

        return nodes

    def _classify_node_type(self, node: UINode, img: np.ndarray) -> str:
        """
        Initial classification of node type based on visual features
        """
        # Simple heuristic based on size and aspect ratio
        area = node.bbox.width * node.bbox.height
        aspect_ratio = node.bbox.width / node.bbox.height if node.bbox.height > 0 else 0

        # Button-like properties
        if 500 <= area <= 20000 and 1.5 <= aspect_ratio <= 8.0:
            return "button"

        # Input-like properties
        if 1000 <= area <= 30000 and 2.0 <= aspect_ratio <= 15.0:
            return "input"

        # Text-like properties
        if area < 5000 and 3.0 <= aspect_ratio <= 20.0:
            return "text"

        return "unknown"

    def _count_aligned_buttons(
        self,
        node: UINode,
        nodes: List[UINode],
        edges: List[UIEdge],
        alignment_type: RelationType,
    ) -> int:
        """
        Count how many button-like nodes are aligned with this node
        """
        count = 0

        for edge in edges:
            if edge.relation_type != alignment_type:
                continue

            # Check if this node is involved
            if edge.source_id == node.id:
                other_id = edge.target_id
            elif edge.target_id == node.id:
                other_id = edge.source_id
            else:
                continue

            # Find other node
            other_node = next((n for n in nodes if n.id == other_id), None)

            if other_node and other_node.node_type in ["button", "unknown"]:
                count += 1

        return count

    def _count_elements_in_direction(
        self,
        node: UINode,
        nodes: List[UINode],
        edges: List[UIEdge],
        direction: RelationType,
    ) -> int:
        """
        Count elements in a specific direction from this node
        """
        count = 0

        for edge in edges:
            if edge.relation_type != direction:
                continue

            # Check if this node is the target (elements above/left)
            if edge.target_id == node.id:
                count += 1

        return count

    def _is_centered(self, bbox: BoundingBox, img: np.ndarray) -> bool:
        """
        Check if element is horizontally centered in image
        """
        center_x = bbox.x + bbox.width / 2
        img_center_x = img.shape[1] / 2

        # Within 20% of center
        threshold = img.shape[1] * 0.2

        return abs(center_x - img_center_x) < threshold

    def _propagate_confidence(
        self, nodes: List[UINode], edges: List[UIEdge], params: Dict[str, Any]
    ) -> List[UINode]:
        """
        Propagate confidence through graph

        Similar elements should have similar confidence
        """
        for iteration in range(params["propagation_iterations"]):
            new_confidences = {}

            for node in nodes:
                # Collect confidence from neighbors
                neighbor_confidences = []

                for edge in edges:
                    if edge.source_id == node.id:
                        neighbor_id = edge.target_id
                    elif edge.target_id == node.id:
                        neighbor_id = edge.source_id
                    else:
                        continue

                    neighbor = next((n for n in nodes if n.id == neighbor_id), None)

                    if neighbor and neighbor.node_type == node.node_type:
                        # Weight by edge strength
                        neighbor_confidences.append(neighbor.confidence * edge.strength)

                # Update confidence (weighted average)
                if neighbor_confidences:
                    avg_neighbor_conf = np.mean(neighbor_confidences)
                    new_conf = (
                        1 - params["propagation_alpha"]
                    ) * node.confidence + params[
                        "propagation_alpha"
                    ] * avg_neighbor_conf
                    new_confidences[node.id] = new_conf
                else:
                    new_confidences[node.id] = node.confidence

            # Apply updates
            for node in nodes:
                node.confidence = new_confidences[node.id]

        return nodes
