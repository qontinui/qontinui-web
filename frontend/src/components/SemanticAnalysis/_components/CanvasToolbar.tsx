"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";
import type { CanvasViewportState } from "../semantic-analysis-types";

interface CanvasToolbarProps {
  viewport: CanvasViewportState;
}

export function CanvasToolbar({ viewport }: CanvasToolbarProps) {
  return (
    <div className="border-b border-border-subtle p-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={viewport.zoomIn}>
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={viewport.zoomOut}>
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={viewport.resetView}>
          Reset
        </Button>
        <span className="text-xs text-text-muted ml-2">
          Zoom: {(viewport.zoom * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
