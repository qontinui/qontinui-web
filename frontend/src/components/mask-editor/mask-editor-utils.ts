import type { ImageDimensions, MaskBounds, Tool } from "./mask-editor-types";

/**
 * Find the bounding box of white (visible) pixels in the mask.
 */
export function findMaskBounds(
  maskData: ImageData,
  dimensions: ImageDimensions
): MaskBounds | null {
  const { width, height } = dimensions;
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  let foundWhite = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const maskValue = maskData.data[idx]; // R channel
      if (maskValue === undefined) continue;
      if (maskValue > 0) {
        // White pixel (visible)
        foundWhite = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!foundWhite) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Convert mouse event coordinates to canvas pixel coordinates,
 * accounting for object-contain scaling.
 */
export function getCanvasCoordinates(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  dimensions: ImageDimensions
): { x: number; y: number } | null {
  const { width, height } = dimensions;
  const rect = canvas.getBoundingClientRect();

  // Calculate the actual displayed size considering object-contain
  const containerAspect = rect.width / rect.height;
  const imageAspect = width / height;

  let displayWidth, displayHeight, offsetX, offsetY;

  if (imageAspect > containerAspect) {
    // Image is wider - fits to width
    displayWidth = rect.width;
    displayHeight = rect.width / imageAspect;
    offsetX = 0;
    offsetY = (rect.height - displayHeight) / 2;
  } else {
    // Image is taller - fits to height
    displayWidth = rect.height * imageAspect;
    displayHeight = rect.height;
    offsetX = (rect.width - displayWidth) / 2;
    offsetY = 0;
  }

  const scaleX = width / displayWidth;
  const scaleY = height / displayHeight;

  const x = Math.floor((e.clientX - rect.left - offsetX) * scaleX);
  const y = Math.floor((e.clientY - rect.top - offsetY) * scaleY);

  return { x, y };
}

/**
 * Calculate the display scale factor for a canvas with object-contain.
 */
export function getDisplayScale(
  canvasRect: DOMRect,
  dimensions: ImageDimensions
): number {
  const { width, height } = dimensions;
  const containerAspect = canvasRect.width / canvasRect.height;
  const imageAspect = width / height;

  let displayWidth: number;

  if (imageAspect > containerAspect) {
    // Image is wider - fits to width
    displayWidth = canvasRect.width;
  } else {
    // Image is taller - fits to height
    displayWidth = canvasRect.height * imageAspect;
  }

  return displayWidth / width;
}

/**
 * Draw a circular brush stroke on the mask data at the given position.
 */
export function drawOnMask(
  maskData: ImageData,
  x: number,
  y: number,
  brushSize: number,
  tool: Tool,
  dimensions: ImageDimensions
): void {
  const { width, height } = dimensions;
  const radius = Math.floor(brushSize / 2);
  const isErasing = tool === "eraser";

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const px = x + dx;
        const py = y + dy;

        if (px >= 0 && px < width && py >= 0 && py < height) {
          const index = (py * width + px) * 4;
          // brush = black (0, transparent/masked), eraser = white (255, visible)
          const value = isErasing ? 255 : 0;
          maskData.data[index] = value; // R
          maskData.data[index + 1] = value; // G
          maskData.data[index + 2] = value; // B
          maskData.data[index + 3] = 255; // A (fully opaque)
        }
      }
    }
  }
}

/**
 * Draw a checkerboard pattern on a canvas context (transparency indicator).
 */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);
  const tileSize = 3;
  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? "#666" : "#999";
      ctx.fillRect(x, y, tileSize, tileSize);
    }
  }
}

/**
 * Create a masked image by applying the mask to the original image.
 * Returns a data URL or null if inputs are invalid.
 */
export function createMaskedImage(
  image: HTMLImageElement,
  maskData: ImageData,
  dimensions: ImageDimensions
): string | null {
  const { width, height } = dimensions;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext("2d");
  if (!ctx) return null;

  // Draw the original image
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, width, height);

  // Apply the current mask to make masked areas transparent
  const imageData = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const brightness = maskData.data[i]; // Use red channel as brightness
    if (brightness === undefined) continue;
    if (brightness < 128) {
      // Masked area (black in mask) - make transparent
      imageData.data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return tempCanvas.toDataURL("image/png");
}
