"""
Hough Grid Detector - Line-based grid detection

Uses Hough transform to detect lines and find their intersections to identify
grid structures.
"""

import logging
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from PIL import Image

from ..base import (
    BaseRegionAnalyzer,
    BoundingBox,
    DetectedRegion,
    RegionAnalysisInput,
    RegionAnalysisResult,
    RegionAnalysisType,
    RegionType,
)

logger = logging.getLogger(__name__)


class HoughGridDetector(BaseRegionAnalyzer):
    """
    Detects inventory grids using Hough line detection

    Algorithm:
    1. Apply Canny edge detection
    2. Use Hough transform to detect lines
    3. Separate horizontal and vertical lines
    4. Find parallel lines with uniform spacing
    5. Compute line intersections to find grid cells
    6. Extract grid structure
    """

    @property
    def analysis_type(self) -> RegionAnalysisType:
        return RegionAnalysisType.EDGE_DETECTION

    @property
    def name(self) -> str:
        return "hough_grid_detector"

    @property
    def supported_region_types(self) -> list[RegionType]:
        return [RegionType.INVENTORY_GRID]

    def get_default_parameters(self) -> dict[str, Any]:
        return {
            "canny_low": 50,
            "canny_high": 150,
            "hough_threshold": 50,
            "hough_min_line_length": 30,
            "hough_max_line_gap": 10,
            "angle_tolerance": 5,  # degrees
            "spacing_tolerance": 0.15,
            "min_cell_size": 24,
            "max_cell_size": 150,
            "min_grid_rows": 2,
            "min_grid_cols": 2,
        }

    async def analyze(self, input_data: RegionAnalysisInput) -> RegionAnalysisResult:
        """Detect inventory grids using Hough line detection"""
        all_regions = []

        # Process each screenshot
        for idx, screenshot_bytes in enumerate(input_data.screenshot_data):
            # Convert bytes to numpy array
            image = Image.open(BytesIO(screenshot_bytes))
            image_np = np.array(image)

            # Detect regions in this screenshot
            regions = self._analyze_image(image_np, idx, input_data.parameters)
            all_regions.extend(regions)

        # Calculate overall confidence
        overall_confidence = (
            sum(r.confidence for r in all_regions) / len(all_regions)
            if all_regions
            else 0.0
        )

        return RegionAnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            regions=all_regions,
            confidence=overall_confidence,
            metadata={"total_grids_detected": len(all_regions)},
        )

    def _analyze_image(
        self, image: np.ndarray, screenshot_index: int, params: dict[str, Any]
    ) -> list[DetectedRegion]:
        """Detect inventory grids using Hough line detection"""
        params = {**self.get_default_parameters(), **params}

        # Convert to grayscale
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()

        # Edge detection
        edges = cv2.Canny(gray, params["canny_low"], params["canny_high"])

        # Detect lines using Hough transform
        lines = cv2.HoughLinesP(
            edges,
            rho=1,
            theta=np.pi / 180,
            threshold=params["hough_threshold"],
            minLineLength=params["hough_min_line_length"],
            maxLineGap=params["hough_max_line_gap"],
        )

        if lines is None or len(lines) < 4:
            return []

        # Separate horizontal and vertical lines
        h_lines, v_lines = self._separate_lines(lines, params)

        if (
            len(h_lines) < params["min_grid_rows"] + 1
            or len(v_lines) < params["min_grid_cols"] + 1
        ):
            return []

        # Find uniform spacing in lines
        grid_configs = self._find_grid_configurations(h_lines, v_lines, params)

        if not grid_configs:
            return []

        # Extract grid regions from configurations
        regions = []
        for config in grid_configs:
            region = self._extract_grid_from_lines(
                config, gray.shape, params, screenshot_index
            )
            if region:
                regions.append(region)

        return regions

    def _separate_lines(
        self, lines: np.ndarray, params: dict[str, Any]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """
        Separate lines into horizontal and vertical

        Returns:
            (horizontal_lines, vertical_lines) tuple
        """
        h_lines = []
        v_lines = []

        for line in lines:
            x1, y1, x2, y2 = line[0]

            # Calculate angle
            dx = x2 - x1
            dy = y2 - y1

            if dx == 0:
                angle = 90
            else:
                angle = np.abs(np.arctan(dy / dx) * 180 / np.pi)

            # Horizontal line (near 0 degrees)
            if angle < params["angle_tolerance"]:
                # Average y position
                y_avg = (y1 + y2) / 2
                x_min = min(x1, x2)
                x_max = max(x1, x2)
                h_lines.append(
                    {
                        "y": y_avg,
                        "x_min": x_min,
                        "x_max": x_max,
                        "length": abs(x_max - x_min),
                    }
                )

            # Vertical line (near 90 degrees)
            elif angle > 90 - params["angle_tolerance"]:
                # Average x position
                x_avg = (x1 + x2) / 2
                y_min = min(y1, y2)
                y_max = max(y1, y2)
                v_lines.append(
                    {
                        "x": x_avg,
                        "y_min": y_min,
                        "y_max": y_max,
                        "length": abs(y_max - y_min),
                    }
                )

        return h_lines, v_lines

    def _find_grid_configurations(
        self,
        h_lines: list[dict[str, Any]],
        v_lines: list[dict[str, Any]],
        params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Find grid configurations from lines with uniform spacing

        Returns:
            List of grid configuration dictionaries
        """
        configs = []

        # Sort lines by position
        h_lines_sorted = sorted(h_lines, key=lambda l: l["y"])
        v_lines_sorted = sorted(v_lines, key=lambda l: l["x"])

        # Find groups of evenly-spaced horizontal lines
        h_groups = self._find_evenly_spaced_lines(h_lines_sorted, "y", params)

        # Find groups of evenly-spaced vertical lines
        v_groups = self._find_evenly_spaced_lines(v_lines_sorted, "x", params)

        # Combine horizontal and vertical groups into grid configs
        for h_group in h_groups:
            for v_group in v_groups:
                # Check if groups overlap spatially
                h_x_min = min(line["x_min"] for line in h_group["lines"])
                h_x_max = max(line["x_max"] for line in h_group["lines"])
                v_y_min = min(line["y_min"] for line in v_group["lines"])
                v_y_max = max(line["y_max"] for line in v_group["lines"])

                h_y_min = min(line["y"] for line in h_group["lines"])
                h_y_max = max(line["y"] for line in h_group["lines"])
                v_x_min = min(line["x"] for line in v_group["lines"])
                v_x_max = max(line["x"] for line in v_group["lines"])

                # Check overlap
                if (
                    h_x_min <= v_x_max
                    and h_x_max >= v_x_min
                    and v_y_min <= h_y_max
                    and v_y_max >= h_y_min
                ):

                    configs.append(
                        {
                            "h_lines": h_group["lines"],
                            "v_lines": v_group["lines"],
                            "spacing_y": h_group["spacing"],
                            "spacing_x": v_group["spacing"],
                        }
                    )

        return configs

    def _find_evenly_spaced_lines(
        self, lines: list[dict[str, Any]], position_key: str, params: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """
        Find groups of evenly-spaced lines

        Returns:
            List of line groups with uniform spacing
        """
        if len(lines) < 2:
            return []

        groups = []

        # Try different starting points
        for i in range(len(lines) - 1):
            group = [lines[i]]
            spacings = []

            for j in range(i + 1, len(lines)):
                if len(group) == 1:
                    # First spacing
                    spacing = lines[j][position_key] - lines[i][position_key]
                    if params["min_cell_size"] <= spacing <= params["max_cell_size"]:
                        group.append(lines[j])
                        spacings.append(spacing)
                else:
                    # Check if spacing is consistent
                    expected_spacing = np.mean(spacings)
                    actual_spacing = lines[j][position_key] - group[-1][position_key]

                    if (
                        abs(actual_spacing - expected_spacing) / expected_spacing
                        < params["spacing_tolerance"]
                    ):
                        group.append(lines[j])
                        spacings.append(actual_spacing)

            if len(group) >= 3:  # At least 3 lines (2 cells)
                groups.append(
                    {"lines": group, "spacing": np.mean(spacings) if spacings else 0}
                )

        # Return best group (most lines)
        if groups:
            groups.sort(key=lambda g: len(g["lines"]), reverse=True)  # type: ignore
            return groups[:3]  # Return top 3 groups

        return []

    def _extract_grid_from_lines(
        self,
        config: dict[str, Any],
        img_shape: tuple[int, int],
        params: dict[str, Any],
        screenshot_index: int,
    ) -> DetectedRegion | None:
        """Extract grid region from line configuration"""
        h_lines = config["h_lines"]
        v_lines = config["v_lines"]
        spacing_x = config["spacing_x"]
        spacing_y = config["spacing_y"]

        rows = len(h_lines) - 1
        cols = len(v_lines) - 1

        if rows < params["min_grid_rows"] or cols < params["min_grid_cols"]:
            return None

        # Calculate grid bounds
        x_positions = [line["x"] for line in v_lines]
        y_positions = [line["y"] for line in h_lines]

        x_start = int(min(x_positions))
        y_start = int(min(y_positions))
        x_end = int(max(x_positions))
        y_end = int(max(y_positions))

        width = x_end - x_start
        height = y_end - y_start

        # Generate cell metadata
        cells = []
        for row in range(rows):
            for col in range(cols):
                cell_x = int(x_positions[col])
                cell_y = int(y_positions[row])
                cell_w = int(x_positions[col + 1] - x_positions[col])
                cell_h = int(y_positions[row + 1] - y_positions[row])

                cells.append(
                    {
                        "row": row,
                        "col": col,
                        "x": cell_x,
                        "y": cell_y,
                        "width": cell_w,
                        "height": cell_h,
                    }
                )

        # Calculate confidence based on line quality
        total_lines = len(h_lines) + len(v_lines)
        expected_lines = rows + cols + 2
        line_completeness = total_lines / expected_lines
        confidence = min(0.95, 0.6 + line_completeness * 0.35)

        return DetectedRegion(
            bounding_box=BoundingBox(x_start, y_start, width, height),
            confidence=confidence,
            region_type=RegionType.INVENTORY_GRID,
            label="Inventory Grid",
            screenshot_index=screenshot_index,
            metadata={
                "grid_rows": rows,
                "grid_cols": cols,
                "cell_width": int(spacing_x),
                "cell_height": int(spacing_y),
                "spacing_x": int(spacing_x),
                "spacing_y": int(spacing_y),
                "cells": cells,
                "detector": "hough_grid",
                "method": "line_detection",
            },
        )
