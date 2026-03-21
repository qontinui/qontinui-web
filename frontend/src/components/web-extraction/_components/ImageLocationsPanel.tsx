import React from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, MapPin, FileImage } from "lucide-react";
import {
  ExplorerPanel,
  ExplorerPanelHeader,
  ExplorerPanelEmptyState,
} from "@/components/qontinui/ExplorerPanel";
import type { PlaywrightClickable } from "@/lib/runner-client";

interface ImageLocationsPanelProps {
  selectedScreenshotId: string | null;
  pageScreenshots: Record<string, string>;
  hoveredElementId: string | null;
  clickablesMap: Map<string, PlaywrightClickable>;
  zoom: number;
  isDragging: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
}

export function ImageLocationsPanel({
  selectedScreenshotId,
  pageScreenshots,
  hoveredElementId,
  clickablesMap,
  zoom,
  isDragging,
  canvasRef,
  containerRef,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: ImageLocationsPanelProps) {
  return (
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
              onClick={onZoomOut}
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
              onClick={onZoomIn}
              className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <div className="w-px h-4 bg-brand-success/30 mx-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={onResetZoom}
              className="text-brand-success hover:bg-brand-success/20 h-6 w-6 p-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        }
      />

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
        ref={containerRef}
        className="flex-1 min-h-0 h-0 overflow-auto p-4 bg-surface-canvas/30 flex flex-col items-center"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{
          cursor:
            zoom > 1 && isDragging ? "grabbing" : zoom > 1 ? "grab" : "default",
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
  );
}
