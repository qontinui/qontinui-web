import { useState, useEffect } from "react";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("useImageLoader");

interface ImageDimensions {
  width: number;
  height: number;
}

export function useImageLoader(screenshotUrl: string) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] =
    useState<ImageDimensions | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      if (!screenshotUrl) {
        log.debug("No screenshot URL provided, skipping load");
        return;
      }

      try {
        log.debug("Attempting to load image:", screenshotUrl);
        const data = await patternOptimizationStorage.getImage(screenshotUrl);

        if (data) {
          log.debug("Loaded from IndexedDB");
          setImageData(data);

          const img = new Image();
          img.onload = () => {
            log.debug(
              "IndexedDB image dimensions:",
              img.width,
              "x",
              img.height
            );
            setImageDimensions({ width: img.width, height: img.height });
          };
          img.src = data;
        } else {
          log.debug("Not found in IndexedDB, using direct URL");
          setImageData(screenshotUrl);

          const img = new Image();
          img.onload = () => {
            log.debug(
              "Direct URL image loaded, dimensions:",
              img.width,
              "x",
              img.height
            );
            setImageDimensions({ width: img.width, height: img.height });
          };
          img.onerror = (e) => {
            console.error(
              "[useImageLoader] Failed to load image from direct URL:",
              e
            );
          };
          img.src = screenshotUrl;
        }
      } catch (error) {
        console.error(
          "[useImageLoader] IndexedDB error, using direct URL:",
          error
        );
        setImageData(screenshotUrl);

        const img = new Image();
        img.onload = () => {
          log.debug(
            "Fallback image loaded, dimensions:",
            img.width,
            "x",
            img.height
          );
          setImageDimensions({ width: img.width, height: img.height });
        };
        img.onerror = (e) => {
          console.error("[useImageLoader] Failed to load fallback image:", e);
        };
        img.src = screenshotUrl;
      }
    };

    loadImage();
  }, [screenshotUrl]);

  return { imageData, imageDimensions };
}
