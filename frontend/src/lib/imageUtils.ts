/**
 * Utility functions for image processing
 */

/**
 * Extract a region from an image and return as data URL
 */
export async function extractImageRegion(
  imageFile: File,
  x: number,
  y: number,
  x2: number,
  y2: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not get canvas context"));
        return;
      }

      // Calculate dimensions
      const width = x2 - x;
      const height = y2 - y;

      // Set canvas size to the region size
      canvas.width = width;
      canvas.height = height;

      // Draw the specific region
      ctx.drawImage(
        img,
        x,
        y,
        width,
        height, // Source rectangle
        0,
        0,
        width,
        height // Destination rectangle
      );

      // Convert to data URL
      const dataUrl = canvas.toDataURL("image/png");

      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Generate thumbnail for a StateImage from screenshots
 */
export async function generateStateImageThumbnail(
  stateImage: {
    x: number;
    y: number;
    x2: number;
    y2: number;
    screenshots?: string[];
  },
  screenshots: File[],
  screenshotIndex?: number
): Promise<string | null> {
  try {
    // Determine which screenshot to use
    let targetIndex = screenshotIndex ?? 0;

    // If stateImage has screenshot info, find the first available screenshot
    if (stateImage.screenshots && stateImage.screenshots.length > 0) {
      // Extract index from screenshot ID (e.g., "screenshot_001" -> 1)
      const firstScreenshotId = stateImage.screenshots[0];
      if (firstScreenshotId) {
        const match = firstScreenshotId.match(/screenshot_(\d+)/);
        if (match && match[1]) {
          targetIndex = parseInt(match[1], 10);
        }
      }
    }

    // Check if screenshot exists
    if (targetIndex >= screenshots.length) {
      return null;
    }

    // Extract the region from the screenshot
    const thumbnail = await extractImageRegion(
      screenshots[targetIndex]!,
      stateImage.x,
      stateImage.y,
      stateImage.x2,
      stateImage.y2
    );

    return thumbnail;
  } catch (error) {
    console.error("Error generating thumbnail:", error);
    return null;
  }
}
