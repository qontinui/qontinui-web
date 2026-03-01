import { useMemo, useState, useCallback, useEffect } from "react";
import type { State, ImageAsset } from "@/contexts/automation-context/types";
import type { Monitor } from "@/lib/schemas/geometry";
import type { ImageRecognitionEvent } from "@/hooks/useExecutionEvents";
import type {
  CanvasMode,
  StateColor,
  ActiveStateInfo,
  VisibleFoundImage,
  ConfigImage,
  StateBound,
} from "../ActiveStatesCanvas-types";
import {
  STATE_COLORS,
  buildImageToStateMap,
} from "../ActiveStatesCanvas-utils";

interface UseActiveStatesDataOptions {
  states: State[];
  images: ImageAsset[];
  monitors: Monitor[];
  mode: CanvasMode;
  activeStateIds?: Set<string> | string[];
  foundImages?: Map<string, ImageRecognitionEvent>;
  highlightStateId?: string;
}

interface ActiveStatesData {
  activeStateIdsSet: Set<string>;
  imageToStateMap: Map<
    string,
    { stateId: string; stateName: string; imageLabel: string }
  >;
  stateColorMap: Map<string, StateColor>;
  defaultColor: StateColor;
  activeStatesInfo: ActiveStateInfo[];
  visibleFoundImages: VisibleFoundImage[];
  configImages: ConfigImage[];
  stateBounds: StateBound[];
  monitorMap: Map<number, Monitor>;
  loadedImages: Map<string, HTMLImageElement>;
}

