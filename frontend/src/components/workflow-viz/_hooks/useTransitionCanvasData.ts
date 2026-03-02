import { useEffect, useState, useCallback, useMemo } from "react";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { Monitor } from "@/lib/schemas/geometry";
import type { UseTransitionAnimationResult } from "../TransitionAnimationController";

export function useTransitionCanvasData(
  animation: UseTransitionAnimationResult,
  images: ImageAsset[],
  monitors: Monitor[]
) {
  // Monitor filter state
  const [showOnlyWithElements, setShowOnlyWithElements] = useState(true);

  // Calculate which monitors have elements
  const monitorsWithElements = useMemo(() => {
    const monitorIndices = new Set<number>();
    const data = animation.data;

    if (!data) return [];

    const allStates = [...data.originStates, ...data.targetStates];
    allStates.forEach((state) => {
      state.stateImages?.forEach((stateImage) => {
        const monitorIndex = stateImage.monitors?.[0] ?? 0;
        const hasPosition = stateImage.patterns?.some(
          (p) =>
            (p.offsetX !== undefined && p.offsetY !== undefined) ||
            p.searchRegions?.some(
              (sr) => sr.x !== undefined && sr.y !== undefined
            )
        );
        if (hasPosition) {
          monitorIndices.add(monitorIndex);
        }
      });
    });

    return Array.from(monitorIndices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation.data, monitors]);

  // Loaded images cache
  const [loadedImages, setLoadedImages] = useState<
    Map<string, HTMLImageElement>
  >(new Map());

  const getImageUrl = useCallback(
    (imageId: string): string | undefined => {
      const asset = images.find((img) => img.id === imageId);
      return asset?.url;
    },
    [images]
  );

  // Collect all image IDs needed for current states
  const neededImageIds = useMemo(() => {
    const ids = new Set<string>();
    const data = animation.data;

    if (!data) return ids;

    const allStates = [...data.originStates, ...data.targetStates];

    for (const state of allStates) {
      for (const stateImage of state.stateImages || []) {
        for (const pattern of stateImage.patterns || []) {
          if (pattern.imageId) {
            ids.add(pattern.imageId);
          }
        }
      }
    }

    return ids;
  }, [animation.data]);

  // Load images as needed
  useEffect(() => {
    for (const imageId of neededImageIds) {
      if (!loadedImages.has(imageId)) {
        const url = getImageUrl(imageId);
        if (url) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            setLoadedImages((prev) => {
              const next = new Map(prev);
              next.set(imageId, img);
              return next;
            });
          };
          img.src = url;
        }
      }
    }
  }, [neededImageIds, getImageUrl, loadedImages]);

  return {
    loadedImages,
    showOnlyWithElements,
    setShowOnlyWithElements,
    monitorsWithElements,
  };
}
