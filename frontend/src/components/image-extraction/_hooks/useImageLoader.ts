import { useState, useEffect, useMemo, useRef } from "react";
import type {
  CompositeScreenshotDisplay,
  LoadedImage,
  CompositeBounds,
} from "../types";
import { calculateCompositeBounds } from "../utils";

export function useImageLoader(screenshots: CompositeScreenshotDisplay[]) {
  const [loadedImages, setLoadedImages] = useState<LoadedImage[]>([]);
  const [compositeBounds, setCompositeBounds] =
    useState<CompositeBounds | null>(null);

  const lastLoadedScreenshotKeyRef = useRef<string | null>(null);

  const screenshotKey = useMemo(
    () =>
      screenshots
        .map((s) => s.id)
        .sort()
        .join(","),
    [screenshots]
  );

  useEffect(() => {
    console.log(
      "[CompositeCanvas] Screenshots effect triggered:",
      screenshots.length,
      "screenshotKey:",
      screenshotKey,
      "lastKey:",
      lastLoadedScreenshotKeyRef.current
    );

    if (screenshots.length === 0) {
      setLoadedImages([]);
      setCompositeBounds(null);
      lastLoadedScreenshotKeyRef.current = null;
      return;
    }

    // Skip if we've already loaded these screenshots
    if (lastLoadedScreenshotKeyRef.current === screenshotKey) {
      console.log("[CompositeCanvas] Screenshots already loaded, skipping");
      return;
    }

    // Check for valid URLs
    const invalidScreenshots = screenshots.filter(
      (s) => !s.url || s.url === ""
    );
    if (invalidScreenshots.length > 0) {
      console.warn(
        "[CompositeCanvas] Screenshots with missing URLs:",
        invalidScreenshots.map((s) => s.id)
      );
      return;
    }

    const bounds = calculateCompositeBounds(screenshots);
    setCompositeBounds(bounds);

    let isCancelled = false;

    const loadPromises = screenshots.map((screenshot) => {
      return new Promise<LoadedImage>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          if (!isCancelled) {
            console.log("[CompositeCanvas] Loaded image:", screenshot.id);
            resolve({ screenshot, image: img });
          }
        };
        img.onerror = (err) => {
          if (!isCancelled) {
            console.error(
              "[CompositeCanvas] Failed to load image:",
              screenshot.id,
              "URL:",
              screenshot.url?.substring(0, 80),
              err
            );
            reject(err);
          }
        };
        img.src = screenshot.url;
      });
    });

    Promise.all(loadPromises)
      .then((loaded) => {
        if (!isCancelled) {
          console.log("[CompositeCanvas] All images loaded:", loaded.length);
          lastLoadedScreenshotKeyRef.current = screenshotKey;
          setLoadedImages(loaded);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error("[CompositeCanvas] Failed to load images:", error);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [screenshots, screenshotKey]);

  return { loadedImages, compositeBounds, screenshotKey };
}
