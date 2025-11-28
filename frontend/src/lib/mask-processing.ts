/**
 * Mask processing utilities for mask editor
 * Adapts image-processing functions to work with mask data
 */

import { removeBorder, removeBackground } from "./image-processing";

export interface MaskProcessingResult {
  maskData: ImageData;
  success: boolean;
  message?: string;
}

/**
 * Applies background removal to mask data
 * Samples edge colors and marks matching pixels as transparent (black) in the mask
 * Combines with existing mask - already masked pixels stay masked
 */
export async function applyBackgroundRemoval(
  imageUrl: string,
  currentMaskData: ImageData,
  tolerance: number = 10
): Promise<MaskProcessingResult> {
  try {
    // Use the full image as the region
    const img = await loadImage(imageUrl);
    const region = {
      x: 0,
      y: 0,
      width: img.width,
      height: img.height,
    };

    const result = await removeBackground(imageUrl, region, tolerance);

    if (!result.mask) {
      return {
        maskData: currentMaskData,
        success: false,
        message: "No mask generated",
      };
    }

    // Convert the mask image to ImageData
    const newMaskData = await imageDataFromUrl(result.mask);

    // Combine with existing mask: keep pixels masked if they're masked in either mask
    const combinedMaskData = new ImageData(
      currentMaskData.width,
      currentMaskData.height
    );
    for (let i = 0; i < combinedMaskData.data.length; i += 4) {
      const currentMaskValue = currentMaskData.data[i]; // R channel (0 = masked, 255 = visible)
      const newMaskValue = newMaskData.data[i]; // R channel (0 = masked, 255 = visible)

      // If either mask says to hide the pixel, hide it (use minimum value)
      const finalValue = Math.min(currentMaskValue, newMaskValue);

      combinedMaskData.data[i] = finalValue; // R
      combinedMaskData.data[i + 1] = finalValue; // G
      combinedMaskData.data[i + 2] = finalValue; // B
      combinedMaskData.data[i + 3] = 255; // A (fully opaque)
    }

    return {
      maskData: combinedMaskData,
      success: true,
      message: "Background removed successfully",
    };
  } catch (error) {
    console.error("Background removal failed:", error);
    return {
      maskData: currentMaskData,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Applies border removal to mask data
 * Samples edge colors and marks matching pixels as transparent (black) in the mask
 * Combines with existing mask - already masked pixels stay masked
 */
export async function applyBorderRemoval(
  imageUrl: string,
  currentMaskData: ImageData,
  tolerance: number = 10
): Promise<MaskProcessingResult> {
  try {
    // Use the full image as the region
    const img = await loadImage(imageUrl);
    const region = {
      x: 0,
      y: 0,
      width: img.width,
      height: img.height,
    };

    // Border removal doesn't create a mask, so we need to create one
    // by identifying which pixels match the edge color
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Get edge color
    const edgeColor = getEdgeColor(
      imageData,
      region.x,
      region.y,
      region.width,
      region.height
    );

    // Create new mask: white = keep (non-border), black = remove (border)
    const newMaskData = ctx.createImageData(canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];

        // Check if pixel matches edge color (border)
        const isBorder = colorMatches(
          r,
          g,
          b,
          edgeColor.r,
          edgeColor.g,
          edgeColor.b,
          tolerance
        );

        // Set mask: white for content (keep), black for border (remove)
        const value = isBorder ? 0 : 255;
        newMaskData.data[idx] = value;
        newMaskData.data[idx + 1] = value;
        newMaskData.data[idx + 2] = value;
        newMaskData.data[idx + 3] = 255;
      }
    }

    // Combine with existing mask: keep pixels masked if they're masked in either mask
    const combinedMaskData = new ImageData(
      currentMaskData.width,
      currentMaskData.height
    );
    for (let i = 0; i < combinedMaskData.data.length; i += 4) {
      const currentMaskValue = currentMaskData.data[i]; // R channel (0 = masked, 255 = visible)
      const newMaskValue = newMaskData.data[i]; // R channel (0 = masked, 255 = visible)

      // If either mask says to hide the pixel, hide it (use minimum value)
      const finalValue = Math.min(currentMaskValue, newMaskValue);

      combinedMaskData.data[i] = finalValue; // R
      combinedMaskData.data[i + 1] = finalValue; // G
      combinedMaskData.data[i + 2] = finalValue; // B
      combinedMaskData.data[i + 3] = 255; // A (fully opaque)
    }

    return {
      maskData: combinedMaskData,
      success: true,
      message: "Border removed successfully",
    };
  } catch (error) {
    console.error("Border removal failed:", error);
    return {
      maskData: currentMaskData,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Helper: Load image from URL
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    // Only set crossOrigin for external URLs, not for data URLs
    if (!url.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.src = url;
  });
}

/**
 * Helper: Convert image URL to ImageData
 */
function imageDataFromUrl(url: string): Promise<ImageData> {
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
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error("Failed to load mask image"));
    // Only set crossOrigin for external URLs, not for data URLs
    if (!url.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.src = url;
  });
}

/**
 * Helper: Check if a pixel matches a color within tolerance
 */
function colorMatches(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
  tolerance: number
): boolean {
  return (
    Math.abs(r1 - r2) <= tolerance &&
    Math.abs(g1 - g2) <= tolerance &&
    Math.abs(b1 - b2) <= tolerance
  );
}

/**
 * Helper: Get the dominant edge color from the image edges
 */
function getEdgeColor(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  const edgePixels: Array<{ r: number; g: number; b: number }> = [];

  // Sample top edge
  for (let px = x; px < x + width; px++) {
    const idx = (y * imageData.width + px) * 4;
    edgePixels.push({
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2],
    });
  }

  // Sample bottom edge
  for (let px = x; px < x + width; px++) {
    const idx = ((y + height - 1) * imageData.width + px) * 4;
    edgePixels.push({
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2],
    });
  }

  // Sample left edge
  for (let py = y; py < y + height; py++) {
    const idx = (py * imageData.width + x) * 4;
    edgePixels.push({
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2],
    });
  }

  // Sample right edge
  for (let py = y; py < y + height; py++) {
    const idx = (py * imageData.width + (x + width - 1)) * 4;
    edgePixels.push({
      r: imageData.data[idx],
      g: imageData.data[idx + 1],
      b: imageData.data[idx + 2],
    });
  }

  // Calculate average color
  const sum = edgePixels.reduce(
    (acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }),
    { r: 0, g: 0, b: 0 }
  );

  return {
    r: Math.round(sum.r / edgePixels.length),
    g: Math.round(sum.g / edgePixels.length),
    b: Math.round(sum.b / edgePixels.length),
  };
}
