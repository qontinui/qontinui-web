/**
 * Image Extraction Service
 *
 * Orchestrates the image extraction workflow:
 * 1. Take a screenshot (single or composite)
 * 2. Select a region
 * 3. Apply processing (none, border removal, background removal)
 * 4. Return the extracted result
 *
 * All inputs and outputs use base64 data URLs.
 */

import {
  removeBorder,
  removeBackground,
  extractRegion,
  type ProcessedImageResult,
} from "@/lib/image-processing";
import { isValidDataUrl } from "./blob-service";
import type { Region } from "@/types/pattern-optimization";

/**
 * Processing modes for image extraction
 */
export type ProcessingMode = "none" | "border" | "background";

/**
 * Options for image extraction
 */
export interface ExtractionOptions {
  /** Processing mode: none (just crop), border (remove border), background (create mask) */
  processingMode: ProcessingMode;
  /** Tolerance for color matching (0-255) */
  tolerance: number;
}

/**
 * Extraction result with metadata
 */
export interface ExtractionResult {
  /** The extracted/cropped image as a data URL */
  croppedImage: string;
  /** Mask image (only for background removal mode) */
  mask?: string;
  /** Bounds of the extraction */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Processing mode that was used */
  processingMode: ProcessingMode;
}

/**
 * Extract an image region with optional processing
 *
 * @param imageDataUrl Source image as a data URL
 * @param region Region to extract
 * @param options Extraction options (processing mode, tolerance)
 * @returns ExtractionResult with the processed image
 */
export async function extractFromScreenshot(
  imageDataUrl: string,
  region: Region,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  // Validate input
  if (!isValidDataUrl(imageDataUrl)) {
    throw new Error("Invalid image data URL");
  }

  if (region.width <= 0 || region.height <= 0) {
    throw new Error("Invalid region dimensions");
  }

  const { processingMode, tolerance } = options;

  let result: ProcessedImageResult;

  switch (processingMode) {
    case "border":
      result = await removeBorder(imageDataUrl, region, tolerance);
      break;

    case "background":
      result = await removeBackground(imageDataUrl, region, tolerance);
      break;

    case "none":
    default:
      result = await extractRegion(imageDataUrl, region);
      break;
  }

  return {
    croppedImage: result.croppedImage,
    mask: result.mask,
    bounds: result.bounds,
    processingMode,
  };
}

/**
 * Apply a custom mask to an extracted image
 *
 * @param imageDataUrl The image to mask
 * @param maskDataUrl The mask (white = keep, black = transparent)
 * @returns Data URL of the masked image
 */
export async function applyMask(
  imageDataUrl: string,
  maskDataUrl: string
): Promise<string> {
  if (!isValidDataUrl(imageDataUrl) || !isValidDataUrl(maskDataUrl)) {
    throw new Error("Invalid data URL");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const maskImg = new Image();

    let loadedCount = 0;

    const onBothLoaded = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      // Draw the original image
      ctx.drawImage(img, 0, 0);

      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Create mask canvas and get its data
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = maskImg.width;
      maskCanvas.height = maskImg.height;
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) {
        reject(new Error("Failed to get mask canvas context"));
        return;
      }
      maskCtx.drawImage(maskImg, 0, 0);
      const maskData = maskCtx.getImageData(
        0,
        0,
        maskCanvas.width,
        maskCanvas.height
      );

      // Apply mask: where mask is black (0), set alpha to 0
      for (let i = 0; i < imageData.data.length; i += 4) {
        const maskIndex =
          Math.floor(i / 4 / canvas.width) < maskCanvas.height &&
          (i / 4) % canvas.width < maskCanvas.width
            ? i
            : -1;

        if (maskIndex >= 0 && maskIndex < maskData.data.length) {
          // Use the red channel of the mask as the alpha multiplier
          const maskValue = maskData.data[maskIndex] ?? 0;
          imageData.data[i + 3] = Math.round(
            ((imageData.data[i + 3] ?? 255) * maskValue) / 255
          );
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };

    img.onload = () => {
      loadedCount++;
      if (loadedCount === 2) onBothLoaded();
    };
    img.onerror = () => reject(new Error("Failed to load image"));

    maskImg.onload = () => {
      loadedCount++;
      if (loadedCount === 2) onBothLoaded();
    };
    maskImg.onerror = () => reject(new Error("Failed to load mask"));

    img.src = imageDataUrl;
    maskImg.src = maskDataUrl;
  });
}

/**
 * Invert a mask image
 */
export async function invertMask(maskDataUrl: string): Promise<string> {
  if (!isValidDataUrl(maskDataUrl)) {
    throw new Error("Invalid mask data URL");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Invert each pixel
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255 - (imageData.data[i] ?? 0);
        imageData.data[i + 1] = 255 - (imageData.data[i + 1] ?? 0);
        imageData.data[i + 2] = 255 - (imageData.data[i + 2] ?? 0);
        // Keep alpha unchanged
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load mask"));
    img.src = maskDataUrl;
  });
}

/**
 * Validate that an extraction result is valid
 */
export function isValidExtractionResult(
  result: ExtractionResult | null
): result is ExtractionResult {
  if (!result) return false;
  if (!isValidDataUrl(result.croppedImage)) return false;
  if (result.bounds.width <= 0 || result.bounds.height <= 0) return false;
  return true;
}

/**
 * Get default extraction options
 */
export function getDefaultExtractionOptions(): ExtractionOptions {
  return {
    processingMode: "none",
    tolerance: 10,
  };
}
