/**
 * Blob Service
 *
 * Handles conversion between File/Blob objects and base64 data URLs.
 * Uses base64 data URLs exclusively to avoid blob URL expiration issues.
 *
 * Key insight: Base64 data URLs are just strings - they don't expire,
 * don't need caching, and persist naturally to localStorage.
 */

/**
 * Convert a File to a base64 data URL
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader did not return a string"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a Blob to a base64 data URL
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader did not return a string"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a base64 data URL to a Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64Data] = dataUrl.split(",");
  if (!header || !base64Data) {
    throw new Error("Invalid data URL format");
  }

  const mimeMatch = header.match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

/**
 * Convert a base64 data URL to a File
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], filename, { type: blob.type });
}

/**
 * Check if a string is a valid data URL
 */
export function isValidDataUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return url.startsWith("data:") && url.includes(",");
}

/**
 * Check if a string is a blob URL (which we want to avoid)
 */
export function isBlobUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return url.startsWith("blob:");
}

/**
 * Get the MIME type from a data URL
 */
export function getMimeTypeFromDataUrl(dataUrl: string): string | null {
  if (!isValidDataUrl(dataUrl)) return null;
  const match = dataUrl.match(/^data:([^;,]+)/);
  return match?.[1] ?? null;
}

/**
 * Get the base64 portion from a data URL (without the header)
 */
export function getBase64FromDataUrl(dataUrl: string): string | null {
  if (!isValidDataUrl(dataUrl)) return null;
  const parts = dataUrl.split(",");
  return parts[1] ?? null;
}

/**
 * Get image dimensions from a data URL
 */
export async function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (!isValidDataUrl(dataUrl)) {
      reject(new Error("Invalid data URL"));
      return;
    }

    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

/**
 * Load an image element from a data URL
 */
export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!isValidDataUrl(dataUrl)) {
      reject(new Error("Invalid data URL"));
      return;
    }

    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

/**
 * Estimate the size of a base64 data URL in bytes
 */
export function estimateDataUrlSize(dataUrl: string): number {
  if (!isValidDataUrl(dataUrl)) return 0;

  const base64 = getBase64FromDataUrl(dataUrl);
  if (!base64) return 0;

  // Base64 encodes 3 bytes into 4 characters
  // So decoded size is approximately 3/4 of the base64 string length
  return Math.ceil((base64.length * 3) / 4);
}

/**
 * Create a thumbnail from an image data URL
 * Returns a smaller data URL suitable for previews
 */
export async function createThumbnail(
  dataUrl: string,
  maxWidth: number = 200,
  maxHeight: number = 200
): Promise<string> {
  const img = await loadImage(dataUrl);

  // Calculate scaled dimensions maintaining aspect ratio
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }

  if (height > maxHeight) {
    width = (width * maxHeight) / height;
    height = maxHeight;
  }

  // Draw to canvas at reduced size
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  ctx.drawImage(img, 0, 0, width, height);

  // Return as JPEG for smaller file size
  return canvas.toDataURL("image/jpeg", 0.8);
}

/**
 * Compress an image data URL by resizing and/or reducing quality
 */
export async function compressImage(
  dataUrl: string,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    format?: "image/jpeg" | "image/png" | "image/webp";
  } = {}
): Promise<string> {
  const {
    maxWidth = 4096,
    maxHeight = 4096,
    quality = 0.9,
    format = "image/jpeg",
  } = options;

  const img = await loadImage(dataUrl);

  // Calculate scaled dimensions maintaining aspect ratio
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }

  if (height > maxHeight) {
    width = (width * maxHeight) / height;
    height = maxHeight;
  }

  // Draw to canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL(format, quality);
}
