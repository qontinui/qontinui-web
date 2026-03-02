import type { CompositeScreenshotDisplay, CompositeBounds } from "./types";

// Re-export region interaction utilities from common
export {
  getHandlePositions,
  getHandleAtPosition,
  getCursorForHandle,
  applyDragToRegion,
} from "@/components/common/_hooks/regionInteractionUtils";

export function calculateCompositeBounds(
  screenshots: CompositeScreenshotDisplay[]
): CompositeBounds {
  if (screenshots.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of screenshots) {
    const { x, y, width, height } = s.monitor;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
