/**
 * Playwright State Explorer View Component
 *
 * Displays Playwright extraction results in the same visual format
 * as StateExplorerView, with full-page screenshots and bounding box overlays.
 *
 * Layout (matching StateExplorerView):
 * 1. States - Pages discovered during extraction
 * 2. State Images - Element thumbnails for selected state
 * 3. Image Locations - Full-page screenshot with bounding box overlays
 * 4. Screenshots - Available full-page screenshots
 */

"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MapPin,
  Layers,
  Monitor,
  FileImage,
} from "lucide-react";
import {
  ExplorerPanel,
  ExplorerPanelHeader,
  ExplorerPanelContent,
  ExplorerPanelList,
  ExplorerPanelItem,
  ExplorerPanelThumbnail,
  ExplorerPanelEmptyState,
} from "@/components/qontinui/ExplorerPanel";
import type { PlaywrightExtractionResults } from "@/hooks/use-playwright-extraction";
import type { PlaywrightClickable } from "@/lib/runner-client";
import {
  convertPlaywrightResultsToStateMachine,
  type PlaywrightToStateMachineResult,
} from "./utils/playwright-to-state-machine";

interface PlaywrightStateExplorerViewProps {
  results: PlaywrightExtractionResults;
}

export function PlaywrightStateExplorerView({
  results,
}: PlaywrightStateExplorerViewProps) {
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

  // Handle state selection
  const handleSelectState = (stateId: string) => {
    setSelectedStateId(stateId);
    setHoveredElementId(null);
  };

  if (!converted || converted.states.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <ExplorerPanelEmptyState
          message="No extraction results"
          icon={ImageIcon}
        />
      </div>
    );
  }

  const metrics = results.metrics;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 overflow-hidden">
      {/* Metrics Summary Bar */}
      {metrics && (
        <div className="shrink-0 flex items-center gap-6 px-4 py-3 bg-surface-raised/40 border border-brand-success/20 rounded-lg backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted font-mono uppercase">
              Elements:
            </span>
            <span className="text-sm font-bold text-white">
              {metrics.total_found}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted font-mono uppercase">
              Verified:
            </span>
            <span className="text-sm font-bold text-brand-success">
              {metrics.verified || 0}
            </span>
          </div>
          {metrics.verified !== undefined && metrics.total_found > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted font-mono uppercase">
                Verification:
              </span>
              <span className="text-sm font-bold text-brand-primary">
                {((metrics.verified / metrics.total_found) * 100).toFixed(0)}%
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted font-mono uppercase">
              Pages:
            </span>
            <span className="text-sm font-bold text-brand-secondary">
              {metrics.pages_visited}
            </span>
          </div>
          {metrics.skipped_dangerous > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted font-mono uppercase">
                Skipped:
              </span>
              <span className="text-sm font-bold text-warning">
                {metrics.skipped_dangerous}
              </span>
            </div>
          )}
          {metrics.errors > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted font-mono uppercase">
                Errors:
              </span>
              <span className="text-sm font-bold text-error">
                {metrics.errors}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Main Content - 4-panel layout matching StateExplorerView */}
      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Panel 1: States List */}
        <ExplorerPanel accent="primary" width="w-[16%]" className="shrink-0">
          <ExplorerPanelHeader title="States" icon={Layers} accent="primary">
            <Badge
              variant="outline"
              className="ml-auto text-[10px] border-brand-primary/30 text-brand-primary"
            >
              {filteredStates.length}
            </Badge>
          </ExplorerPanelHeader>

          <div className="px-3 pt-3 pb-2 border-b border-brand-primary/10">
            <Input
              placeholder="Filter states..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-surface-canvas border-border-subtle text-white font-mono text-xs h-8 focus:border-brand-primary focus:ring-brand-primary/30 placeholder:text-text-muted/50"
            />
          </div>

          <ExplorerPanelContent scrollable padding="sm">
            <ExplorerPanelList>
              {filteredStates.length === 0 ? (
                <ExplorerPanelEmptyState
                  message="No states found"
                  icon={Layers}
                />
              ) : (
                filteredStates.map((state) => (
                  <ExplorerPanelItem
                    key={state.id}
                    selected={state.id === selectedState?.id}
                    accent="primary"
                    onClick={() => handleSelectState(state.id)}
                  >
                    <div className="font-semibold text-white text-sm mb-2 truncate">
                      {state.name}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-muted font-mono truncate max-w-[100px]">
                        {state.description || "No description"}
                      </span>
                      <Badge className="bg-brand-secondary/20 text-brand-secondary border-brand-secondary/30 text-[9px] px-1.5">
                        {state.stateImages.length}
                      </Badge>
                    </div>
                  </ExplorerPanelItem>
                ))
              )}
            </ExplorerPanelList>
          </ExplorerPanelContent>
        </ExplorerPanel>

        {/* Panel 2: State Images (Elements) */}
        <ExplorerPanel accent="secondary" width="w-[14%]" className="shrink-0">
          <ExplorerPanelHeader
            title="State Images"
            icon={ImageIcon}
            accent="secondary"
            actions={
              selectedState && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-brand-secondary/30 text-brand-secondary"
                >
                  {stateElements.length}
                </Badge>
              )
            }
          />

          <ExplorerPanelContent scrollable padding="sm">
            {!selectedState ? (
              <ExplorerPanelEmptyState
                message="Select a state"
                icon={ImageIcon}
              />
            ) : stateElements.length === 0 ? (
              <ExplorerPanelEmptyState
                message="No images found"
                icon={ImageIcon}
              />
            ) : (
              <ExplorerPanelList gap="md">
                {stateElements.map((element: PlaywrightClickable) => (
                  <ElementThumbnail
                    key={element.element_id}
                    element={element}
                    onMouseEnter={() => setHoveredElementId(element.element_id)}
                    onMouseLeave={() => setHoveredElementId(null)}
                    isSelected={hoveredElementId === element.element_id}
                  />
                ))}
              </ExplorerPanelList>
            )}
          </ExplorerPanelContent>
        </ExplorerPanel>

        {/* Panel 3: Image Locations (Main Canvas) */}
        <ExplorerPanel accent="success" className="flex-1">
          <ExplorerPanelHeader
            title="Image Locations"
            icon={MapPin}
            accent="success"
            actions={
              <div className="flex items-center gap-2 bg-surface-canvas/80 rounded-lg px-2 py-1 border border-brand-success/30">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleZoomOut}
                  className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-[10px] font-mono text-brand-success w-10 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleZoomIn}
                  className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
                <div className="w-px h-4 bg-brand-success/30 mx-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetZoom}
                  className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>
            }
          />

          <div
            ref={containerRef}
            className="flex-1 min-h-0 h-0 overflow-auto p-4 bg-surface-canvas/30 flex flex-col items-center"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              cursor:
                zoom > 1 && isDragging
                  ? "grabbing"
                  : zoom > 1
                    ? "grab"
                    : "default",
            }}
          >
            {selectedScreenshotId && pageScreenshots[selectedScreenshotId] ? (
              <canvas
                ref={canvasRef}
                className="rounded-lg shadow-lg bg-surface-canvas border border-border-subtle"
              />
            ) : (
              <ExplorerPanelEmptyState
                message="No screenshot available"
                icon={FileImage}
              />
            )}

            {/* Label for hovered element */}
            {hoveredElementId && (
              <div className="absolute bottom-4 left-4 bg-black/80 border border-brand-success/50 rounded px-3 py-1.5 backdrop-blur-sm">
                <div className="text-[10px] text-brand-success font-mono leading-tight whitespace-nowrap">
                  {clickablesMap.get(hoveredElementId)?.text ||
                    clickablesMap.get(hoveredElementId)?.aria_label ||
                    clickablesMap.get(hoveredElementId)?.tag_name}
                </div>
              </div>
            )}
          </div>
        </ExplorerPanel>

        {/* Panel 4: Screenshots */}
        <ExplorerPanel accent="primary" width="w-[12%]" className="shrink-0">
          <ExplorerPanelHeader
            title="Screenshots"
            icon={Monitor}
            accent="primary"
            actions={
              <Badge
                variant="outline"
                className="text-[10px] border-brand-primary/30 text-brand-primary"
              >
                {stateScreenshotIds.length}
              </Badge>
            }
          />

          <ExplorerPanelContent scrollable padding="sm">
            {stateScreenshotIds.length === 0 ? (
              <ExplorerPanelEmptyState
                message="No screenshots"
                icon={Monitor}
              />
            ) : (
              <ExplorerPanelList gap="md">
                {stateScreenshotIds.map((ssId) => (
                  <ScreenshotThumbnail
                    key={ssId}
                    screenshotId={ssId}
                    isSelected={ssId === selectedScreenshotId}
                    screenshotBase64={pageScreenshots[ssId]}
                    onClick={() => {
                      setSelectedScreenshotId(ssId);
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                  />
                ))}
              </ExplorerPanelList>
            )}
          </ExplorerPanelContent>
        </ExplorerPanel>
      </div>
    </div>
  );
}

