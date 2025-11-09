/**
 * Image processing utilities for border removal and background removal
 */

export interface ProcessedImageResult {
  croppedImage: string; // Base64 data URL
  mask?: string; // Base64 data URL (only for background removal)
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Detects if a pixel matches a color within tolerance
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
 * Gets the dominant edge color from the region edges
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

/**
 * Removes border pixels and crops to content
 */
export async function removeBorder(
  imageDataUrl: string,
  region: { x: number; y: number; width: number; height: number },
  tolerance: number = 10
): Promise<ProcessedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Get edge color from the region
      const edgeColor = getEdgeColor(
        imageData,
        Math.floor(region.x),
        Math.floor(region.y),
        Math.floor(region.width),
        Math.floor(region.height)
      );

      // Find bounds excluding border pixels
      let minX = Math.floor(region.x + region.width);
      let maxX = Math.floor(region.x);
      let minY = Math.floor(region.y + region.height);
      let maxY = Math.floor(region.y);

      for (let py = Math.floor(region.y); py < Math.floor(region.y + region.height); py++) {
        for (let px = Math.floor(region.x); px < Math.floor(region.x + region.width); px++) {
          const idx = (py * imageData.width + px) * 4;
          const r = imageData.data[idx];
          const g = imageData.data[idx + 1];
          const b = imageData.data[idx + 2];

          // If pixel doesn't match edge color, include it
          if (!colorMatches(r, g, b, edgeColor.r, edgeColor.g, edgeColor.b, tolerance)) {
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
        }
      }

      // Handle case where no non-border pixels found
      if (minX > maxX || minY > maxY) {
        minX = Math.floor(region.x);
        maxX = Math.floor(region.x + region.width - 1);
        minY = Math.floor(region.y);
        maxY = Math.floor(region.y + region.height - 1);
      }

      const croppedWidth = maxX - minX + 1;
      const croppedHeight = maxY - minY + 1;

      // Create cropped canvas
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = croppedWidth;
      croppedCanvas.height = croppedHeight;
      const croppedCtx = croppedCanvas.getContext('2d');
      if (!croppedCtx) {
        reject(new Error('Failed to get cropped canvas context'));
        return;
      }

      croppedCtx.drawImage(
        canvas,
        minX,
        minY,
        croppedWidth,
        croppedHeight,
        0,
        0,
        croppedWidth,
        croppedHeight
      );

      resolve({
        croppedImage: croppedCanvas.toDataURL('image/png'),
        bounds: {
          x: minX,
          y: minY,
          width: croppedWidth,
          height: croppedHeight,
        },
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

/**
 * Removes background pixels, creates mask, and crops to content
 */
export async function removeBackground(
  imageDataUrl: string,
  region: { x: number; y: number; width: number; height: number },
  tolerance: number = 10
): Promise<ProcessedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Get edge color (assumed to be background)
      const bgColor = getEdgeColor(
        imageData,
        Math.floor(region.x),
        Math.floor(region.y),
        Math.floor(region.width),
        Math.floor(region.height)
      );

      // Find bounds and create mask
      let minX = Math.floor(region.x + region.width);
      let maxX = Math.floor(region.x);
      let minY = Math.floor(region.y + region.height);
      let maxY = Math.floor(region.y);

      const maskData: boolean[][] = [];
      for (let py = Math.floor(region.y); py < Math.floor(region.y + region.height); py++) {
        const row: boolean[] = [];
        for (let px = Math.floor(region.x); px < Math.floor(region.x + region.width); px++) {
          const idx = (py * imageData.width + px) * 4;
          const r = imageData.data[idx];
          const g = imageData.data[idx + 1];
          const b = imageData.data[idx + 2];

          const isBackground = colorMatches(r, g, b, bgColor.r, bgColor.g, bgColor.b, tolerance);
          row.push(isBackground);

          if (!isBackground) {
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
        }
        maskData.push(row);
      }

      // Handle case where no foreground pixels found
      if (minX > maxX || minY > maxY) {
        minX = Math.floor(region.x);
        maxX = Math.floor(region.x + region.width - 1);
        minY = Math.floor(region.y);
        maxY = Math.floor(region.y + region.height - 1);
      }

      const croppedWidth = maxX - minX + 1;
      const croppedHeight = maxY - minY + 1;

      // Create cropped image canvas
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = croppedWidth;
      croppedCanvas.height = croppedHeight;
      const croppedCtx = croppedCanvas.getContext('2d');
      if (!croppedCtx) {
        reject(new Error('Failed to get cropped canvas context'));
        return;
      }

      croppedCtx.drawImage(
        canvas,
        minX,
        minY,
        croppedWidth,
        croppedHeight,
        0,
        0,
        croppedWidth,
        croppedHeight
      );

      // Create mask canvas (cropped to same bounds)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = croppedWidth;
      maskCanvas.height = croppedHeight;
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) {
        reject(new Error('Failed to get mask canvas context'));
        return;
      }

      const maskImageData = maskCtx.createImageData(croppedWidth, croppedHeight);
      for (let py = 0; py < croppedHeight; py++) {
        for (let px = 0; px < croppedWidth; px++) {
          const srcY = minY - Math.floor(region.y) + py;
          const srcX = minX - Math.floor(region.x) + px;
          const isBackground = maskData[srcY]?.[srcX] || false;
          const idx = (py * croppedWidth + px) * 4;

          // White for foreground (keep), black for background (mask out)
          const value = isBackground ? 0 : 255;
          maskImageData.data[idx] = value;
          maskImageData.data[idx + 1] = value;
          maskImageData.data[idx + 2] = value;
          maskImageData.data[idx + 3] = 255;
        }
      }
      maskCtx.putImageData(maskImageData, 0, 0);

      resolve({
        croppedImage: croppedCanvas.toDataURL('image/png'),
        mask: maskCanvas.toDataURL('image/png'),
        bounds: {
          x: minX,
          y: minY,
          width: croppedWidth,
          height: croppedHeight,
        },
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

/**
 * Extracts region without any processing (just crops)
 */
export async function extractRegion(
  imageDataUrl: string,
  region: { x: number; y: number; width: number; height: number }
): Promise<ProcessedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(region.width);
      canvas.height = Math.floor(region.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
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

      resolve({
        croppedImage: canvas.toDataURL('image/png'),
        bounds: {
          x: Math.floor(region.x),
          y: Math.floor(region.y),
          width: Math.floor(region.width),
          height: Math.floor(region.height),
        },
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}
