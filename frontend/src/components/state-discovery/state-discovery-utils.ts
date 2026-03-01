/**
 * Pure utility functions for StateDiscoveryTab
 * No hooks or setState calls -- only pure data transformations.
 */

import type { StateImage, DiscoveredState } from "@/types/stateDiscovery";

/** Supported image file extensions for upload validation */
const VALID_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".bmp"];

/**
 * Validate and filter files to only include supported image types.
 * Returns { validFiles, skippedCount }.
 */
export function filterValidImageFiles(files: File[]): {
  validFiles: File[];
  skippedCount: number;
} {
  const validFiles = files.filter((file) => {
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
    return VALID_IMAGE_EXTENSIONS.includes(ext);
  });
  return {
    validFiles,
    skippedCount: files.length - validFiles.length,
  };
}

/**
 * Filter state images based on dark/light pixel percentage thresholds.
 */
export function filterStateImagesByPixels(
  stateImages: StateImage[] | undefined,
  maxDarkPixelPercentage: number,
  maxLightPixelPercentage: number
): StateImage[] {
  if (!stateImages || stateImages.length === 0) return [];

  return stateImages.filter((si) => {
    if (
      si.darkPixelPercentage !== undefined &&
      si.lightPixelPercentage !== undefined
    ) {
      const passedDarkFilter = si.darkPixelPercentage <= maxDarkPixelPercentage;
      const passedLightFilter =
        si.lightPixelPercentage <= maxLightPixelPercentage;
      return passedDarkFilter && passedLightFilter;
    }
    // If no backend data and filters are active, exclude
    if (maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100) {
      return false;
    }
    // Default to including when filters are at 100%
    return true;
  });
}

/**
 * Filter states to only include those with at least one visible state image.
 * Returns states with their stateImageIds pruned to only include filtered image IDs.
 */
export function filterStatesByVisibleImages(
  states: DiscoveredState[] | undefined,
  filteredStateImages: StateImage[]
): DiscoveredState[] {
  if (!states || states.length === 0) return [];

  const filteredStateImageIds = new Set(filteredStateImages.map((si) => si.id));

  return states
    .map((state) => ({
      ...state,
      stateImageIds:
        state.stateImageIds?.filter((id) => filteredStateImageIds.has(id)) ||
        [],
    }))
    .filter((state) => state.stateImageIds.length > 0);
}

/**
 * Convert a similarity threshold (0-1) to a color tolerance value (0-255).
 * Higher similarity = lower tolerance (more strict).
 * Example: 0.95 similarity -> 12.75 tolerance, 0.8 similarity -> 51 tolerance
 */
export function similarityToColorTolerance(
  similarityThreshold: number
): number {
  return Math.round((1 - similarityThreshold) * 255);
}

/**
 * Check whether pixel filters are active (i.e., not at their 100% defaults).
 */
export function isPixelFilterActive(
  maxDarkPixelPercentage: number,
  maxLightPixelPercentage: number
): boolean {
  return maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100;
}
