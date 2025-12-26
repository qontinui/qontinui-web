/**
 * Composite Image Service
 *
 * Handles compositing multiple screenshots from different monitors
 * into a single image. Positions screenshots according to their
 * monitor coordinates.
 *
 * All inputs and outputs use base64 data URLs.
 */

import { loadImage, isValidDataUrl } from "./blob-service";
import type { MonitorInfo } from "@/components/common/ScreenshotPicker";

/**
 * Screenshot with its data URL and monitor position
 */
export interface CompositeScreenshotInput {
  id: string;
  name: string;
  dataUrl: string;
  monitor: MonitorInfo;
}

/**
 * Result of creating a composite image
 */
export interface CompositeImageResult {
  /** The composited image as a data URL */
  dataUrl: string;
  /** Total width of the composite */
  width: number;
  /** Total height of the composite */
  height: number;
  /** The bounds of the composite (accounting for monitor positions) */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

/**
 * Calculate the bounding box for all monitors
 */
export function calculateCompositeBounds(
  screenshots: CompositeScreenshotInput[]
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
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

/**
 * Find which monitor contains the given point
 */
export function findMonitorAtPoint(
  screenshots: CompositeScreenshotInput[],
  x: number,
  y: number,
  bounds: { minX: number; minY: number }
): CompositeScreenshotInput | null {
  // Convert from normalized coordinates to absolute
  const absX = x + bounds.minX;
  const absY = y + bounds.minY;

  for (const screenshot of screenshots) {
    const { monitor } = screenshot;
    if (
      absX >= monitor.x &&
      absX < monitor.x + monitor.width &&
      absY >= monitor.y &&
      absY < monitor.y + monitor.height
    ) {
      return screenshot;
    }
  }

  return null;
}

/**
 * Create a composite image from multiple screenshots
 *
 * @param screenshots Array of screenshots with their monitor positions
 * @returns CompositeImageResult with the composited data URL and dimensions
 */
export async function createCompositeImage(
  screenshots: CompositeScreenshotInput[]
): Promise<CompositeImageResult> {
  if (screenshots.length === 0) {
    throw new Error("No screenshots provided");
  }

  // Validate all screenshots have valid data URLs
  for (const screenshot of screenshots) {
    if (!isValidDataUrl(screenshot.dataUrl)) {
      throw new Error(`Invalid data URL for screenshot: ${screenshot.id}`);
    }
  }

  // Calculate the composite bounds
  const bounds = calculateCompositeBounds(screenshots);
  const { minX, minY, width, height } = bounds;

  // Load all images
  const loadedImages = await Promise.all(
    screenshots.map(async (screenshot) => ({
      screenshot,
      image: await loadImage(screenshot.dataUrl),
    }))
  );

  // Create the composite canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  // Fill with transparent background
  ctx.clearRect(0, 0, width, height);

  // Draw each screenshot at its normalized position
  for (const { screenshot, image } of loadedImages) {
    const normalizedX = screenshot.monitor.x - minX;
    const normalizedY = screenshot.monitor.y - minY;

    ctx.drawImage(image, normalizedX, normalizedY, image.width, image.height);
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    bounds: {
      minX,
      minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    },
  };
}

/**
 * Extract a region from a composite image
 *
 * @param compositeDataUrl The composite image data URL
 * @param region The region to extract (in composite coordinates)
 * @returns Data URL of the extracted region
 */
export async function extractRegionFromComposite(
  compositeDataUrl: string,
  region: { x: number; y: number; width: number; height: number }
): Promise<string> {
  if (!isValidDataUrl(compositeDataUrl)) {
    throw new Error("Invalid composite data URL");
  }

  const img = await loadImage(compositeDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(region.width);
  canvas.height = Math.floor(region.height);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  ctx.drawImage(
    img,
    Math.floor(region.x),
    Math.floor(region.y),
    Math.floor(region.width),
    Math.floor(region.height),
    0,
    0,
    Math.floor(region.width),
    Math.floor(region.height)
  );

  return canvas.toDataURL("image/png");
}

/**
 * Get the data URL for a specific point in the composite
 * (useful for color picking or point sampling)
 */
export async function getPixelFromComposite(
  compositeDataUrl: string,
  x: number,
  y: number
): Promise<{ r: number; g: number; b: number; a: number }> {
  if (!isValidDataUrl(compositeDataUrl)) {
    throw new Error("Invalid composite data URL");
  }

  const img = await loadImage(compositeDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
  const [r, g, b, a] = imageData.data;

  return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 0 };
}

/**
 * Check if all screenshots in the array have valid data URLs
 */
export function validateScreenshots(screenshots: CompositeScreenshotInput[]): {
  valid: boolean;
  invalidIds: string[];
} {
  const invalidIds: string[] = [];

  for (const screenshot of screenshots) {
    if (!isValidDataUrl(screenshot.dataUrl)) {
      invalidIds.push(screenshot.id);
    }
  }

  return {
    valid: invalidIds.length === 0,
    invalidIds,
  };
}