// Sub-component: Element Thumbnail
interface ElementThumbnailProps {
  element: PlaywrightClickable;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  isSelected?: boolean;
}

function ElementThumbnail({
  element,
  onMouseEnter,
  onMouseLeave,
  isSelected,
}: ElementThumbnailProps) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`
        p-2 rounded-lg border cursor-pointer transition-all w-full
        ${
          isSelected
            ? "border-brand-success bg-brand-success/20 shadow-[0_0_12px_rgba(77,184,157,0.2)]"
            : "border-border-subtle bg-surface-canvas/50 hover:border-brand-secondary/50"
        }
      `}
    >
      <div className="aspect-video bg-surface-canvas rounded border border-border-subtle mb-2 overflow-hidden flex items-center justify-center">
        {element.screenshot ? (
          <img
            src={`data:image/png;base64,${element.screenshot}`}
            alt={element.text || element.selector}
            className="w-full h-full object-contain"
          />
        ) : (
          <ImageIcon className="h-4 w-4 text-brand-secondary/30" />
        )}
      </div>
      <div className="text-[10px] font-semibold text-white truncate">
        {element.text || element.aria_label || `${element.tag_name} element`}
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-text-muted font-mono uppercase tracking-wider truncate">
          {element.tag_name}
        </span>
        {element.verified ? (
          <CheckCircle2 className="h-3 w-3 text-brand-success shrink-0" />
        ) : (
          <XCircle className="h-3 w-3 text-error shrink-0" />
        )}
      </div>
    </div>
  );
}

