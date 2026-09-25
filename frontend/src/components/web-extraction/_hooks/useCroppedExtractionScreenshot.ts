"use client";

/**
 * An extraction screenshot plus a region cropped out of it.
 *
 * The full screenshot comes from {@link useExtractionScreenshot} (fetched from
 * the active runner through the transport resolver, its object URL revoked by
 * that hook); the crop is a PNG data URL drawn from it. Shared by every
 * extraction view that shows "the state/element image" with a toggle to the
 * full screenshot.
 */

import { useEffect, useState } from "react";
import { useExtractionScreenshot } from "./useExtractionScreenshot";

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop `bbox` out of a loaded image as a PNG data URL; null when nothing is visible. */
export function cropFromImage(
  img: HTMLImageElement,
  bbox: CropBox
): string | null {
  if (
    bbox.x >= img.width ||
    bbox.y >= img.height ||
    bbox.width <= 0 ||
    bbox.height <= 0
  ) {
    return null;
  }

  const x = Math.max(0, bbox.x);
  const y = Math.max(0, bbox.y);
  const width = Math.min(bbox.width, img.width - x);
  const height = Math.min(bbox.height, img.height - y);
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

export interface CropMessages {
  /**
   * Shown when the region lies wholly outside the screenshot. `{y}` and
   * `{height}` are replaced by the region's Y and the screenshot's height.
   */
  outOfBounds: string;
  /** Shown when the region has no visible area. */
  noVisibleArea: string;
}

export interface CroppedExtractionScreenshot {
  /** The full screenshot's object URL (owned by the hook — do not revoke). */
  fullImageUrl: string | null;
  /** The cropped region as a data URL. */
  croppedImageUrl: string | null;
  /** The decoded full screenshot, for cropping further regions from it. */
  image: HTMLImageElement | null;
  /**
   * The load or crop failure. A path the relay does not carry reads as the
   * runner's "needs the runner on this machine" message (`errorCode`
   * RUNNER_NEEDS_LOCAL), never as a generic failure.
   */
  error: string | null;
  errorCode: string | null;
  loading: boolean;
}

/**
 * Load a screenshot and crop `bbox` out of it. A null `screenshotId` (or
 * `extractionId`) loads nothing.
 */
export function useCroppedExtractionScreenshot(
  extractionId: string | null | undefined,
  screenshotId: string | null | undefined,
  bbox: CropBox,
  messages: CropMessages
): CroppedExtractionScreenshot {
  const shot = useExtractionScreenshot(extractionId, screenshotId);
  const fullImageUrl = shot.url;
  const { x, y, width, height } = bbox;
  const { outOfBounds, noVisibleArea } = messages;
  const [crop, setCrop] = useState<{
    url: string | null;
    image: HTMLImageElement | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    setCrop(null);
    if (!fullImageUrl) return;
    let mounted = true;
    const img = new Image();

    img.onload = () => {
      if (!mounted) return;
      if (
        y >= img.height ||
        x >= img.width ||
        y + height <= 0 ||
        x + width <= 0
      ) {
        setCrop({
          url: null,
          image: img,
          error: outOfBounds
            .replace("{y}", String(y))
            .replace("{height}", String(img.height)),
        });
        return;
      }
      const url = cropFromImage(img, { x, y, width, height });
      setCrop({ url, image: img, error: url ? null : noVisibleArea });
    };
    img.onerror = () => {
      if (!mounted) return;
      setCrop({
        url: null,
        image: null,
        error: "Failed to process screenshot",
      });
    };
    img.src = fullImageUrl;

    return () => {
      mounted = false;
    };
  }, [fullImageUrl, x, y, width, height, outOfBounds, noVisibleArea]);

  return {
    fullImageUrl,
    croppedImageUrl: crop?.url ?? null,
    image: crop?.image ?? null,
    error: shot.error ?? crop?.error ?? null,
    errorCode: shot.errorCode,
    loading: shot.isLoading || (fullImageUrl !== null && crop === null),
  };
}
