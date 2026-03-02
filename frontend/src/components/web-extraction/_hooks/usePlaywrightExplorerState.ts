import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { PlaywrightExtractionResults } from "@/hooks/use-playwright-extraction";
import type { PlaywrightClickable } from "@/lib/runner-client";
import {
  convertPlaywrightResultsToStateMachine,
  type PlaywrightToStateMachineResult,
} from "../utils/playwright-to-state-machine";

export function usePlaywrightExplorerState(
  results: PlaywrightExtractionResults
) {
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<
    string | null
  >(null);
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Convert Playwright results to state machine format
  const converted = useMemo<PlaywrightToStateMachineResult | null>(() => {
    return convertPlaywrightResultsToStateMachine(results);
  }, [results]);

  // Get page screenshots from results - clickables have page_screenshot_before
  const pageScreenshots = useMemo(() => {
    const screenshots: Record<string, string> = {};
    if (results.clickables) {
      for (const clickable of results.clickables) {
        if (clickable.page_screenshot_before) {
          // Use element_id as screenshot ID for uniqueness
          const screenshotId = `page_${clickable.element_id}`;
          if (!screenshots[screenshotId]) {
            screenshots[screenshotId] = clickable.page_screenshot_before;
          }
        }
      }
    }
    return screenshots;
  }, [results.clickables]);

  // Get all screenshot IDs
  const screenshotIds = useMemo(() => {
    return Object.keys(pageScreenshots);
  }, [pageScreenshots]);

  // Get clickables as a map for easy lookup
  const clickablesMap = useMemo(() => {
    const map = new Map<string, PlaywrightClickable>();
    if (results.clickables) {
      for (const clickable of results.clickables) {
        map.set(clickable.element_id, clickable);
      }
    }
    return map;
  }, [results.clickables]);

  // Filtered states
  const filteredStates = useMemo(() => {
    if (!converted) return [];
    if (!searchQuery) return converted.states;
    return converted.states.filter(
      (s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [converted, searchQuery]);

  // Selected state
  const selectedState = useMemo(() => {
    if (!converted) return null;
    if (selectedStateId) {
      return converted.states.find((s) => s.id === selectedStateId) || null;
    }
    return converted.states[0] || null;
  }, [converted, selectedStateId]);

  // Elements in selected state with bounding boxes
  const stateElements = useMemo(() => {
    if (!selectedState || !results.clickables) return [];

    const elementIds = new Set(
      selectedState.stateImages.map((img) => img.id.replace("stateimage-", ""))
    );

    return results.clickables.filter((c: PlaywrightClickable) =>
      elementIds.has(c.element_id)
    );
  }, [selectedState, results.clickables]);

  // Get screenshot IDs for selected state elements
  const stateScreenshotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const elem of stateElements) {
      if (elem.screenshot) {
        ids.add(elem.screenshot);
      }
    }
    // Fall back to first screenshot if no specific IDs
    if (ids.size === 0 && screenshotIds.length > 0 && screenshotIds[0]) {
      ids.add(screenshotIds[0]);
    }
    return Array.from(ids);
  }, [stateElements, screenshotIds]);

  // Elements visible on selected screenshot
  const elementsOnSelectedScreenshot = useMemo(() => {
    if (!selectedScreenshotId) return stateElements;
    return stateElements.filter(
      (elem: PlaywrightClickable) =>
        elem.screenshot === selectedScreenshotId || !elem.screenshot // Include elements without screenshot for backwards compatibility
    );
  }, [stateElements, selectedScreenshotId]);

  // Auto-select first state
  useEffect(() => {
    if (converted && converted.states.length > 0 && !selectedStateId) {
      const firstState = converted.states[0];
      if (firstState) {
        setSelectedStateId(firstState.id);
      }
    }
  }, [converted, selectedStateId]);

  // Auto-select first screenshot when state changes
  useEffect(() => {
    if (stateScreenshotIds.length > 0) {
      setSelectedScreenshotId(stateScreenshotIds[0] || null);
      // Reset zoom/pan when state changes
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setSelectedScreenshotId(null);
    }
  }, [stateScreenshotIds]);

  // Track container width for responsive canvas
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

  // Draw canvas with screenshot and bounding boxes
  useEffect(() => {
    if (!selectedScreenshotId || !canvasRef.current || containerWidth === 0)
      return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageBase64 = pageScreenshots[selectedScreenshotId];
    if (!imageBase64) return;

    const img = new Image();
    img.src = `data:image/png;base64,${imageBase64}`;

    img.onload = () => {
      // Calculate display size to fill container width
      const availableWidth = containerWidth - 32;
      const aspectRatio = img.naturalWidth / img.naturalHeight;

      const displayWidth = availableWidth;
      const displayHeight = displayWidth / aspectRatio;

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      const scaleX = displayWidth / img.naturalWidth;
      const scaleY = displayHeight / img.naturalHeight;

      // Clear and set up transform
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();

      // Apply zoom and pan
      ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // Draw image
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

      // Use theme colors
      const defaultStroke = "#4A90D9";
      const defaultFill = "rgba(74, 144, 217, 0.1)";
      const highlightStroke = "#4DB89D";
      const highlightFill = "rgba(77, 184, 157, 0.25)";

      // Draw bounding boxes for all elements on this screenshot
      for (const element of elementsOnSelectedScreenshot) {
        const bbox = element.bounding_box;
        const x = bbox.x * scaleX;
        const y = bbox.y * scaleY;
        const width = bbox.width * scaleX;
        const height = bbox.height * scaleY;
        const isHovered = element.element_id === hoveredElementId;

        ctx.fillStyle = isHovered ? highlightFill : defaultFill;
        ctx.fillRect(x, y, width, height);

        ctx.strokeStyle = isHovered ? highlightStroke : defaultStroke;
        ctx.lineWidth = (isHovered ? 3 : 2) / zoom;
        ctx.strokeRect(x, y, width, height);

        if (isHovered) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = highlightStroke;
          ctx.strokeRect(x, y, width, height);
          ctx.shadowBlur = 0;
        }
      }

      ctx.restore();
    };
  }, [
    selectedScreenshotId,
    pageScreenshots,
    elementsOnSelectedScreenshot,
    zoom,
    pan,
    hoveredElementId,
    containerWidth,
  ]);

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

  const handleSelectState = useCallback((stateId: string) => {
    setSelectedStateId(stateId);
    setHoveredElementId(null);
  }, []);

  const handleSelectScreenshot = useCallback((ssId: string) => {
    setSelectedScreenshotId(ssId);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return {
    // Converted data
    converted,
    pageScreenshots,
    clickablesMap,

    // Selection
    selectedState,
    selectedScreenshotId,
    hoveredElementId,
    setHoveredElementId,
    searchQuery,
    setSearchQuery,

    // Filtered/derived
    filteredStates,
    stateElements,
    stateScreenshotIds,

    // Zoom/pan
    zoom,
    isDragging,

    // Refs
    canvasRef,
    containerRef,

    // Handlers
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleSelectState,
    handleSelectScreenshot,
  };
}
