/**
 * Shared utility functions for the Image Library components
 */

import type { ImageAsset } from "@/contexts/automation-context/types";

/**
 * Build a data URL from raw base64 data when the image has no URL.
 * Returns undefined if both url and data are missing.
 */
export function resolveImageDataUrl(image: {
  url?: string;
  data?: string;
  format?: string;
}): string | undefined {
  if (image.url) return image.url;
  if (image.data) {
    const format = image.format || "png";
    return `data:image/${format};base64,${image.data}`;
  }
  return undefined;
}

/**
 * Get the appropriate image URL based on context.
 * For grid/list view: use thumb for performance.
 * For detail view: use original.
 */
export function getImageUrl(
  image: ImageAsset,
  size: "thumb" | "medium" | "original" = "thumb"
): string {
  const imageWithVariants = image as ImageAsset & {
    variants?: Record<string, string>;
    data?: string;
    format?: string;
  };
  if (imageWithVariants.variants) {
    return (
      imageWithVariants.variants[size] ||
      imageWithVariants.variants.thumb ||
      image.url
    );
  }
  return resolveImageDataUrl(imageWithVariants) || image.url;
}

/** Format a file size in bytes to a human-readable string */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  );
}

/** Get a human-readable label for an image source */
export function getSourceLabel(source: string): string {
  switch (source) {
    case "uploaded":
      return "Uploaded";
    case "pattern_optimization":
      return "Pattern Opt";
    case "image_extraction":
      return "Extraction";
    case "state_discovery":
      return "Discovery";
    default:
      return "Unknown";
  }
}

/** Get a color for an image source badge */
export function getSourceColor(source: string): string {
  switch (source) {
    case "uploaded":
      return "var(--color-brand-success)";
    case "pattern_optimization":
      return "var(--color-brand-primary)";
    case "image_extraction":
      return "var(--color-brand-secondary)";
    case "state_discovery":
      return "#FFB800";
    default:
      return "var(--color-text-muted)";
  }
}
