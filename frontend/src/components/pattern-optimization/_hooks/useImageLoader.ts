import { useState, useEffect } from "react";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";

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
        console.log(
          "[AdvancedRegionSelector] No screenshot URL provided, skipping load"
        );
        return;
      }

      try {
        console.log(
          "[AdvancedRegionSelector] Attempting to load image:",
          screenshotUrl
        );
        const data = await patternOptimizationStorage.getImage(screenshotUrl);

        if (data) {
          console.log("[AdvancedRegionSelector] Loaded from IndexedDB");
          setImageData(data);

          const img = new Image();
          img.onload = () => {
            console.log(
              "[AdvancedRegionSelector] IndexedDB image dimensions:",
              img.width,
              "x",
              img.height
            );
            setImageDimensions({ width: img.width, height: img.height });
          };
          img.src = data;
        } else {
          console.log(
            "[AdvancedRegionSelector] Not found in IndexedDB, using direct URL:",
            screenshotUrl
          );
          setImageData(screenshotUrl);

          const img = new Image();
          img.onload = () => {
            console.log(
              "[AdvancedRegionSelector] Direct URL image loaded, dimensions:",
              img.width,
              "x",
              img.height
            );
            setImageDimensions({ width: img.width, height: img.height });
          };
          img.onerror = (e) => {
            console.error(
              "[AdvancedRegionSelector] Failed to load image from direct URL:",
              e
            );
          };
          img.src = screenshotUrl;
        }
      } catch (error) {
        console.error(
          "[AdvancedRegionSelector] IndexedDB error, using direct URL:",
          error
        );
        setImageData(screenshotUrl);

        const img = new Image();
        img.onload = () => {
          console.log(
            "[AdvancedRegionSelector] Fallback image loaded, dimensions:",
            img.width,
            "x",
            img.height
          );
          setImageDimensions({ width: img.width, height: img.height });
        };
        img.onerror = (e) => {
          console.error(
            "[AdvancedRegionSelector] Failed to load fallback image:",
            e
          );
        };
        img.src = screenshotUrl;
      }
    };

    loadImage();
  }, [screenshotUrl]);

  return { imageData, imageDimensions };
}
