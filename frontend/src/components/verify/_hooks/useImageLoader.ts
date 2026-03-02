import { useEffect, useState } from "react";
import type { State } from "@/contexts/automation-context/types";
import { useAutomation } from "@/contexts/automation-context";

/**
 * Loads pattern images for a given state's StateImages.
 * Returns a Map from imageId to loaded HTMLImageElement.
 */
export function useImageLoader(state: State) {
  const { getImageById } = useAutomation();
  const [loadedImages, setLoadedImages] = useState<
    Map<string, HTMLImageElement>
  >(new Map());

  useEffect(() => {
    const imageMap = new Map<string, HTMLImageElement>();
    const loadPromises: Promise<void>[] = [];

    state.stateImages?.forEach((stateImage) => {
      stateImage.patterns?.forEach((pattern) => {
        if (
          pattern.fixed &&
          pattern.imageId &&
          !imageMap.has(pattern.imageId)
        ) {
          const imageAsset = getImageById(pattern.imageId);
          if (imageAsset?.url) {
            const promise = new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                imageMap.set(pattern.imageId!, img);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = imageAsset.url;
            });
            loadPromises.push(promise);
          }
        }
      });
    });

    Promise.all(loadPromises).then(() => {
      setLoadedImages(imageMap);
    });
  }, [state, getImageById]);

  return loadedImages;
}
