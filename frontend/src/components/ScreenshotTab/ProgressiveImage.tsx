import { useState, useEffect, useCallback } from "react";

interface ProgressiveImageProps {
  imageUrl: string;
  zoom: number;
  variants?: {
    thumb?: string;
    medium?: string;
    large?: string;
    original: string;
  };
  onImageLoad?: (src: string) => void;
}

/**
 * Progressive image loader for ScreenshotCanvas
 * Loads different image sizes based on zoom level:
 * - zoom < 2x: medium size
 * - zoom 2x-4x: large size
 * - zoom > 4x: original size
 *
 * Shows placeholder while loading and progressively upgrades quality
 */
export function useProgressiveImage({
  imageUrl,
  zoom,
  variants,
  onImageLoad,
}: ProgressiveImageProps): {
  currentSrc: string;
  isLoading: boolean;
  loadedSizes: Set<string>;
} {
  const [currentSrc, setCurrentSrc] = useState<string>(imageUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedSizes, setLoadedSizes] = useState<Set<string>>(
    new Set([imageUrl])
  );

  // Determine required image size based on zoom
  const getRequiredSize = useCallback(
    (zoomLevel: number): "medium" | "large" | "original" => {
      if (zoomLevel > 4) return "original";
      if (zoomLevel > 2) return "large";
      return "medium";
    },
    []
  );

  // Load image progressively
  useEffect(() => {
    if (!variants) return;

    const requiredSize = getRequiredSize(zoom);
    const targetUrl = variants[requiredSize] || variants.original;

    // If we already have this size or better, no need to load
    if (loadedSizes.has(targetUrl)) {
      setCurrentSrc(targetUrl);
      return;
    }

    // Load the required size
    setIsLoading(true);
    const img = new Image();

    img.onload = () => {
      setCurrentSrc(targetUrl);
      setLoadedSizes((prev) => new Set([...Array.from(prev), targetUrl]));
      setIsLoading(false);
      onImageLoad?.(targetUrl);
    };

    img.onerror = () => {
      console.error(`Failed to load image at ${targetUrl}`);
      setIsLoading(false);
      // Fallback to original
      if (targetUrl !== variants.original) {
        setCurrentSrc(variants.original);
      }
    };

    img.src = targetUrl;
  }, [zoom, variants, getRequiredSize, loadedSizes, onImageLoad]);

  return {
    currentSrc,
    isLoading,
    loadedSizes,
  };
}

/**
 * Get the appropriate image URL based on zoom level
 */
export function getImageUrlForZoom(
  baseUrl: string,
  zoom: number,
  variants?: {
    thumb?: string;
    medium?: string;
    large?: string;
    original: string;
  }
): string {
  if (!variants) return baseUrl;

  if (zoom > 4) {
    return variants.original;
  } else if (zoom > 2) {
    return variants.large || variants.original;
  } else {
    return variants.medium || variants.original;
  }
}