// Sub-component: Screenshot Thumbnail
interface ScreenshotThumbnailProps {
  screenshotId: string;
  isSelected: boolean;
  screenshotBase64?: string;
  onClick: () => void;
}

function ScreenshotThumbnail({
  screenshotId,
  isSelected,
  screenshotBase64,
  onClick,
}: ScreenshotThumbnailProps) {
  return (
    <ExplorerPanelThumbnail
      selected={isSelected}
      accent="primary"
      onClick={onClick}
    >
      <div className="w-full h-full bg-surface-canvas">
        {screenshotBase64 ? (
          <img
            src={`data:image/png;base64,${screenshotBase64}`}
            alt={screenshotId}
            className={`w-full h-full object-cover object-top transition-opacity duration-300 ${
              isSelected ? "opacity-100" : "opacity-60 hover:opacity-100"
            }`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileImage className="h-4 w-4 text-brand-primary/20" />
          </div>
        )}
      </div>
      <div
        className={`p-1.5 ${isSelected ? "bg-brand-primary/20" : "bg-surface-canvas/70"}`}
      >
        <div
          className={`text-[9px] font-mono truncate ${
            isSelected ? "text-brand-primary" : "text-text-muted"
          }`}
        >
          {screenshotId.slice(-8)}
        </div>
      </div>
    </ExplorerPanelThumbnail>
  );
}
