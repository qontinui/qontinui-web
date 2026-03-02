import React from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CanvasToolbarProps {
  /** Current zoom level (1 = 100%). */
  zoom: number;
  /** Zoom in handler. */
  onZoomIn: () => void;
  /** Zoom out handler. */
  onZoomOut: () => void;
  /** Reset view handler. */
  onReset: () => void;
  /** Content rendered on the left side of the toolbar. */
  leftContent?: React.ReactNode;
  /** Content rendered to the left of the zoom controls on the right side. */
  rightContent?: React.ReactNode;
  /** Additional className on the root container. */
  className?: string;
}

/**
 * Shared horizontal canvas toolbar with zoom controls and optional content slots.
 *
 * Layout: [leftContent] ---- [rightContent] [zoom%] [zoomIn] [zoomOut] [reset]
 */
export function CanvasToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  leftContent,
  rightContent,
  className,
}: CanvasToolbarProps) {
  return (
    <div
      className={`border-b border-border-subtle px-4 py-2 flex items-center justify-between flex-shrink-0 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2">{leftContent}</div>

      <div className="flex items-center gap-2">
        {rightContent}

        <span className="text-sm text-text-muted font-mono min-w-[60px] text-center">
          {Math.round(zoom * 100)}%
        </span>

        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onZoomIn} title="Zoom In">
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onZoomOut}
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            title="Reset View"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