export function useActiveStatesData(
  options: UseActiveStatesDataOptions
): ActiveStatesData {
  const {
    states,
    images,
    monitors,
    mode,
    activeStateIds,
    foundImages,
    highlightStateId,
  } = options;

  // Image cache
  const [loadedImages, setLoadedImages] = useState<
    Map<string, HTMLImageElement>
  >(new Map());

  // Normalize activeStateIds to a Set
  const activeStateIdsSet = useMemo(() => {
    if (!activeStateIds) {
      // In config mode, treat all provided states as "active"
      if (mode === "config") {
        return new Set(states.map((s) => s.id));
      }
      return new Set<string>();
    }
    return activeStateIds instanceof Set
      ? activeStateIds
      : new Set(activeStateIds);
  }, [activeStateIds, mode, states]);

  // Build image -> state mapping
  const imageToStateMap = useMemo(() => buildImageToStateMap(states), [states]);

  // Default color for fallback (STATE_COLORS always has at least one element)
  const defaultColor: StateColor = STATE_COLORS[0]!;

  // Assign colors to active states
  const stateColorMap = useMemo(() => {
    const map = new Map<string, StateColor>();
    let colorIndex = 0;

    activeStateIdsSet.forEach((stateId) => {
      const color = STATE_COLORS[colorIndex % STATE_COLORS.length];
      if (color) {
        map.set(stateId, color);
      }
      colorIndex++;
    });

    return map;
  }, [activeStateIdsSet]);

  // Get active states with their info
  const activeStatesInfo = useMemo(() => {
    return Array.from(activeStateIdsSet).map((stateId) => {
      const state = states.find((s) => s.id === stateId);
      const color = stateColorMap.get(stateId) ?? defaultColor;
      return {
        id: stateId,
        name: state?.name || stateId,
        color,
      };
    });
  }, [activeStateIdsSet, states, stateColorMap, defaultColor]);

  // Build a map of monitor index to monitor info for coordinate translation
  const monitorMap = useMemo(() => {
    const map = new Map<number, Monitor>();
    monitors.forEach((m) => map.set(m.index, m));
    return map;
  }, [monitors]);

  // Filter found images to only those belonging to active states (perception mode)
  const visibleFoundImages = useMemo(() => {
    if (mode !== "perception" || !foundImages) return [];

    const result: VisibleFoundImage[] = [];

    foundImages.forEach((recognition, imageId) => {
      if (!recognition.found || recognition.x === undefined) return;

      const stateInfo = imageToStateMap.get(imageId);
      if (!stateInfo) return;

      // Only show if the parent state is active
      if (!activeStateIdsSet.has(stateInfo.stateId)) return;

      const color = stateColorMap.get(stateInfo.stateId) ?? defaultColor;

      result.push({
        imageId,
        recognition,
        stateId: stateInfo.stateId,
        stateName: stateInfo.stateName,
        imageLabel: stateInfo.imageLabel,
        color,
      });
    });

    return result;
  }, [
    mode,
    foundImages,
    imageToStateMap,
    activeStateIdsSet,
    stateColorMap,
    defaultColor,
  ]);

  // Collect config-based image positions (config mode)
  // SearchRegion coordinates are stored RELATIVE to the monitor they were captured on
  // We need to translate them to absolute screen coordinates using the monitor position
  const configImages = useMemo(() => {
    if (mode !== "config") return [];

    const result: ConfigImage[] = [];

    states.forEach((state) => {
      // Only include if this state is in the active set
      if (!activeStateIdsSet.has(state.id)) return;

      const color = stateColorMap.get(state.id) ?? defaultColor;
      const isHighlighted = state.id === highlightStateId;

      state.stateImages?.forEach((stateImage) => {
        // Get the monitor this image belongs to
        const monitorIndex = stateImage.monitors?.[0] ?? 0;
        const monitor = monitorMap.get(monitorIndex);

        stateImage.patterns?.forEach((pattern) => {
          if (!pattern.imageId) return;

          // Get position from offsetX/offsetY or searchRegion
          // These are stored RELATIVE to the monitor
          let relX: number | undefined;
          let relY: number | undefined;
          let width: number | undefined;
          let height: number | undefined;

          // First try offsetX/offsetY (found/saved position)
          if (pattern.offsetX !== undefined && pattern.offsetY !== undefined) {
            relX = pattern.offsetX;
            relY = pattern.offsetY;
          }
          // Fallback to first searchRegion position
          else if (pattern.searchRegions && pattern.searchRegions.length > 0) {
            const region = pattern.searchRegions[0];
            if (region && region.x !== undefined && region.y !== undefined) {
              relX = region.x;
              relY = region.y;
              width = region.width;
              height = region.height;
            }
          }

          if (relX !== undefined && relY !== undefined) {
            // Translate to absolute screen coordinates
            // If monitor info available, add monitor position; otherwise use as-is
            const absX = monitor ? monitor.x + relX : relX;
            const absY = monitor ? monitor.y + relY : relY;

            result.push({
              imageId: pattern.imageId,
              stateId: state.id,
              stateName: state.name,
              imageLabel: stateImage.name || pattern.name || "Image",
              color,
              x: absX,
              y: absY,
              width,
              height,
              isHighlighted,
            });
          }
        });
      });
    });

    return result;
  }, [
    mode,
    states,
    activeStateIdsSet,
    stateColorMap,
    highlightStateId,
    defaultColor,
    monitorMap,
  ]);

  // Calculate state bounds from configImages (for config mode background rendering)
  // Groups images by state and calculates bounding box for each state
  const stateBounds = useMemo(() => {
    if (mode !== "config" || configImages.length === 0) return [];

    // Group images by stateId
    const stateImageGroups = new Map<string, typeof configImages>();
    configImages.forEach((img) => {
      const group = stateImageGroups.get(img.stateId) || [];
      group.push(img);
      stateImageGroups.set(img.stateId, group);
    });

    // Calculate bounds for each state
    const bounds: StateBound[] = [];

    stateImageGroups.forEach((groupImages, stateId) => {
      if (groupImages.length === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      groupImages.forEach((img) => {
        // Get image dimensions from loaded images or use defaults
        const loadedImg = loadedImages.get(img.imageId);
        const w = img.width ?? loadedImg?.naturalWidth ?? 100;
        const h = img.height ?? loadedImg?.naturalHeight ?? 100;

        minX = Math.min(minX, img.x);
        minY = Math.min(minY, img.y);
        maxX = Math.max(maxX, img.x + w);
        maxY = Math.max(maxY, img.y + h);
      });

      // Add padding around the bounds
      const padding = 15;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;

      // firstImage is guaranteed to exist because we check groupImages.length === 0 above
      const firstImage = groupImages[0]!;
      bounds.push({
        stateId,
        stateName: firstImage.stateName,
        color: firstImage.color,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        isHighlighted: firstImage.isHighlighted,
      });
    });

    return bounds;
  }, [mode, configImages, loadedImages]);

  // Helper to get image URL
  const getImageUrl = useCallback(
    (imageId: string | undefined): string | null => {
      if (!imageId) return null;
      const imageAsset = images.find((img) => img.id === imageId);
      return imageAsset?.url || null;
    },
    [images]
  );

  // Load images for visible images (both modes)
  useEffect(() => {
    // Collect all image IDs to load based on mode
    const imageIdsToLoad =
      mode === "perception"
        ? visibleFoundImages.map(({ imageId }) => imageId)
        : configImages.map(({ imageId }) => imageId);

    imageIdsToLoad.forEach((imageId) => {
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
    });
  }, [mode, visibleFoundImages, configImages, getImageUrl, loadedImages]);

  return {
    activeStateIdsSet,
    imageToStateMap,
    stateColorMap,
    defaultColor,
    activeStatesInfo,
    visibleFoundImages,
    configImages,
    stateBounds,
    monitorMap,
    loadedImages,
  };
}
