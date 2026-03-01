/**
 * Custom hook for StateExplorerView state management.
 *
 * Consolidates all 14 useState hooks plus derived memos, effects,
 * and callbacks that power the state explorer.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";
import { runnerClient } from "@/lib/runner-client";
import type {
  ExtractionAnnotation,
  StateMachineState,
} from "@/types/extraction";
import type { ImageWithBbox } from "../state-explorer-types";
import {
  filterStates,
  buildImagesWithBboxes,
  collectAllScreenshotIds,
  getStateScreenshotIds,
} from "../state-explorer-utils";

interface UseStateExplorerStateParams {
  states: StateMachineState[];
  annotations: ExtractionAnnotation[];
  extractionId?: string;
}

export function useStateExplorerState({
  states,
  annotations,
  extractionId,
}: UseStateExplorerStateParams) {
  // --- 14 useState hooks ---
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<
    string | null
  >(null);
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Screenshot cache
  const [screenshotCache, setScreenshotCache] = useState<Map<string, string>>(
    new Map()
  );
  const [loadingScreenshots, setLoadingScreenshots] = useState<Set<string>>(
    new Set()
  );

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Container width for responsive canvas
  const [containerWidth, setContainerWidth] = useState(0);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Derived state (useMemo) ---

  const selectedState = useMemo(
    () => states.find((s) => s.id === selectedStateId) || null,
    [states, selectedStateId]
  );

  const filteredStates = useMemo(
    () => filterStates(states, searchQuery),
    [states, searchQuery]
  );

  const imagesWithBboxes = useMemo<ImageWithBbox[]>(
    () => buildImagesWithBboxes(selectedState),
    [selectedState]
  );

  const allScreenshotIds = useMemo(
    () => collectAllScreenshotIds(annotations),
    [annotations]
  );

  const stateScreenshotIds = useMemo(
    () => getStateScreenshotIds(selectedState, allScreenshotIds),
    [selectedState, allScreenshotIds]
  );

  // --- Effects ---

  // Auto-select first state
  useEffect(() => {
    if (states.length > 0 && !selectedStateId) {
      const firstState = states[0];
      if (firstState) {
        setSelectedStateId(firstState.id);
      }
    }
  }, [states, selectedStateId]);

  // Auto-select first screenshot when state changes
  useEffect(() => {
    if (stateScreenshotIds.length > 0) {
      setSelectedScreenshotId(stateScreenshotIds[0] || null);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setSelectedScreenshotId(null);
    }
  }, [stateScreenshotIds]);

  // --- Callbacks ---

  // Load screenshot
  const loadScreenshot = useCallback(
    async (screenshotId: string): Promise<string | null> => {
      if (screenshotCache.has(screenshotId)) {
        return screenshotCache.get(screenshotId) || null;
      }

      if (loadingScreenshots.has(screenshotId) || !extractionId) {
        return null;
      }

      setLoadingScreenshots((prev) => new Set(prev).add(screenshotId));

      try {
        const result = await runnerClient.getExtractionScreenshot(
          extractionId,
          screenshotId
        );
        if (result.success && result.blob) {
          const url = URL.createObjectURL(result.blob);
          setScreenshotCache((prev) => new Map(prev).set(screenshotId, url));
          return url;
        }
      } catch (error) {
        console.error("Failed to load screenshot:", error);
      } finally {
        setLoadingScreenshots((prev) => {
          const next = new Set(prev);
          next.delete(screenshotId);
          return next;
        });
      }

      return null;
    },
    [screenshotCache, loadingScreenshots, extractionId]
  );

  // Preload screenshots for selected state
  useEffect(() => {
    if (!extractionId) return;
    for (const ssId of stateScreenshotIds) {
      loadScreenshot(ssId);
    }
  }, [stateScreenshotIds, extractionId, loadScreenshot]);

  // Track container width via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      screenshotCache.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.2, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.2, 0.5));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (!canvasRef.current) return;

    try {
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) {
          toast.error("Failed to create image.");
          return;
        }

        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              [blob.type]: blob,
            }),
          ]);
          toast.success("Image copied to clipboard");
        } catch (err) {
          console.error("Clipboard write failed:", err);
          toast.error("Failed to copy to clipboard");
        }
      }, "image/png");
    } catch (err) {
      console.error("Canvas export failed:", err);
      toast.error("Failed to capture image");
    }
  }, []);

  // Select a screenshot (resets zoom/pan)
  const selectScreenshot = useCallback((ssId: string) => {
    setSelectedScreenshotId(ssId);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return {
    // Selection state
    selectedStateId,
    setSelectedStateId,
    selectedScreenshotId,
    hoveredImageId,
    setHoveredImageId,
    searchQuery,
    setSearchQuery,

    // Screenshot cache
    screenshotCache,
    loadingScreenshots,
    loadScreenshot,

    // Zoom/pan
    zoom,
    pan,
    isDragging,
    containerWidth,

    // Refs
    canvasRef,
    containerRef,

    // Derived state
    selectedState,
    filteredStates,
    imagesWithBboxes,
    stateScreenshotIds,

    // Handlers
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleCopyImage,
    selectScreenshot,
  };
}
