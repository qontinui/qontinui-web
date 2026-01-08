/**
 * Bounding Box Utility Functions
 *
 * Utilities for calculating state bounding boxes from stateImages.
 * A state's boundary is the union of all its stateImages' bounding boxes.
 */

import type {
  BoundingBox,
  StateMachineState,
  StateMachineStateImage,
} from "@/types/extraction";

/**
 * Calculate the union of multiple bounding boxes.
 * Returns the smallest rectangle that contains all input boxes.
 */
export function unionBoundingBoxes(boxes: BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Get the bounding box for a StateImage.
 * Uses bbox directly if available, then searchRegions, then patterns.
 */
export function getStateImageBoundingBox(
  stateImage: StateMachineStateImage
): BoundingBox | null {
  // First check for direct bbox property (from interactive element extraction)
  if (
    stateImage.bbox &&
    stateImage.bbox.width > 0 &&
    stateImage.bbox.height > 0
  ) {
    return stateImage.bbox;
  }

  const boxes: BoundingBox[] = [];

  // Collect searchRegions from the StateImage level
  if (stateImage.searchRegions && stateImage.searchRegions.length > 0) {
    boxes.push(...stateImage.searchRegions);
  }

  // Also collect from patterns
  for (const pattern of stateImage.patterns) {
    if (pattern.searchRegions && pattern.searchRegions.length > 0) {
      boxes.push(...pattern.searchRegions);
    }
  }

  return unionBoundingBoxes(boxes);
}

/**
 * Calculate the state's bounding box as the union of all its stateImages' bounding boxes.
 * The state boundary is the outermost boundaries of the union of their images.
 */
export function getStateBoundingBox(
  state: StateMachineState
): BoundingBox | null {
  const boxes: BoundingBox[] = [];

  for (const stateImage of state.stateImages) {
    const imageBbox = getStateImageBoundingBox(stateImage);
    if (imageBbox) {
      boxes.push(imageBbox);
    }
  }

  return unionBoundingBoxes(boxes);
}

/**
 * Get all bounding boxes for a state's stateImages (individual boxes, not union).
 */
export function getStateImageBoundingBoxes(state: StateMachineState): Array<{
  stateImageId: string;
  stateImageName: string;
  bbox: BoundingBox;
}> {
  const result: Array<{
    stateImageId: string;
    stateImageName: string;
    bbox: BoundingBox;
  }> = [];

  for (const stateImage of state.stateImages) {
    const bbox = getStateImageBoundingBox(stateImage);
    if (bbox) {
      result.push({
        stateImageId: stateImage.id,
        stateImageName: stateImage.name,
        bbox,
      });
    }
  }

  return result;
}

/**
 * Generate a consistent color for a state based on its ID.
 */
export function getStateColor(stateId: string, alpha: number = 1): string {
  // Use a hash of the state ID to generate a consistent hue
  let hash = 0;
  for (let i = 0; i < stateId.length; i++) {
    hash = stateId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);

  // Use HSL for vibrant, distinguishable colors
  return `hsla(${hue}, 70%, 50%, ${alpha})`;
}

/**
 * Get a predefined set of colors for states (for better visual distinction).
 */
export const STATE_COLORS = [
  {
    name: "blue",
    fill: "rgba(59, 130, 246, 0.3)",
    stroke: "rgb(59, 130, 246)",
  },
  { name: "green", fill: "rgba(34, 197, 94, 0.3)", stroke: "rgb(34, 197, 94)" },
  {
    name: "purple",
    fill: "rgba(168, 85, 247, 0.3)",
    stroke: "rgb(168, 85, 247)",
  },
  {
    name: "orange",
    fill: "rgba(249, 115, 22, 0.3)",
    stroke: "rgb(249, 115, 22)",
  },
  {
    name: "pink",
    fill: "rgba(236, 72, 153, 0.3)",
    stroke: "rgb(236, 72, 153)",
  },
  { name: "cyan", fill: "rgba(6, 182, 212, 0.3)", stroke: "rgb(6, 182, 212)" },
  {
    name: "yellow",
    fill: "rgba(234, 179, 8, 0.3)",
    stroke: "rgb(234, 179, 8)",
  },
  { name: "red", fill: "rgba(239, 68, 68, 0.3)", stroke: "rgb(239, 68, 68)" },
];

/**
 * Get color for a state by index (cycles through predefined colors).
 */
export function getStateColorByIndex(index: number): {
  fill: string;
  stroke: string;
} {
  const colorIndex = index % STATE_COLORS.length;
  const color = STATE_COLORS[colorIndex];
  // STATE_COLORS is guaranteed to have at least one element, and colorIndex is always valid
  return color!;
}
