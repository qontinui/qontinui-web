import React from "react";
import type { LucideIcon } from "lucide-react";
import { ZoomIn, ZoomOut, Move } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ZoomControlsProps {
  /** Current zoom level (1 = 100%). Omit to hide the percentage display. */
  zoom?: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Callback for the reset/fit-to-view button. */
  onReset: () => void;
  /** Icon for the reset button. Defaults to Move. */
  resetIcon?: LucideIcon;
  /** Title tooltip for the reset button. Defaults to "Reset View". */
  resetTitle?: string;
  /** Additional className on the root container. */
  className?: string;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  resetIcon: ResetIcon = Move,
  resetTitle = "Reset View",
  className,
}: ZoomControlsProps) {
  return (
    <div
      className={`absolute top-4 right-4 z-10 flex flex-col gap-2 bg-background/80 backdrop-blur-sm rounded-lg p-2 shadow-lg ${className ?? ""}`}
    >
      <Button size="sm" variant="outline" onClick={onZoomIn} title="Zoom In">
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="outline" onClick={onZoomOut} title="Zoom Out">
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="outline" onClick={onReset} title={resetTitle}>
        <ResetIcon className="h-4 w-4" />
      </Button>
      {zoom != null && (
        <div className="text-xs text-center text-muted-foreground px-2">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  );
}
