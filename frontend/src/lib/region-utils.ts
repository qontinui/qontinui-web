/**
 * Utility functions for working with regions and anchors
 */

import {
  ScreenshotLocation,
  ScreenshotRegion,
  AnchorType,
} from "../types/Screenshot";
import { generateId } from "./utils";

/**
 * Calculate the actual position of an anchor based on its type within a bounding box
 */
export function getAnchorPosition(
  anchor: ScreenshotLocation,
  boundingBox?: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  // If no anchor type or CUSTOM, use the location's coordinates directly
  if (!anchor.anchorType || anchor.anchorType === "CUSTOM") {
    return { x: anchor.x, y: anchor.y };
  }

  // If no bounding box provided, use the anchor's position as the bounding box
  const box = boundingBox || {
    x: anchor.x,
    y: anchor.y,
    width: 0,
    height: 0,
  };

  // Calculate position based on anchor type
  switch (anchor.anchorType) {
    case "TOP_LEFT":
      return { x: box.x, y: box.y };
    case "TOP_CENTER":
      return { x: box.x + box.width / 2, y: box.y };
    case "TOP_RIGHT":
      return { x: box.x + box.width, y: box.y };
    case "MIDDLE_LEFT":
      return { x: box.x, y: box.y + box.height / 2 };
    case "CENTER":
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    case "MIDDLE_RIGHT":
      return { x: box.x + box.width, y: box.y + box.height / 2 };
    case "BOTTOM_LEFT":
      return { x: box.x, y: box.y + box.height };
    case "BOTTOM_CENTER":
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case "BOTTOM_RIGHT":
      return { x: box.x + box.width, y: box.y + box.height };
    default:
      return { x: anchor.x, y: anchor.y };
  }
}

/**
 * Create a region from two anchor locations
 *
 * @param anchor1 First anchor point (e.g., TOP_LEFT)
 * @param anchor2 Second anchor point (e.g., BOTTOM_RIGHT)
 * @param screenshotId The screenshot this region belongs to
 * @param stateId The state this region belongs to
 * @returns A new ScreenshotRegion
 */
export function createRegionFromAnchors(
  anchor1: ScreenshotLocation,
  anchor2: ScreenshotLocation,
  screenshotId: string,
  stateId: string,
  name?: string
): ScreenshotRegion {
  // Get the actual positions of the anchors
  const pos1 = getAnchorPosition(anchor1);
  const pos2 = getAnchorPosition(anchor2);

  // Apply offsets if present
  const finalPos1 = {
    x: pos1.x + (anchor1.offsetX || 0),
    y: pos1.y + (anchor1.offsetY || 0),
  };

  const finalPos2 = {
    x: pos2.x + (anchor2.offsetX || 0),
    y: pos2.y + (anchor2.offsetY || 0),
  };

  // Calculate the bounding box
  const minX = Math.min(finalPos1.x, finalPos2.x);
  const minY = Math.min(finalPos1.y, finalPos2.y);
  const maxX = Math.max(finalPos1.x, finalPos2.x);
  const maxY = Math.max(finalPos1.y, finalPos2.y);

  return {
    id: generateId(),
    screenshotId,
    stateId,
    name: name || `Region_${anchor1.name}_to_${anchor2.name}`,
    type: "StateRegion",
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

/**
 * Validate if two locations can be used as anchors to define a region
 */
export function canCreateRegionFromAnchors(
  anchor1: ScreenshotLocation | null,
  anchor2: ScreenshotLocation | null
): boolean {
  if (!anchor1 || !anchor2) return false;
  if (!anchor1.anchor || !anchor2.anchor) return false;
  if (anchor1.id === anchor2.id) return false;
  if (anchor1.screenshotId !== anchor2.screenshotId) return false;

  // Check if the anchors would create a valid region (non-zero area)
  const region = createRegionFromAnchors(
    anchor1,
    anchor2,
    anchor1.screenshotId,
    anchor1.stateId
  );

  return region.bounds.width > 0 && region.bounds.height > 0;
}

/**
 * Get a descriptive name for an anchor type
 */
export function getAnchorTypeName(anchorType?: AnchorType): string {
  if (!anchorType) return "Custom";

  const names: Record<AnchorType, string> = {
    TOP_LEFT: "Top Left",
    TOP_CENTER: "Top Center",
    TOP_RIGHT: "Top Right",
    MIDDLE_LEFT: "Middle Left",
    CENTER: "Center",
    MIDDLE_RIGHT: "Middle Right",
    BOTTOM_LEFT: "Bottom Left",
    BOTTOM_CENTER: "Bottom Center",
    BOTTOM_RIGHT: "Bottom Right",
    CUSTOM: "Custom",
  };

  return names[anchorType] || "Custom";
}
