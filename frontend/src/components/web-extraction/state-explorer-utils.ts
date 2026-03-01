/**
 * Pure utility functions for StateExplorerView.
 *
 * No hooks or setState — just data transformations.
 */

import type {
  BoundingBox,
  ExtractionAnnotation,
  StateMachineState,
  StateMachineStateImage,
} from "@/types/extraction";
import type { ImageWithBbox } from "./state-explorer-types";
import { getStateImageBoundingBox } from "./utils/bbox-utils";

/**
 * Crop an image to a bounding box region using an offscreen canvas.
 */
export async function cropImage(
  imageUrl: string,
  bbox: BoundingBox
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = bbox.width;
      canvas.height = bbox.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }

      const x = Math.max(0, Math.min(bbox.x, img.naturalWidth - 1));
      const y = Math.max(0, Math.min(bbox.y, img.naturalHeight - 1));
      const width = Math.min(bbox.width, img.naturalWidth - x);
      const height = Math.min(bbox.height, img.naturalHeight - y);

      ctx.drawImage(img, x, y, width, height, 0, 0, bbox.width, bbox.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

/**
 * Filter states by search query (name or description).
 */
export function filterStates(
  states: StateMachineState[],
  searchQuery: string
): StateMachineState[] {
  if (!searchQuery) return states;
  const q = searchQuery.toLowerCase();
  return states.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q)
  );
}

/**
 * Build ImageWithBbox array from a state's stateImages.
 */
export function buildImagesWithBboxes(
  state: StateMachineState | null
): ImageWithBbox[] {
  if (!state) return [];
  return state.stateImages
    .map((stateImage) => {
      const bbox = getStateImageBoundingBox(stateImage);
      if (!bbox) return null;
      return { stateImage, bbox };
    })
    .filter((item): item is ImageWithBbox => item !== null);
}

/**
 * Collect all unique screenshot IDs from annotations.
 */
export function collectAllScreenshotIds(
  annotations: ExtractionAnnotation[]
): string[] {
  const ids = new Set<string>();
  for (const annotation of annotations) {
    if (annotation.screenshot_id) {
      ids.add(annotation.screenshot_id);
    }
  }
  return Array.from(ids).sort();
}

/**
 * Get screenshot IDs where a specific state appears.
 * Falls back to all screenshot IDs if none can be determined.
 */
export function getStateScreenshotIds(
  selectedState: StateMachineState | null,
  allScreenshotIds: string[]
): string[] {
  if (!selectedState) return allScreenshotIds;

  // Check if state has screensFound array (from new image-matching algorithm)
  const screensFound = (
    selectedState as StateMachineState & { screensFound?: string[] }
  ).screensFound;
  if (screensFound && screensFound.length > 0) {
    return screensFound;
  }

  // Fallback: get from stateImages
  const ids = new Set<string>();
  for (const img of selectedState.stateImages) {
    // Check for screensFound on image (new format)
    const imgScreensFound = (
      img as StateMachineStateImage & { screensFound?: string[] }
    ).screensFound;
    if (imgScreensFound) {
      imgScreensFound.forEach((id) => ids.add(id));
    } else if (img.screenshotId) {
      ids.add(img.screenshotId);
    }
  }

  // If still no IDs found, return all
  if (ids.size === 0) {
    return allScreenshotIds;
  }
  return Array.from(ids).sort();
}

/**
 * Filter images to only those appearing on a specific screenshot.
 */
export function filterImagesForScreenshot(
  imagesWithBboxes: ImageWithBbox[],
  selectedScreenshotId: string
): ImageWithBbox[] {
  return imagesWithBboxes.filter(({ stateImage }) => {
    // Check for screensFound array (new format from image-matching)
    const screensFound = (
      stateImage as StateMachineStateImage & { screensFound?: string[] }
    ).screensFound;
    if (screensFound && screensFound.length > 0) {
      return screensFound.includes(selectedScreenshotId);
    }
    // Fallback: check screenshotId (source screenshot)
    if (stateImage.screenshotId) {
      return stateImage.screenshotId === selectedScreenshotId;
    }
    // No info - assume it appears on all screenshots (legacy behavior)
    return true;
  });
}
