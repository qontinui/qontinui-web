import React from "react";
import { ZoomIn, ZoomOut, Move } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
}: ZoomControlsProps) {
  return (
    <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-background/80 backdrop-blur-sm rounded-lg p-2 shadow-lg">
      <Button size="sm" variant="outline" onClick={onZoomIn}>
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="outline" onClick={onZoomOut}>
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="outline" onClick={onResetView}>
        <Move className="h-4 w-4" />
      </Button>
      <div className="text-xs text-center text-muted-foreground px-2">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}
